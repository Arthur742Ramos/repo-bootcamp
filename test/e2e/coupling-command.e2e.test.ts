import { execFileSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

async function createRepo(baseDir: string, files: Record<string, string>): Promise<string> {
  const repoDir = join(baseDir, "fixture-coupling-repo");
  await mkdir(repoDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(repoDir, relativePath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], { cwd: repoDir, stdio: "ignore" });
  return repoDir;
}

// types.ts <- util.ts <- index.ts (entry); dead.ts is imported by nothing.
const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fixture-coupling-repo", version: "1.0.0" }, null, 2),
  "README.md": "# Fixture Coupling Repo\n",
  "src/types.ts": "export type T = number;\n",
  "src/util.ts": 'import type { T } from "./types.js";\nexport const u: T = 1;\n',
  "src/index.ts": 'import { u } from "./util.js";\n\nconsole.log(u);\n',
  "src/dead.ts": "export const unused = 42;\n",
};

describe("coupling command", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("prints a module coupling report for a local repo", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-coupling-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["coupling", repoPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Module Coupling");
    expect(result.stdout).toContain("Load-bearing core");
    expect(result.stdout).toContain("Orchestrators");
  }, 60_000);

  it("emits coupling JSON: core ranks depended-upon modules, orphans flags dead.ts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-coupling-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["coupling", repoPath, "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    const coreFiles = parsed.core.map((m: { file: string }) => m.file);
    expect(coreFiles).toContain("src/types.ts");
    expect(coreFiles).toContain("src/util.ts");
    expect(parsed.orphans).toContain("src/dead.ts");
  }, 60_000);
});
