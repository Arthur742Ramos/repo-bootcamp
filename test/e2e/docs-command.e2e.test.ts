import { execFileSync } from "child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

async function createStaleDocsFixture(baseDir: string): Promise<string> {
  const repoDir = join(baseDir, "fixture-docs-repo");
  await mkdir(repoDir, { recursive: true });

  await writeFile(
    join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-docs-repo",
        version: "1.0.0",
        engines: {
          node: ">=20.0.0",
        },
        dependencies: {
          express: "^5.1.0",
        },
      },
      null,
      2
    ),
    "utf-8"
  );

  await writeFile(
    join(repoDir, "README.md"),
    "# Fixture Docs Repo\n\nRequires Node.js 18.\n\n## Installation\n\nnpm install\n",
    "utf-8"
  );

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

describe("docs command", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("detects stale docs and fixes them through the real CLI process", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-docs-e2e-"));
    tempDirs.push(tempDir);

    const repoPath = await createStaleDocsFixture(tempDir);

    const checkResult = await runCli(["docs", repoPath, "--check"]);
    expect(checkResult.exitCode).toBe(1);
    expect(checkResult.stdout).toContain("Documentation is stale");

    const fixResult = await runCli(["docs", repoPath, "--fix"]);
    expect(fixResult.exitCode).toBe(0);
    expect(fixResult.stdout).toContain("Applying fixes");

    const readme = await readFile(join(repoPath, "README.md"), "utf-8");
    expect(readme).toContain("Node.js 20");
    expect(readme).toContain("## Tech Stack");
    expect(readme).toContain("Express");
  }, 90_000);
});
