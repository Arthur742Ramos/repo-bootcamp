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
