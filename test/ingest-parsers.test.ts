import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { scanRepo } from "../src/ingest.js";

const dirs: string[] = [];

async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-ingest-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf-8");
  }
  return dir;
}

describe("ingest parsers", () => {
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("Makefile: extracts targets but not `:=` assignments", async () => {
    const dir = await repoWith({
      Makefile: "CC := gcc\nPREFIX := /usr/local\nbuild:\n\tgo build\ntest: build\n\tgo test\n",
    });
    const scan = await scanRepo(dir, 100);
    const names = scan.commands.filter((c) => c.source === "Makefile").map((c) => c.name);
    expect(names).toContain("build");
    expect(names).toContain("test");
    expect(names).not.toContain("CC");
    expect(names).not.toContain("PREFIX");
  });

  it.each([
    ["pnpm@9.12.0", "pnpm"],
    ["yarn@4.5.0", "yarn"],
    ["bun@1.4.0", "bun"],
    ["npm@10.0.0", "npm"],
  ])(
    "uses declared package manager %s consistently in scan metadata and commands",
    async (declared, expected) => {
      const dir = await repoWith({
        "package.json": JSON.stringify({
          name: "fixture",
          packageManager: declared,
          scripts: { build: "tsc", test: "vitest" },
        }),
        "pnpm-lock.yaml": "stale lockfile",
        "yarn.lock": "stale lockfile",
      });
      const scan = await scanRepo(dir, 100);
      expect(scan.stack.packageManager).toBe(expected);
      expect(scan.commands.map((command) => command.command)).toEqual([
        `${expected} run build`,
        `${expected} run test`,
      ]);
    }
  );

  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ])(
    "uses %s as onboarding package-manager evidence without a manifest pin",
    async (lockfile, expected) => {
      const dir = await repoWith({
        "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
        [lockfile]: "lockfile",
      });
      const scan = await scanRepo(dir, 100);
      expect(scan.stack.packageManager).toBe(expected);
      expect(scan.commands[0].command).toBe(`${expected} run test`);
    }
  );

  it("uses the selected package's manager and commands in a scoped scan", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({
        packageManager: "pnpm@9.12.0",
        scripts: { root: "echo root" },
      }),
      "pnpm-lock.yaml": "root lockfile",
      "packages/app/package.json": JSON.stringify({
        packageManager: "bun@1.4.0",
        scripts: { build: "tsc", test: "vitest" },
      }),
      "packages/app/bun.lock": "child lockfile",
    });
    const scan = await scanRepo(dir, 100, { subdir: "packages/app" });
    expect(scan.stack.packageManager).toBe("bun");
    expect(scan.commands.map((command) => command.command)).toEqual([
      "bun run build",
      "bun run test",
    ]);
  });

  it("detects the text Bun lockfile even without a root JavaScript manifest", async () => {
    const dir = await repoWith({ "bun.lock": "lockfile" });
    expect((await scanRepo(dir, 100)).stack.packageManager).toBe("bun");
  });

  it("reads documentation, workflows, and source evidence from the selected package", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({ name: "outer", workspaces: ["packages/*"] }),
      "README.md": "# Outer repository\n",
      "CONTRIBUTING.md": "Outer contribution rules.\n",
      "src/index.ts": "export const identity = 'outer';\n",
      ".github/workflows/ci.yml": "name: Outer CI\non: [push]\njobs: {}\n",
      "packages/app/package.json": JSON.stringify({ name: "app" }),
      "packages/app/README.md": "# App setup\n",
      "packages/app/CONTRIBUTING.md": "App contribution rules.\n",
      "packages/app/src/index.ts": "export const identity = 'app';\n",
      "packages/app/.github/workflows/ci.yml": "name: App CI\non: [pull_request]\njobs: {}\n",
    });
    const scan = await scanRepo(dir, 100, { subdir: "packages/app" });
    expect(scan.readme).toBe("# App setup\n");
    expect(scan.contributing).toBe("App contribution rules.\n");
    expect(scan.keySourceFiles.get("src/index.ts")).toBe("export const identity = 'app';\n");
    expect(JSON.parse(scan.keySourceFiles.get("package.json")!)).toEqual({ name: "app" });
    expect(scan.ciWorkflows).toEqual([
      {
        name: "App CI",
        file: ".github/workflows/ci.yml",
        triggers: ["pull_request"],
        mainSteps: [],
      },
    ]);
    expect(scan.monorepo).toBeNull();
  });

  it("does not borrow root documents when the selected package has none", async () => {
    const dir = await repoWith({
      "README.md": "# Outer setup\n",
      "CONTRIBUTING.md": "Outer rules.\n",
      "packages/app/index.ts": "export const app = 1;\n",
    });
    const scan = await scanRepo(dir, 100, { subdir: "packages/app" });
    expect(scan.readme).toBeNull();
    expect(scan.contributing).toBeNull();
    expect(scan.keySourceFiles.get("index.ts")).toBe("export const app = 1;\n");
  });

  it("resolves nested workspace metadata against the selected package", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({ name: "outer", workspaces: ["packages/*"] }),
      "packages/app/package.json": JSON.stringify({ workspaces: ["modules/*"] }),
      "packages/app/modules/core/package.json": JSON.stringify({ name: "@app/core" }),
    });
    const scan = await scanRepo(dir, 100, { subdir: "packages/app" });
    expect(scan.monorepo).toEqual({
      isMonorepo: true,
      managers: ["npm-workspaces"],
      workspaceGlobs: ["modules/*"],
      workspacePackages: [{ name: "@app/core", path: "modules/core" }],
    });
  });

  it("keeps Poetry package-manager evidence when no JavaScript manifest exists", async () => {
    const dir = await repoWith({
      "pyproject.toml": "[tool.poetry]\nname = 'fixture'\n",
      "poetry.lock": "# Poetry lockfile\n",
      "app.py": "print('hi')\n",
    });
    expect((await scanRepo(dir, 100)).stack.packageManager).toBe("poetry");
  });

  it.each([
    ["requirements.txt", "pip"],
    ["pyproject.toml", "pip"],
    ["Cargo.toml", "cargo"],
  ])("keeps the generic installer indication for %s", async (manifest, expected) => {
    const dir = await repoWith({ [manifest]: "# Generic project metadata\n" });
    expect((await scanRepo(dir, 100)).stack.packageManager).toBe(expected);
  });

  it.each([
    ["uv.lock", "uv"],
    ["poetry.lock", "poetry"],
  ])("uses root %s workflow evidence before generic requirements", async (lockfile, expected) => {
    const dir = await repoWith({
      "pyproject.toml": "[project]\nname = 'fixture'\n",
      "requirements.txt": "# Exported requirements\n",
      [lockfile]: "# Lockfile\n",
    });
    expect((await scanRepo(dir, 100)).stack.packageManager).toBe(expected);
  });

  it("does not borrow nested or outer Python workflow evidence for the selected scope", async () => {
    const dir = await repoWith({
      "poetry.lock": "# Outer Poetry lockfile\n",
      "packages/app/pyproject.toml": "[project]\nname = 'app'\n",
      "packages/app/other/uv.lock": "# Nested uv project\n",
    });
    expect((await scanRepo(dir, 100, { subdir: "packages/app" })).stack.packageManager).toBe("pip");
    expect((await scanRepo(dir, 100, { subdir: "packages/app/other" })).stack.packageManager).toBe(
      "uv"
    );
    const nestedOnly = await repoWith({ "child/poetry.lock": "# Nested lockfile\n" });
    expect((await scanRepo(nestedOnly, 100)).stack.packageManager).toBeNull();
  });

  it("does not treat a directory named uv.lock as package-manager evidence", async () => {
    const dir = await repoWith({ "uv.lock/notes.txt": "Not a lockfile\n" });
    expect((await scanRepo(dir, 100)).stack.packageManager).toBeNull();
  });

  it("workflow `on:` block form yields top-level triggers (not nested keys)", async () => {
    const dir = await repoWith({
      ".github/workflows/ci.yml":
        "name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  build:\n    runs-on: ubuntu-latest\n",
    });
    const scan = await scanRepo(dir, 100);
    const wf = scan.ciWorkflows.find((w) => w.file.endsWith("ci.yml"));
    expect(wf?.triggers).toEqual(["push", "pull_request"]);
  });

  it("workflow `on:` inline list form yields triggers", async () => {
    const dir = await repoWith({
      ".github/workflows/lint.yml":
        "name: Lint\non: [push, pull_request]\njobs:\n  x:\n    runs-on: ubuntu-latest\n",
    });
    const scan = await scanRepo(dir, 100);
    const wf = scan.ciWorkflows.find((w) => w.file.endsWith("lint.yml"));
    expect(wf?.triggers).toEqual(["push", "pull_request"]);
  });

  it("readDocFile finds a non-Markdown README (README.rst)", async () => {
    const dir = await repoWith({ "README.rst": "Project\n=======\n\nDocs live here.\n" });
    const scan = await scanRepo(dir, 100);
    expect(scan.readme).toContain("Docs live here");
  });

  it("reads ESM/modern source files (.mjs/.cjs) as key files", async () => {
    const dir = await repoWith({
      "src/index.mjs": "export const x = 1;\n",
      "src/util.cjs": "module.exports = {};\n",
    });
    const scan = await scanRepo(dir, 100);
    expect([...scan.keySourceFiles.keys()]).toContain("src/index.mjs");
  });
});
