import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  root: "",
  versions: {} as Record<string, string>,
  calls: [] as string[],
  resolved: 0,
  exitCode: undefined as number | void,
}));
vi.mock("child_process", () => {
  const execFile = vi.fn();
  Object.defineProperty(execFile, Symbol.for("nodejs.util.promisify.custom"), {
    value: async (command: string) => {
      state.calls.push(command);
      if (!(command in state.versions))
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { stdout: state.versions[command], stderr: "" };
    },
  });
  return { execFile };
});
vi.mock("../src/commands/_shared.js", () => ({
  withResolvedRepo: async (
    _url: string,
    _opts: unknown,
    _label: string,
    fn: (repo: unknown) => Promise<number | void>
  ) => {
    state.resolved++;
    state.exitCode = await fn({ path: state.root, repoInfo: { fullName: "local/workspace" } });
  },
}));
import { runPreflightCommand } from "../src/commands/preflight-command.js";

let base: string;
let log: ReturnType<typeof vi.spyOn>;
async function file(path: string, content: string) {
  await writeFile(join(state.root, path), content);
}
function report() {
  return JSON.parse(log.mock.calls[0][0]);
}

describe("package-scoped preflight", () => {
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "bootcamp-preflight-scope-"));
    state.root = join(base, "repo");
    await mkdir(join(state.root, "packages", "api space"), { recursive: true });
    state.versions = { node: "v24.2.0", go: "go version go1.24.0 linux/amd64" };
    state.calls = [];
    state.resolved = 0;
    state.exitCode = undefined;
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(base, { recursive: true, force: true });
  });

  it("checks only package declarations with exact source provenance and preserves Go minimum semantics", async () => {
    await file(
      "package.json",
      JSON.stringify({ engines: { node: ">=99" }, packageManager: "yarn@99" })
    );
    await file(".python-version", "99");
    await file(
      "packages/api space/package.json",
      JSON.stringify({ engines: { node: ">=24" }, packageManager: "pnpm@10.1.0" })
    );
    await file("packages/api space/go.mod", "module example.test/api\ngo 1.23\n");
    state.versions.pnpm = "10.1.0";
    await runPreflightCommand(state.root, {
      subdir: "./packages/api space/",
      json: true,
      check: true,
    });
    expect(state.exitCode).toBe(0);
    expect(report()).toEqual({
      repo: "local/workspace",
      subdir: "packages/api space",
      scope: "directory",
      ok: true,
      checks: [
        {
          tool: "Node.js",
          required: ">=24",
          source: "packages/api space/package.json engines.node",
          installed: "24.2.0",
          status: "ok",
        },
        {
          tool: "pnpm",
          required: "10.1.0",
          source: "packages/api space/package.json packageManager",
          installed: "10.1.0",
          status: "ok",
        },
        {
          tool: "Go",
          required: "1.23",
          source: "packages/api space/go.mod",
          installed: "1.24.0",
          status: "ok",
        },
      ],
    });
    expect(state.calls).toEqual(["node", "pnpm", "go"]);
  });

  it("retains missing, mismatch and unknown statuses for scoped inventories", async () => {
    await file("packages/api space/.nvmrc", "99");
    await file("packages/api space/.python-version", "3.12");
    await file("packages/api space/rust-toolchain.toml", '[toolchain]\npath = "./custom"\n');
    await file("packages/api space/global.json", '{"sdk":{"version":"8.0.100"}}');
    state.versions.dotnet = "8.0.101 [sdk]\n";
    await runPreflightCommand(state.root, {
      subdir: "packages/api space",
      json: true,
      check: true,
    });
    expect(state.exitCode).toBe(1);
    expect(report()).toMatchObject({
      ok: false,
      checks: [
        { tool: "Node.js", status: "mismatch", source: "packages/api space/.nvmrc" },
        { tool: "Python", status: "missing", source: "packages/api space/.python-version" },
        { tool: "Rust", status: "unknown", source: "packages/api space/rust-toolchain.toml" },
        { tool: ".NET SDK", status: "ok", source: "packages/api space/global.json" },
      ],
    });
    expect(state.calls).not.toContain("rustup");
  });

  it("does not inherit workspace pins or scan nested/sibling declarations", async () => {
    await file(
      "package.json",
      JSON.stringify({ engines: { node: ">=99" }, packageManager: "pnpm@99" })
    );
    await file("pnpm-workspace.yaml", 'packages: ["packages/*"]');
    await file("packages/api space/package.json", '{"name":"api"}');
    await mkdir(join(state.root, "packages/api space/nested"));
    await file("packages/api space/nested/.node-version", "99");
    await runPreflightCommand(state.root, { subdir: "packages/api space", json: true });
    expect(report()).toMatchObject({ subdir: "packages/api space", checks: [] });
    expect(state.calls).toEqual([]);
  });

  it("keeps the unscoped JSON shape unchanged", async () => {
    await file(".nvmrc", "24");
    await runPreflightCommand(state.root, { json: true });
    expect(report()).not.toHaveProperty("subdir");
    expect(report()).not.toHaveProperty("scope");
    expect(report().checks[0].source).toBe(".nvmrc");
  });

  it("accepts an explicit repository-root scope without corrupting evidence paths", async () => {
    await file(".nvmrc", "24");
    await runPreflightCommand(state.root, { subdir: ".", json: true });
    expect(report()).toMatchObject({
      subdir: ".",
      scope: "directory",
      checks: [{ source: ".nvmrc", status: "ok" }],
    });
  });

  it("prints the selected directory even when it has no declarations", async () => {
    await runPreflightCommand(state.root, { subdir: "packages/api space" });
    expect(log.mock.calls.flat().join("\n")).toContain(
      "Package directory: packages/api space (local declarations only)"
    );
  });

  it("prints the selected directory and source with declared requirements", async () => {
    await file("packages/api space/.nvmrc", "24");
    await runPreflightCommand(state.root, { subdir: "packages/api space" });
    expect(log.mock.calls.flat().join("\n")).toContain(
      "Package directory: packages/api space (local declarations only)"
    );
    expect(log.mock.calls.flat().join("\n")).toContain("packages/api space/.nvmrc");
  });

  it.each(["../outside", "/outside", "/"])(
    "rejects invalid scope %s before resolving or probing",
    async (subdir) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      await runPreflightCommand(state.root, { subdir });
      expect(exit).toHaveBeenCalledWith(1);
      expect(state.resolved).toBe(0);
      expect(state.calls).toEqual([]);
    }
  );

  it("rejects missing and non-directory scopes before probes", async () => {
    await file("file.txt", "not a directory");
    await expect(runPreflightCommand(state.root, { subdir: "missing" })).rejects.toThrow(
      "does not exist"
    );
    await expect(runPreflightCommand(state.root, { subdir: "file.txt" })).rejects.toThrow(
      "not a directory"
    );
    expect(state.calls).toEqual([]);
  });

  it("rejects outside directory aliases and reports contained aliases by canonical path", async () => {
    const outside = join(base, "outside");
    await mkdir(outside);
    await symlink(
      outside,
      join(state.root, "escape"),
      process.platform === "win32" ? "junction" : "dir"
    );
    await expect(runPreflightCommand(state.root, { subdir: "escape" })).rejects.toThrow(
      "escapes repository root"
    );
    expect(state.calls).toEqual([]);
    await file("packages/api space/.nvmrc", "24");
    await symlink(
      join(state.root, "packages/api space"),
      join(state.root, "alias"),
      process.platform === "win32" ? "junction" : "dir"
    );
    await runPreflightCommand(state.root, { subdir: "alias", json: true });
    expect(report()).toMatchObject({
      subdir: "packages/api space",
      checks: [{ source: "packages/api space/.nvmrc" }],
    });
  });
});
