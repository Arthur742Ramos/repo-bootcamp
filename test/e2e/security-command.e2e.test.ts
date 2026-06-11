import { execFileSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

async function createRepo(
  baseDir: string,
  files: Record<string, string>
): Promise<string> {
  const repoDir = join(baseDir, "fixture-security-repo");
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

const SECURE_FILES: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "fixture-security-repo",
      version: "1.0.0",
      dependencies: { helmet: "^8.0.0", "express-rate-limit": "^8.0.0", zod: "^4.0.0" },
    },
    null,
    2
  ),
  "README.md": "# Fixture Security Repo\n",
  ".gitignore": ".env\nnode_modules\n",
  ".env.example": "API_KEY=\n",
  "src/index.ts":
    'import helmet from "helmet";\nimport rateLimit from "express-rate-limit";\nexport const x = process.env.PORT;\n',
};

describe("security command", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("prints a human-readable security report for a local repo", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-security-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, SECURE_FILES);

    const result = await runCli(["security", repoPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Security Analysis");
    expect(result.stdout).toContain("/100");
    expect(result.stdout).toContain("Protections");
  }, 60_000);

  it("emits machine-readable JSON with --json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-security-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, SECURE_FILES);

    const result = await runCli(["security", repoPath, "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(typeof parsed.score).toBe("number");
    expect(typeof parsed.grade).toBe("string");
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(parsed.headers.hasHelmet).toBe(true);
    expect(parsed.hasRateLimiting).toBe(true);
    expect(parsed.securityDeps.some((d: { name: string }) => d.name === "helmet")).toBe(true);
  }, 60_000);

  it("supports the --check gate (passes with a low minimum, fails with an impossible one)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-security-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, SECURE_FILES);

    const passing = await runCli(["security", repoPath, "--check", "--min-score", "0"]);
    expect(passing.exitCode).toBe(0);

    const failing = await runCli(["security", repoPath, "--check", "--min-score", "101"]);
    expect(failing.exitCode).toBe(1);
    expect(`${failing.stdout}\n${failing.stderr}`).toContain("below the required minimum");
  }, 60_000);
});
