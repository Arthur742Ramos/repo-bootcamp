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

  it("detects the text Bun lockfile even without a root JavaScript manifest", async () => {
    const dir = await repoWith({ "bun.lock": "lockfile" });
    expect((await scanRepo(dir, 100)).stack.packageManager).toBe("bun");
  });

  it("keeps Poetry package-manager evidence when no JavaScript manifest exists", async () => {
    const dir = await repoWith({
      "pyproject.toml": "[tool.poetry]\nname = 'fixture'\n",
      "app.py": "print('hi')\n",
    });
    expect((await scanRepo(dir, 100)).stack.packageManager).toBe("poetry");
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
