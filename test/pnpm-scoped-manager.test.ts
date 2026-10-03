import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { scanRepo } from "../src/ingest.js";
import { detectPackageManager, discoverTasks } from "../src/tasks.js";
import { resolveScopedPackageManager } from "../src/scoped-package-manager.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup(workspace = "packages:\n - 'packages/*'\n") {
  const dir = await mkdtemp(join(tmpdir(), "pnpm-manager-"));
  dirs.push(dir);
  const root = join(dir, "repo"),
    child = join(root, "packages/app");
  await mkdir(join(child, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "root",
      packageManager: "pnpm@11.14.0",
      dependencies: { outerOnly: "1" },
      scripts: { outer: "NEVER_RUN" },
    })
  );
  await writeFile(join(root, "pnpm-workspace.yaml"), workspace);
  await writeFile(
    join(child, "package.json"),
    JSON.stringify({
      name: "app",
      dependencies: { sibling: "workspace:*" },
      scripts: { build: "NEVER_RUN", test: "NEVER_RUN" },
    })
  );
  await writeFile(join(child, "src/index.ts"), "export const selected = true;\n");
  return { dir, root, child };
}
const scoped = (root: string) => scanRepo(root, 100, { subdir: "packages/app" });
describe("proven original-root pnpm manager context", () => {
  it("changes selected stack and commands together without importing root source/dependencies/tasks; one-arg APIs stay selected", async () => {
    const { root, child } = await setup();
    const scan = await scoped(root);
    expect(scan.stack.packageManager).toBe("pnpm");
    expect(scan.commands.map((c) => c.command)).toEqual(["pnpm run build", "pnpm run test"]);
    expect(scan.packageManagerContextFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(scan.files.map((f) => f.path)).not.toContain("pnpm-workspace.yaml");
    expect([...scan.keySourceFiles.values()].join("\n")).not.toContain("outerOnly");
    expect(await detectPackageManager(child)).toBe("npm");
    expect((await discoverTasks(child)).map((t) => t.command)).toEqual([
      "npm run build",
      "npm run test",
    ]);
    expect((await scanRepo(child, 100)).packageManagerContextFingerprint).toBeUndefined();
    expect((await scanRepo(root, 100)).packageManagerContextFingerprint).toBeUndefined();
  });
  it.each([
    "node_modules/app",
    "bower_components/app",
    "packages/node_modules/app",
    "packages/bower_components/app",
  ])(
    "does not inherit a workspace manager beneath native-excluded %s, including aliases",
    async (subdir) => {
      const { root } = await setup("packages: ['**']\n");
      const child = join(root, subdir);
      await mkdir(child, { recursive: true });
      await writeFile(join(child, "package.json"), '{"scripts":{"build":"NEVER_RUN"}}');
      for (const selected of [subdir, "alias"]) {
        if (selected === "alias")
          await symlink(
            child,
            join(root, selected),
            process.platform === "win32" ? "junction" : "dir"
          );
        const scan = await scanRepo(root, 100, { subdir: selected });
        expect(scan.stack.packageManager).toBe("npm");
        expect(scan.commands.map((command) => command.command)).toEqual(["npm run build"]);
        expect(scan).not.toHaveProperty("packageManagerContextFingerprint");
      }
    }
  );
  it.each(["test/app", "tests/app", "packages/node_modules_app"])(
    "keeps native-supported %s eligible",
    async (subdir) => {
      const { root } = await setup("packages: ['**']\n");
      const child = join(root, subdir);
      await mkdir(child, { recursive: true });
      await writeFile(join(child, "package.json"), '{"scripts":{"build":"NEVER_RUN"}}');
      const scan = await scanRepo(root, 100, { subdir });
      expect(scan.stack.packageManager).toBe("pnpm");
      expect(scan.commands.map((command) => command.command)).toEqual(["pnpm run build"]);
      expect(scan.packageManagerContextFingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
  );
  it.each([
    "packages: []\n",
    "catalog: {}\n",
    "packages: {app: packages/app}\n",
    "packages: [123]\n",
    "packages: ['packages/*', '!packages/app']\n",
    "packages: ['!packages/app', 'packages/*']\n",
    "packages: ['packages/*', '!${HIDDEN}']\n",
    "packages: ['packages/{app,shared}']\n",
    "packages: ['../packages/*']\n",
    "packages: ['packages/*', '!packages/[a]*']\n",
  ])("does not partially trust unsupported/unmatched declaration %s", async (workspace) => {
    const { root } = await setup(workspace);
    const scan = await scoped(root);
    expect(scan.stack.packageManager).toBe("npm");
    expect(scan).not.toHaveProperty("packageManagerContextFingerprint");
  });
  it.each(["npm@11", "bun@1", "yarn@4", "pnpm@11", "unsupported@1"])(
    "preserves child declaration %s",
    async (field) => {
      const { root, child } = await setup();
      await writeFile(
        join(child, "package.json"),
        JSON.stringify({ packageManager: field, scripts: { build: "NEVER_RUN" } })
      );
      const scan = await scoped(root);
      expect(scan.stack.packageManager).toBe(
        field.startsWith("unsupported") ? "npm" : field.split("@")[0]
      );
      expect(scan).not.toHaveProperty("packageManagerContextFingerprint");
    }
  );
  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
    ["npm-shrinkwrap.json", "npm"],
  ])("preserves child %s", async (lock, manager) => {
    const { root, child } = await setup();
    await writeFile(join(child, lock), "contents must not be parsed");
    const scan = await scoped(root);
    expect(scan.stack.packageManager).toBe(manager);
    expect(scan).not.toHaveProperty("packageManagerContextFingerprint");
  });
  it("refuses unavailable child/root lock markers and bounded oversized/many-pattern metadata", async () => {
    const { dir, root, child } = await setup();
    await writeFile(join(dir, "external.lock"), "owned external");
    await symlink(join(dir, "external.lock"), join(child, "package-lock.json"));
    expect((await scoped(root)).stack.packageManager).toBe("npm");
    await rm(join(child, "package-lock.json"));
    await symlink(join(dir, "external.lock"), join(root, "pnpm-lock.yaml"));
    expect((await scoped(root)).stack.packageManager).toBe("npm");
    await rm(join(root, "pnpm-lock.yaml"));
    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      "#" + "x".repeat(10 * 1024 * 1024) + "\npackages: ['packages/*']\n"
    );
    expect((await scoped(root)).stack.packageManager).toBe("npm");
    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      "packages: " + JSON.stringify(Array(257).fill("packages/*"))
    );
    expect((await scoped(root)).stack.packageManager).toBe("npm");
  });
  it("matches explicit dot paths and ./ prefixes without treating star as a hidden directory match", async () => {
    const { root, child } = await setup("packages: ['./packages/*']\n");
    expect((await scoped(root)).stack.packageManager).toBe("pnpm");
    const hidden = join(root, "packages/.hidden");
    await mkdir(hidden);
    await writeFile(join(hidden, "package.json"), '{"scripts":{"test":"NEVER_RUN"}}');
    expect((await scanRepo(root, 100, { subdir: "packages/.hidden" })).stack.packageManager).toBe(
      "npm"
    );
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages: ['packages/.hidden']\n");
    expect((await scanRepo(root, 100, { subdir: "packages/.hidden" })).stack.packageManager).toBe(
      "pnpm"
    );
    await writeFile(join(child, "package.json"), "malformed");
    expect((await scoped(root)).stack.packageManager).toBe("npm");
  });
  it("accepts root lock evidence while root explicit npm still wins, and YAML/JSON-only do not suffice", async () => {
    const { root } = await setup();
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(join(root, "pnpm-lock.yaml"), "unparsed");
    expect((await scoped(root)).stack.packageManager).toBe("pnpm");
    await writeFile(join(root, "package.json"), '{"packageManager":"npm@11"}');
    expect((await scoped(root)).stack.packageManager).toBe("npm");
    await rm(join(root, "pnpm-lock.yaml"));
    await writeFile(
      join(root, "package.json"),
      '{"packageManager":"pnpm@11","workspaces":["packages/*"]}'
    );
    await rm(join(root, "pnpm-workspace.yaml"));
    expect((await scoped(root)).stack.packageManager).toBe("npm");
    await writeFile(join(root, "pnpm-workspace.yml"), 'packages: ["packages/*"]');
    expect((await scoped(root)).stack.packageManager).toBe("npm");
  });
  it("handles contained aliases and copied roots with identical relevant context but not nested/input-external context", async () => {
    const { dir, root, child } = await setup("packages: ['packages/**']\n");
    const original = await scoped(root);
    await symlink(child, join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
    expect((await scanRepo(root, 100, { subdir: "alias" })).packageManagerContextFingerprint).toBe(
      original.packageManagerContextFingerprint
    );
    await rm(join(root, "alias"));
    const copy = join(dir, "copy");
    await cp(root, copy, { recursive: true });
    expect((await scoped(copy)).packageManagerContextFingerprint).toBe(
      original.packageManagerContextFingerprint
    );
    expect(
      (await scanRepo(join(root, "packages"), 100, { subdir: "app" })).stack.packageManager
    ).toBe("npm");
    await writeFile(join(root, "packages/pnpm-workspace.yaml"), "packages: ['app']\n");
    expect((await scoped(root)).stack.packageManager).toBe("npm");
    await rm(join(root, "packages/pnpm-workspace.yaml"));
    await writeFile(join(child, "pnpm-workspace.yaml"), "packages: []\n");
    expect((await scoped(root)).stack.packageManager).toBe("npm");
  });
  it("qualifies only allowed selected manifest and unexcluded regular contained root metadata", async () => {
    const { dir, root } = await setup();
    for (const exclude of [
      ["pnpm-workspace.yaml"],
      [join(root, "pnpm-workspace.yaml").replaceAll("\\", "/")],
      ["package.json"],
    ])
      expect(
        (await scanRepo(root, 100, { subdir: "packages/app", exclude }))
          .packageManagerContextFingerprint
      ).toBeUndefined();
    expect(
      (
        await resolveScopedPackageManager({
          repositoryRoot: root,
          selectedRoot: join(root, "packages/app"),
          selectedFiles: new Set(["src/index.ts"]),
        })
      ).packageManagerContextFingerprint
    ).toBeUndefined();
    await rm(join(root, "pnpm-workspace.yaml"));
    await writeFile(join(dir, "external.yaml"), "packages: ['packages/*']\n");
    await symlink(join(dir, "external.yaml"), join(root, "pnpm-workspace.yaml"));
    expect((await scoped(root)).stack.packageManager).toBe("npm");
    await rm(join(root, "pnpm-workspace.yaml"));
    await mkdir(join(root, "pnpm-workspace.yaml"));
    expect((await scoped(root)).stack.packageManager).toBe("npm");
  });
});
