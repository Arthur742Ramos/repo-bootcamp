import { execFileSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";
import { packageFacts } from "../helpers/package-scope.js";

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

  it("summarizes changes between real base and head scan reports", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-scan-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);
    const base = await runCli(["scan", repoPath, "--json"]);
    expect(base.exitCode).toBe(0);
    await writeFile(join(repoPath, "CONTRIBUTING.md"), "# Contributing\nRun the tests.\n");
    const head = await runCli(["scan", repoPath, "--json"]);
    expect(head.exitCode).toBe(0);
    const basePath = join(tempDir, "base.json");
    const headPath = join(tempDir, "head.json");
    await writeFile(basePath, base.stdout);
    await writeFile(headPath, head.stdout);
    const output = execFileSync(
      process.execPath,
      [resolve("scripts/onboarding-impact.mjs"), basePath, headPath],
      { encoding: "utf8" }
    );
    expect(output).toContain("| Contributing guide | fail | pass |");
    expect(output).toMatch(/\| Onboarding risk \| \d+ \| \d+ \| -10 \| lower is better \|/);
    expect(output).toContain("security score is not a security audit");
    await writeFile(headPath, '{"scores":{}}');
    expect(() =>
      execFileSync(
        process.execPath,
        [resolve("scripts/onboarding-impact.mjs"), basePath, headPath],
        {
          stdio: "pipe",
        }
      )
    ).toThrow();
  }, 60_000);

  it("benchmarks a pinned repository and saved guidance without running its commands", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-quality-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, {
      ...FILES,
      "package.json": JSON.stringify(
        { name: "fixture-scan-repo", scripts: { test: "exit 17" } },
        null,
        2
      ),
    });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoPath,
      encoding: "utf8",
    }).trim();
    const manifestPath = join(tempDir, "corpus.json");
    const manifest = {
      version: 1,
      cases: [
        {
          id: "fixture",
          repository: repoPath,
          commit,
          expected: [{ command: "npm run test", source: "package.json" }],
        },
      ],
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    const responses = join(tempDir, "responses");
    await mkdir(responses);
    const facts = packageFacts();
    facts.quickstart.commands = [
      {
        name: "test",
        command: "npm run test",
        source: "package.json",
        evidence: { path: "package.json", quote: '"test": "exit 17"' },
      },
    ];
    facts.firstTasks[0].evidence = { path: "README.md", quote: "not in the repository" };
    await writeFile(join(responses, "fixture.json"), JSON.stringify(facts));
    const globalGitConfig = join(tempDir, "gitconfig");
    await writeFile(
      globalGitConfig,
      `[url "https://example.invalid/blocked/"]\n\tinsteadOf = ${JSON.stringify(repoPath)}\n`
    );
    expect(
      execFileSync("git", ["ls-remote", "--get-url", repoPath], {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: globalGitConfig },
      }).trim()
    ).toBe("https://example.invalid/blocked/");
    const benchmark = resolve("scripts/benchmark-quality.mjs");
    const output = execFileSync(
      process.execPath,
      [benchmark, "--manifest", manifestPath, "--responses", responses, "--check"],
      {
        encoding: "utf8",
        timeout: 90_000,
        env: { ...process.env, GIT_CONFIG_GLOBAL: globalGitConfig },
      }
    );
    const result = JSON.parse(output);
    expect(result.mode).toBe("saved-responses");
    expect(result.totals).toEqual({ matched: 1, expected: 1 });
    expect(result.cases[0].generation.exactCommandMatches.matched).toBe(1);
    expect(result.cases[0].generation.matchedExcerpts).toBe(1);
    expect(result.cases[0].generation.guidanceItems).toBe(2);
    manifest.cases[0].expected[0].command = "npm run missing";
    await writeFile(manifestPath, JSON.stringify(manifest));
    expect(() =>
      execFileSync(process.execPath, [benchmark, "--manifest", manifestPath, "--check"], {
        stdio: "pipe",
        timeout: 90_000,
      })
    ).toThrow();
  }, 90_000);
});
