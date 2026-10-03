import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { walkRepositoryFiles } from "../src/scan-walk.js";

const io = vi.hoisted(() => ({
  opened: [] as string[],
  stated: [] as string[],
  handles: [] as Array<{ read(): Promise<unknown> }>,
  failOpen: new Set<string>(),
  failRead: new Set<string>(),
  failStat: new Set<string>(),
  directoryLinks: new Set<string>(),
}));
vi.mock("fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("fs/promises")>();
  return {
    ...original,
    opendir: async (path: string) => {
      io.opened.push(path);
      if (io.failOpen.has(path)) throw Object.assign(new Error("unreadable"), { code: "EACCES" });
      const handle = await original.opendir(path);
      io.handles.push(handle);
      if (io.failRead.has(path)) {
        return {
          async *[Symbol.asyncIterator]() {
            try {
              throw Object.assign(new Error("read failed"), { code: "EIO" });
            } finally {
              await handle.close();
            }
          },
        };
      }
      if (io.directoryLinks.size) {
        return {
          async *[Symbol.asyncIterator]() {
            for await (const entry of handle) {
              if (io.directoryLinks.has(join(path, entry.name))) {
                yield { name: entry.name, isDirectory: () => true, isSymbolicLink: () => false };
              } else {
                yield entry;
              }
            }
          },
        };
      }
      return handle;
    },
    lstat: async (path: string) => {
      io.stated.push(path);
      if (io.failStat.has(path)) throw Object.assign(new Error("deleted"), { code: "ENOENT" });
      return original.lstat(path);
    },
  };
});

const directories: string[] = [];
async function fixture(paths: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bootcamp-walk-"));
  directories.push(root);
  for (const path of paths) {
    const target = join(root, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, "source");
  }
  return root;
}
afterEach(async () => {
  for (const handle of io.handles) {
    // Node 20 throws synchronously; newer Node versions reject the promise.
    await expect(async () => handle.read()).rejects.toMatchObject({ code: "ERR_DIR_CLOSED" });
  }
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
  io.opened.length = 0;
  io.stated.length = 0;
  io.handles.length = 0;
  io.failOpen.clear();
  io.failRead.clear();
  io.failStat.clear();
  io.directoryLinks.clear();
});

describe("bounded repository walk", () => {
  it("does not open descendants after the entry limit", async () => {
    const root = await fixture(Array.from({ length: 100 }, (_, index) => `dir-${index}/leaf.ts`));
    const files = await walkRepositoryFiles(root, 1, []);
    expect(files).toHaveLength(1);
    expect(files[0].isDirectory).toBe(true);
    expect(io.opened).toEqual([root]);
    expect(io.stated).toEqual([join(root, files[0].path)]);
  });

  it("does not stat remaining files after the limit", async () => {
    const root = await fixture(Array.from({ length: 100 }, (_, index) => `file-${index}.ts`));
    const files = await walkRepositoryFiles(root, 1, []);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ size: 6, isDirectory: false });
    expect(io.opened).toEqual([root]);
    expect(io.stated).toHaveLength(1);
  });

  it("skips directory links, file links, and dangling links", async () => {
    const root = await fixture(["src/main.ts"]);
    await symlink(join(root, "src"), join(root, "link-dir"), "junction");
    await symlink(join(root, "src/main.ts"), join(root, "link-file"));
    await symlink(join(root, "missing.ts"), join(root, "dangling"));
    const files = await walkRepositoryFiles(root, 100, []);
    expect(files.map((file) => file.path).sort()).toEqual(["src", "src/main.ts"]);
    expect(io.opened.some((path) => path.endsWith("link-dir"))).toBe(false);
  });

  it("rejects directory links even when a Dirent reports them as directories", async () => {
    const root = await fixture(["src/main.ts"]);
    const link = join(root, "link-dir");
    await symlink(join(root, "src"), link, "junction");
    io.directoryLinks.add(link);
    const files = await walkRepositoryFiles(root, 100, []);
    expect(files.map((file) => file.path).sort()).toEqual(["src", "src/main.ts"]);
    expect(io.opened).not.toContain(link);
    expect(io.stated).toContain(link);
  });

  it("continues past unreadable directories and deleted files", async () => {
    const root = await fixture(["blocked/secret.ts", "ok/keep.ts", "deleted.ts"]);
    io.failOpen.add(join(root, "blocked"));
    io.failStat.add(join(root, "deleted.ts"));
    const files = await walkRepositoryFiles(root, 100, []);
    expect(files.map((file) => file.path).sort()).toEqual(["blocked", "ok", "ok/keep.ts"]);
  });

  it("prunes excluded dependency trees without opening or stating them", async () => {
    const root = await fixture([
      "node_modules/vendor.ts",
      "src/node_modules/vendor.ts",
      "src/main.ts",
    ]);
    const files = await walkRepositoryFiles(root, 100, ["**/node_modules", "**/node_modules/**"]);
    expect(files.map((file) => file.path).sort()).toEqual(["src", "src/main.ts"]);
    expect([...io.opened, ...io.stated].some((path) => path.includes("node_modules"))).toBe(false);
  });

  it("closes a failed directory iterator and continues other queued trees", async () => {
    const root = await fixture(["blocked/secret.ts", "ok/keep.ts"]);
    io.failRead.add(join(root, "blocked"));
    const files = await walkRepositoryFiles(root, 100, []);
    expect(files.map((file) => file.path).sort()).toEqual(["blocked", "ok", "ok/keep.ts"]);
  });
});

describe("exclude syntax compatibility", () => {
  const sourcePaths = [
    "generated/a.ts",
    "src/main.ts",
    "nested/generated/b.ts",
    ".hidden/file.ts",
    "Case.TS",
    "file.js",
    "literal[1].ts",
    "range-01/a.ts",
    "range-02/a.ts",
    "range-03/a.ts",
  ];
  const all = [
    ".hidden",
    ".hidden/file.ts",
    "Case.TS",
    "file.js",
    "generated",
    "generated/a.ts",
    "literal[1].ts",
    "nested",
    "nested/generated",
    "nested/generated/b.ts",
    "range-01",
    "range-01/a.ts",
    "range-02",
    "range-02/a.ts",
    "range-03",
    "range-03/a.ts",
    "src",
    "src/main.ts",
  ];
  it.each([
    ["generated", ["generated", "generated/a.ts"]],
    ["**/generated", ["generated", "generated/a.ts", "nested/generated", "nested/generated/b.ts"]],
    [
      "**/generated/**",
      ["generated", "generated/a.ts", "nested/generated", "nested/generated/b.ts"],
    ],
    ["generated/", ["generated"]],
    ["gen*", ["generated"]],
    ["**/gen*", ["generated", "nested/generated"]],
    ["!src/**", ["src", "src/main.ts"]],
    ["{generated,src}", ["generated", "generated/a.ts", "src", "src/main.ts"]],
    ["(generated|src)/**", ["generated", "generated/a.ts", "src", "src/main.ts"]],
    ["@(generated|src)/**", ["generated", "generated/a.ts", "src", "src/main.ts"]],
    ["./generated", ["generated", "generated/a.ts"]],
    ["generated//**", ["generated", "generated/a.ts"]],
    ["file.js/**", ["file.js"]],
    ["literal\\[1\\].ts", ["literal[1].ts"]],
    ["range-{01..03..2}/**", ["range-01", "range-01/a.ts", "range-03", "range-03/a.ts"]],
    ["\\{generated,src\\}/**", []],
    ["#*", []],
    [
      "**/*.ts",
      [
        ".hidden/file.ts",
        "generated/a.ts",
        "literal[1].ts",
        "nested/generated/b.ts",
        "range-01/a.ts",
        "range-02/a.ts",
        "range-03/a.ts",
        "src/main.ts",
      ],
    ],
  ])("preserves %s exclusions", async (pattern, excluded) => {
    const root = await fixture(sourcePaths);
    const files = await walkRepositoryFiles(root, 100, [pattern as string]);
    expect(files.map((file) => file.path).sort()).toEqual(
      all.filter((path) => !excluded.includes(path))
    );
  });

  it("matches absolute directory exclusions", async () => {
    const root = await fixture(["generated/a.ts", "keep.ts"]);
    const pattern = `${root.replaceAll("\\", "/")}/generated/**`;
    expect((await walkRepositoryFiles(root, 100, [pattern])).map((file) => file.path)).toEqual([
      "keep.ts",
    ]);
  });

  it("uses the maintained matcher's safe nested-extglob behavior", async () => {
    const root = await fixture(["a.ts", "ab.ts", "bbbb.ts", "keep.ts"]);
    expect(
      (await walkRepositoryFiles(root, 100, ["+(*(a)|*(b)).ts"])).map((file) => file.path)
    ).toEqual(["keep.ts"]);
  });

  it("rejects excessive alternatives before opening the repository", async () => {
    const root = await fixture(["keep.ts"]);
    await expect(walkRepositoryFiles(root, 100, ["file-{1..10001}.ts"])).rejects.toThrow(
      "brace-alternative limit"
    );
    expect(io.opened).toEqual([]);
  });

  it("rejects long alternatives instead of silently truncating their exclusions", async () => {
    const root = await fixture(["keep.ts"]);
    const prefix = Array.from({ length: 4 }, () => "a".repeat(180)).join("/");
    await expect(walkRepositoryFiles(root, 100, [`${prefix}/file-{1..10001}.ts`])).rejects.toThrow(
      "memory budget"
    );
    expect(io.opened).toEqual([]);
  });

  it("detects overflow hidden by nested empty alternatives", async () => {
    const root = await fixture(["a"]);
    const pattern = "{,{" + ",".repeat(10002) + "a}}";
    await expect(walkRepositoryFiles(root, 100, [pattern])).rejects.toThrow(
      "brace-alternative limit"
    );
    expect(io.opened).toEqual([]);
  });

  it("accepts 10,000 ordinary short alternatives without truncation", async () => {
    const root = await fixture(["file-10000.ts"]);
    expect(await walkRepositoryFiles(root, 100, ["file-{1..10000}.ts"])).toEqual([]);
  });

  it("preserves empty alternatives and leading literal braces", async () => {
    const root = await fixture(["src/main.ts", "{}a/main.ts", "keep.ts"]);
    const files = await walkRepositoryFiles(root, 100, ["src{,s}/**", "{}a/**"]);
    expect(files.map((file) => file.path)).toEqual(["keep.ts"]);
  });

  it("handles deeply nested braces without exhausting the process stack", async () => {
    const root = await fixture(["keep.ts"]);
    const pattern = "{".repeat(3500) + "a,b" + "}".repeat(3500);
    expect((await walkRepositoryFiles(root, 100, [pattern])).map((file) => file.path)).toEqual([
      "keep.ts",
    ]);
  });
});
