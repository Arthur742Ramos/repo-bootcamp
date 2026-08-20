import { execFileSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

async function createRepo(baseDir: string, files: Record<string, string>): Promise<string> {
  const repoDir = join(baseDir, "fixture-scan-repo");
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
  "package.json": JSON.stringify(
    { name: "fixture-scan-repo", version: "1.0.0", dependencies: { helmet: "^8.0.0" } },
    null,
    2
  ),
  "README.md": `# Fixture Scan Repo\n\n${"Onboarding docs. ".repeat(40)}`,
  LICENSE: "MIT\n",
  ".gitignore": ".env\n",
  "src/index.ts": 'import helmet from "helmet";\nexport const x = 1;\n'.repeat(5),
  "test/index.test.ts": "import '../src/index';\n",
};

describe("scan command", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("prints a combined health/metrics/security dashboard for a local repo", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-scan-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["scan", repoPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Repository Scan");
    expect(result.stdout).toContain("Health");
    expect(result.stdout).toContain("Metrics");
    expect(result.stdout).toContain("Security");
    expect(result.stdout).toContain("Onboarding");
  }, 60_000);

  it("emits combined JSON with --json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-scan-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["scan", repoPath, "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(typeof parsed.scores.health.score).toBe("number");
    expect(typeof parsed.scores.metrics.score).toBe("number");
    expect(typeof parsed.scores.security.score).toBe("number");
    expect(typeof parsed.scores.onboardingRisk.score).toBe("number");
    expect(typeof parsed.scores.lowest).toBe("number");
    // Full per-area reports are embedded.
    expect(parsed.health.checks).toBeDefined();
    expect(parsed.metrics.approachability).toBeDefined();
    expect(parsed.security.headers).toBeDefined();
    expect(parsed.onboardingRisk.factors).toBeDefined();
  }, 60_000);

  it("supports the --check gate on the lowest score", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-scan-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const passing = await runCli(["scan", repoPath, "--check", "--min-score", "0"]);
    expect(passing.exitCode).toBe(0);

    const failing = await runCli(["scan", repoPath, "--check", "--min-score", "101"]);
    expect(failing.exitCode).toBe(1);
    expect(`${failing.stdout}\n${failing.stderr}`).toContain("below the required minimum");
  }, 60_000);
});
