import { execFileSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

async function createRepo(baseDir: string, files: Record<string, string>): Promise<string> {
  const repoDir = join(baseDir, "fixture-impact-repo");
  await mkdir(repoDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(repoDir, relativePath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repoDir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], { cwd: repoDir, stdio: "ignore" });
  return repoDir;
}

// src/index.ts imports src/util.ts, and test/util.test.ts targets it — so a
// change to src/util.ts has src/index.ts as a dependent and a related test.
const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fixture-impact-repo", version: "1.0.0" }, null, 2),
  "README.md": "# Fixture Impact Repo\n",
  "src/util.ts": "export const add = (a: number, b: number): number => a + b;\n",
  "src/index.ts": 'import { add } from "./util.js";\n\nconsole.log(add(1, 2));\n',
  "test/util.test.ts": 'import { add } from "../src/util.js";\n\nadd(1, 2);\n',
};

describe("impact command", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("summarizes key files when no file is given", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-impact-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["impact", repoPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Change Impact");
    expect(result.stdout).toContain("src/index.ts");
  }, 60_000);

  it("detects modern TypeScript impact, tests, and both module-kind cycle gates", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-impact-modules-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, {
      "src/index.mts": 'import "./util.mjs";',
      "src/util.mts": 'export * from "./index.mjs";',
      "src/main.cts": 'import helper = require("./helper.cjs");',
      "src/helper.cts": 'import main = require("./main.cjs");',
      "test/util.test.mts": 'import "../src/util.mjs";',
    });
    const impact = await runCli(["impact", repoPath, "src/util.mts", "--json"]);
    expect(impact.exitCode).toBe(0);
    const result = JSON.parse(impact.stdout).impacts[0];
    expect(result.importedBy.sort()).toEqual(["src/index.mts", "test/util.test.mts"]);
    expect(result.imports).toEqual(["src/index.mts"]);
    expect(result.affectedTests).toContain("test/util.test.mts");
    const defaultImpact = await runCli(["impact", repoPath, "--json"]);
    expect(defaultImpact.exitCode).toBe(0);
    expect(
      JSON.parse(defaultImpact.stdout).impacts.map((entry: { file: string }) => entry.file)
    ).toContain("src/index.mts");
    const cycles = await runCli(["cycles", repoPath, "--json", "--check"]);
    expect(cycles.exitCode).toBe(1);
    const report = JSON.parse(cycles.stdout);
    expect(report.moduleCount).toBe(4);
    expect(report.cycleCount).toBe(2);
    expect(report.cycles.map((cycle: { files: string[] }) => cycle.files.sort()).sort()).toEqual(
      [
        ["src/helper.cts", "src/main.cts"],
        ["src/index.mts", "src/util.mts"],
      ].sort()
    );
  }, 60_000);

  it("reports the blast radius for a specific file (human + JSON)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-impact-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const human = await runCli(["impact", repoPath, "src/util.ts"]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("Imported by");
    expect(human.stdout).toContain("src/index.ts");

    const json = await runCli(["impact", repoPath, "src/util.ts", "--json"]);
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.impacts[0].file).toBe("src/util.ts");
    expect(parsed.impacts[0].importedBy).toContain("src/index.ts");
  }, 60_000);

  it("exits 1 for a file that was not scanned", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-impact-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["impact", repoPath, "src/does-not-exist.ts"]);
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("File not found");
  }, 60_000);

  it("finds impact and fails the cycle gate through exact aliases ahead of broad mappings", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-impact-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          paths: {
            "*": ["src/fallback.ts"],
            "@app/core": ["src/core.ts"],
          },
        },
      }),
      "main.ts": 'import "@app/core";',
      "src/core.ts": 'import "../main.js";',
      "src/fallback.ts": "export {};",
    });
    const impact = await runCli(["impact", repoPath, "src/core.ts", "--json"]);
    expect(impact.exitCode).toBe(0);
    expect(JSON.parse(impact.stdout).impacts[0].importedBy).toContain("main.ts");
    const cycles = await runCli(["cycles", repoPath, "--json", "--check"]);
    expect(cycles.exitCode).toBe(1);
    const report = JSON.parse(cycles.stdout);
    expect(report.cycleCount).toBe(1);
    expect(report.cycles[0].files.sort()).toEqual(["main.ts", "src/core.ts"]);
  }, 60_000);
});
