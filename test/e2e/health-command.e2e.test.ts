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
  const repoDir = join(baseDir, "fixture-health-repo");
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

const HEALTHY_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fixture-health-repo", version: "1.0.0" }, null, 2),
  "README.md": `# Fixture Health Repo\n\n${"Detailed onboarding documentation. ".repeat(60)}`,
  LICENSE: "MIT License\n",
  "CONTRIBUTING.md": "# Contributing\n\nRun the tests before opening a PR.\n",
  "CHANGELOG.md": "# Changelog\n",
  "CODE_OF_CONDUCT.md": "# Code of Conduct\n",
  "SECURITY.md": "# Security Policy\n",
  ".github/ISSUE_TEMPLATE/bug.yml": "name: Bug\n",
  ".github/PULL_REQUEST_TEMPLATE.md": "## Description\n",
  ".github/CODEOWNERS": "* @owner\n",
  ".github/workflows/ci.yml": "name: CI\non: [push]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
  ".github/dependabot.yml": "version: 2\n",
  ".eslintrc.json": "{}\n",
  ".prettierrc": "{}\n",
  ".editorconfig": "root = true\n",
  ".gitignore": "node_modules\n",
  ".husky/pre-commit": "npm test\n",
  "src/index.ts": "export const x = 1;\n",
  "test/index.test.ts": "import '../src/index';\n",
};

const BARE_FILES: Record<string, string> = {
  "src/index.ts": "export const x = 1;\n",
  "src/app.ts": "export const y = 2;\n",
};

describe("health command", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("prints a human-readable health report for a local repo", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-health-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, HEALTHY_FILES);

    const result = await runCli(["health", repoPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Repo Health");
    expect(result.stdout).toContain("/100");
    expect(result.stdout).toContain("Documentation");
    expect(result.stdout).toContain("Automation");
  }, 60_000);

  it("emits machine-readable JSON with --json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-health-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, HEALTHY_FILES);

    const result = await runCli(["health", repoPath, "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(typeof parsed.score).toBe("number");
    expect(parsed.score).toBeGreaterThanOrEqual(90);
    expect(parsed.grade).toBe("A");
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.length).toBeGreaterThan(0);
  }, 60_000);

  it("fails the --check gate for a bare repo and passes it with a low minimum", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-health-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, BARE_FILES);

    const failing = await runCli(["health", repoPath, "--check", "--min-score", "70"]);
    expect(failing.exitCode).toBe(1);
    expect(`${failing.stdout}\n${failing.stderr}`).toContain("below the required minimum");

    const passing = await runCli(["health", repoPath, "--check", "--min-score", "0"]);
    expect(passing.exitCode).toBe(0);
  }, 60_000);

  it("honors --max-files (routed past the root option collision)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-health-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, HEALTHY_FILES);

    const limited = await runCli(["health", repoPath, "--json", "--max-files", "3"]);
    expect(limited.exitCode).toBe(0);
    const limitedParsed = JSON.parse(limited.stdout);
    expect(limitedParsed.filesScanned).toBeLessThanOrEqual(3);

    const full = await runCli(["health", repoPath, "--json"]);
    const fullParsed = JSON.parse(full.stdout);
    expect(fullParsed.filesScanned).toBeGreaterThan(3);
  }, 60_000);
});
