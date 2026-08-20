import { execFileSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

async function createRepo(baseDir: string, files: Record<string, string>): Promise<string> {
  const repoDir = join(baseDir, "fixture-metrics-repo");
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

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fixture-metrics-repo", version: "1.0.0" }, null, 2),
  "README.md": `# Fixture Metrics Repo\n\n${"Onboarding docs. ".repeat(40)}`,
  "src/index.ts": "export const a = 1;\n".repeat(10),
  "src/util.ts": "export const b = 2;\n".repeat(20),
  "src/big.ts": "export const c = 3;\n".repeat(200),
  "src/helper.js": "module.exports = {};\n".repeat(5),
  "test/index.test.ts": "import '../src/index';\n".repeat(8),
  "test/util.test.ts": "import '../src/util';\n".repeat(8),
  "docs/guide.md": "# Guide\n".repeat(10),
};

describe("metrics command", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("prints a human-readable metrics report for a local repo", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-metrics-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["metrics", repoPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Codebase Metrics");
    expect(result.stdout).toContain("Approachability");
    expect(result.stdout).toContain("Languages");
    expect(result.stdout).toContain("TypeScript");
    expect(result.stdout).toContain("Largest files");
  }, 60_000);

  it("emits machine-readable JSON with --json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-metrics-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["metrics", repoPath, "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(typeof parsed.approachability.score).toBe("number");
    expect(typeof parsed.approachability.grade).toBe("string");
    expect(parsed.sizeClass).toBeDefined();
    expect(Array.isArray(parsed.languages)).toBe(true);
    expect(parsed.languages.some((l: { language: string }) => l.language === "TypeScript")).toBe(
      true
    );
    expect(Array.isArray(parsed.hotspots)).toBe(true);
    expect(parsed.sourceFiles).toBeGreaterThan(0);
    expect(parsed.testFiles).toBeGreaterThan(0);
  }, 60_000);

  it("supports the --check gate (passes with a low minimum, fails with an impossible one)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-metrics-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const passing = await runCli(["metrics", repoPath, "--check", "--min-score", "0"]);
    expect(passing.exitCode).toBe(0);

    const failing = await runCli(["metrics", repoPath, "--check", "--min-score", "101"]);
    expect(failing.exitCode).toBe(1);
    expect(`${failing.stdout}\n${failing.stderr}`).toContain("below the required minimum");
  }, 60_000);

  it("honors --max-files (routed past the root option collision)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-metrics-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const limited = await runCli(["metrics", repoPath, "--json", "--max-files", "3"]);
    expect(limited.exitCode).toBe(0);
    const limitedParsed = JSON.parse(limited.stdout);
    expect(limitedParsed.filesScanned).toBeLessThanOrEqual(3);

    const full = await runCli(["metrics", repoPath, "--json"]);
    const fullParsed = JSON.parse(full.stdout);
    expect(fullParsed.filesScanned).toBeGreaterThan(3);
  }, 60_000);
});
