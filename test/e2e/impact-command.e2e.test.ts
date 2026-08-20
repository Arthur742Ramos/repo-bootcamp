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
});
