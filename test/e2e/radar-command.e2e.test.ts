import { execFileSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

async function createRepo(baseDir: string, files: Record<string, string>): Promise<string> {
  const repoDir = join(baseDir, "fixture-radar-repo");
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

// Has a README but intentionally no CONTRIBUTING guide, which guarantees at
// least one onboarding-risk factor (so the `--check --max-risk 0` gate fails).
const FILES: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "fixture-radar-repo",
      version: "1.0.0",
      dependencies: { express: "^5.0.0", helmet: "^8.0.0", zod: "^4.0.0" },
      devDependencies: { vitest: "^4.0.0" },
    },
    null,
    2
  ),
  "README.md": `# Fixture Radar Repo\n\n${"Onboarding docs. ".repeat(20)}`,
  "src/index.ts": 'import helmet from "helmet";\nexport const x = 1;\n',
};

describe("radar command", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("prints a tech-radar + onboarding-risk report for a local repo", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-radar-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["radar", repoPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Tech Radar");
    expect(result.stdout).toContain("Onboarding risk");
    expect(result.stdout).toContain("Modern");
    expect(result.stdout).toContain("Risky");
  }, 60_000);

  it("emits radar JSON with --json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-radar-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["radar", repoPath, "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(typeof parsed.onboardingRisk.score).toBe("number");
    expect(typeof parsed.onboardingRisk.grade).toBe("string");
    expect(Array.isArray(parsed.modern)).toBe(true);
    expect(Array.isArray(parsed.risky)).toBe(true);
  }, 60_000);

  it("supports the --check gate on onboarding risk", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-radar-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const passing = await runCli(["radar", repoPath, "--check", "--max-risk", "100"]);
    expect(passing.exitCode).toBe(0);

    const failing = await runCli(["radar", repoPath, "--check", "--max-risk", "0"]);
    expect(failing.exitCode).toBe(1);
    expect(`${failing.stdout}\n${failing.stderr}`).toContain("exceeds the maximum");
  }, 60_000);

  it("applies the source-size gate equally to classic and modern JS/TS modules", async () => {
    for (const extension of ["ts", "js", "mts", "cts", "mjs", "cjs"]) {
      const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-radar-source-size-e2e-"));
      tempDirs.push(tempDir);
      const files: Record<string, string> = {
        "package.json": JSON.stringify({ name: "source-size-oracle", version: "1.0.0" }),
        "README.md": `# Source-size oracle\n\n${"Onboarding docs. ".repeat(20)}`,
        "CONTRIBUTING.md": "# Contributing\n\nRun tests before submitting changes.\n",
        ".github/workflows/ci.yml":
          "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
        "tests/smoke.txt": "Test-presence oracle; no extra source-file count.\n",
      };
      for (let i = 0; i < 500; i++) {
        files[`src/module${i}.${extension}`] = "export const value = 1;\n";
      }
      // Preserve the existing .d.ts counting semantics for .d.mts/.d.cts.
      const extraFile = ["ts", "mts", "cts"].includes(extension)
        ? `src/types.d.${extension}`
        : `src/extra.${extension}`;
      files[extraFile] = extension.endsWith("ts")
        ? "export declare const value: number;\n"
        : "export const value = 1;\n";
      const repoPath = await createRepo(tempDir, files);
      const args = [
        "radar",
        repoPath,
        "--json",
        "--max-files",
        "1000",
        "--check",
        "--max-risk",
        "5",
      ];

      const aboveBoundary = await runCli(args);
      expect(aboveBoundary.exitCode, extension).toBe(1);
      expect(JSON.parse(aboveBoundary.stdout).onboardingRisk, extension).toEqual({
        score: 10,
        grade: "A",
        factors: ["Large codebase (501 source files)"],
      });

      await rm(join(repoPath, extraFile));
      const atBoundary = await runCli(args);
      expect(atBoundary.exitCode, extension).toBe(0);
      expect(JSON.parse(atBoundary.stdout).onboardingRisk, extension).toEqual({
        score: 0,
        grade: "A",
        factors: [],
      });
    }
  }, 60_000);
});
