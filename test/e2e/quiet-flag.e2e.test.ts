import { execFileSync } from "child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import type { RepoFacts } from "../../src/types.js";
import { runCli } from "./helpers.js";

async function createFixtureRepo(baseDir: string): Promise<string> {
  const repoDir = join(baseDir, "fixture-quiet-repo");
  await mkdir(join(repoDir, "src"), { recursive: true });

  await writeFile(
    join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-quiet-repo",
        version: "1.0.0",
        engines: { node: ">=20.0.0" },
        dependencies: { express: "^5.1.0" },
      },
      null,
      2
    ),
    "utf-8"
  );
  await writeFile(
    join(repoDir, "README.md"),
    "# Fixture Quiet Repo\n\nA local repository used for --quiet end-to-end tests.\n",
    "utf-8"
  );
  await writeFile(
    join(repoDir, "src", "index.ts"),
    'import express from "express";\nexport const app = express();\n',
    "utf-8"
  );

  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], { cwd: repoDir, stdio: "ignore" });

  return repoDir;
}

function buildMockFacts(repoName: string): RepoFacts {
  return {
    repoName,
    purpose: "Fixture repo for --quiet coverage",
    description: "Minimal Express app used to verify quiet output.",
    confidence: "high",
    sources: ["README.md", "package.json"],
    stack: {
      languages: ["TypeScript"],
      frameworks: ["Express"],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: false,
    },
    quickstart: {
      prerequisites: ["Node.js 20+"],
      steps: ["npm install"],
      commands: [{ name: "test", command: "npm test", source: "package.json" }],
      commonErrors: [],
      sources: ["README.md"],
    },
    structure: {
      keyDirs: [{ path: "src/", purpose: "Source code", keyFiles: ["src/index.ts"] }],
      entrypoints: [{ path: "src/index.ts", type: "main", description: "Express app entrypoint" }],
      testDirs: [],
      docsDirs: [],
      sources: ["src/index.ts", "package.json"],
    },
    ci: { workflows: [], mainChecks: [], sources: [] },
    contrib: {
      howToAddFeature: ["Create code in src/"],
      howToAddTest: ["Add a .test.ts file"],
      codeStyle: "TypeScript",
      sources: ["README.md"],
    },
    architecture: {
      overview: "Small Express application.",
      components: [{ name: "Application", description: "Express app bootstrap", directory: "src/" }],
      dataFlow: "HTTP -> app -> response",
      keyAbstractions: [{ name: "app", description: "Express application instance" }],
      codeExamples: [],
      sources: ["src/index.ts"],
    },
    firstTasks: [],
    runbook: { applicable: false, deploySteps: [], observability: [], incidents: [], sources: [] },
  };
}

describe("bootcamp CLI --quiet", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("suppresses the banner/progress chrome and prints only the output path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-quiet-e2e-"));
    tempDirs.push(tempDir);

    const repoPath = await createFixtureRepo(tempDir);
    const outputDir = join(tempDir, "bootcamp-output");
    const responseFile = join(tempDir, "mock-response.json");
    const repoName = `local/${basename(repoPath)}`;
    await writeFile(responseFile, JSON.stringify(buildMockFacts(repoName), null, 2), "utf-8");

    const result = await runCli(
      [repoPath, "--no-clone", "--quiet", "--output", outputDir, "--style", "oss"],
      {
        NODE_ENV: "test",
        NO_COLOR: "1",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile,
      }
    );

    expect(result.exitCode).toBe(0);

    // No decorative chrome.
    expect(result.stdout).not.toContain("Bootcamp Generated Successfully");
    expect(result.stdout).not.toContain("Detected Stack");
    expect(result.stdout).not.toContain("Next step");
    expect(result.stdout).not.toContain("Generated files");

    // stdout's last non-empty line is the output directory, ready to pipe.
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines[lines.length - 1].trim()).toBe(outputDir);

    // The docs were still produced.
    const writtenFiles = await readdir(outputDir);
    expect(writtenFiles).toEqual(expect.arrayContaining(["BOOTCAMP.md", "repo_facts.json"]));
  }, 90_000);

  it("rejects --quiet combined with --verbose", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-quiet-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createFixtureRepo(tempDir);

    const result = await runCli([repoPath, "--no-clone", "--quiet", "--verbose"], {
      NODE_ENV: "test",
      NO_COLOR: "1",
    });

    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("mutually exclusive");
  }, 60_000);
});
