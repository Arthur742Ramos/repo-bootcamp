import { execFileSync } from "child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import type { RepoFacts } from "../../src/types.js";
import { runCli } from "./helpers.js";

async function createFixtureRepo(baseDir: string): Promise<string> {
  const repoDir = join(baseDir, "fixture-cli-repo");
  await mkdir(join(repoDir, "src"), { recursive: true });
  await mkdir(join(repoDir, "test"), { recursive: true });
  await mkdir(join(repoDir, ".github", "workflows"), { recursive: true });

  await writeFile(
    join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-cli-repo",
        version: "1.0.0",
        engines: { node: ">=20.0.0" },
        scripts: {
          build: "echo build",
          test: "echo test",
        },
        dependencies: {
          express: "^5.1.0",
        },
        devDependencies: {
          vitest: "^4.0.0",
          typescript: "^5.0.0",
        },
      },
      null,
      2
    ),
    "utf-8"
  );

  await writeFile(
    join(repoDir, "README.md"),
    "# Fixture CLI Repo\n\nA local repository used for CLI end-to-end tests.\n",
    "utf-8"
  );
  await writeFile(
    join(repoDir, "src", "index.ts"),
    'import express from "express";\nexport const app = express();\n',
    "utf-8"
  );
  await writeFile(
    join(repoDir, "src", "utils.ts"),
    "export function sum(a: number, b: number) {\n  return a + b;\n}\n",
    "utf-8"
  );
  await writeFile(
    join(repoDir, "test", "utils.test.ts"),
    'import { sum } from "../src/utils";\nconsole.log(sum(1, 2));\n',
    "utf-8"
  );
  await writeFile(
    join(repoDir, ".github", "workflows", "ci.yml"),
    "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
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

function buildMockFacts(repoName: string): RepoFacts {
  return {
    repoName,
    purpose: "A local fixture repo for end-to-end CLI coverage",
    description: "Minimal Express application used to verify the full generator command.",
    confidence: "high",
    sources: ["README.md", "package.json"],
    stack: {
      languages: ["TypeScript"],
      frameworks: ["Express"],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: true,
    },
    quickstart: {
      prerequisites: ["Node.js 20+"],
      steps: ["npm install", "npm test"],
      commands: [
        { name: "test", command: "npm test", source: "package.json" },
        { name: "build", command: "npm run build", source: "package.json" },
      ],
      commonErrors: [],
      sources: ["README.md"],
    },
    structure: {
      keyDirs: [{ path: "src/", purpose: "Source code", keyFiles: ["src/index.ts"] }],
      entrypoints: [{ path: "src/index.ts", type: "main", description: "Express app entrypoint" }],
      testDirs: ["test"],
      docsDirs: [],
      sources: ["src/index.ts", "package.json"],
    },
    ci: {
      workflows: [
        {
          name: "CI",
          file: ".github/workflows/ci.yml",
          triggers: ["push"],
          mainSteps: ["npm test"],
        },
      ],
      mainChecks: ["Tests pass"],
      sources: [".github/workflows/ci.yml"],
    },
    contrib: {
      howToAddFeature: ["Create code in src/", "Add or update tests"],
      howToAddTest: ["Add a .test.ts file in test/"],
      codeStyle: "TypeScript with straightforward module structure",
      sources: ["README.md"],
    },
    architecture: {
      overview: "Small Express application with a utility module and a single entrypoint.",
      components: [
        { name: "Application", description: "Express app bootstrap", directory: "src/" },
      ],
      dataFlow: "CLI or HTTP interaction -> app logic -> response",
      keyAbstractions: [{ name: "app", description: "Express application instance" }],
      codeExamples: [
        {
          title: "Express app bootstrap",
          file: "src/index.ts",
          code: "export const app = express();",
          explanation: "Initializes the application instance exported by the module.",
        },
      ],
      sources: ["src/index.ts"],
    },
    firstTasks: [
      {
        title: "Add a health check route",
        description: "Expose a `/health` endpoint for smoke checks.",
        difficulty: "beginner",
        category: "feature",
        files: ["src/index.ts"],
        why: "It touches the entrypoint and produces an immediately testable improvement.",
      },
    ],
    runbook: {
      applicable: false,
      deploySteps: [],
      observability: [],
      incidents: [],
      sources: [],
    },
  };
}

describe("bootcamp CLI", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("generates the onboarding kit through the real CLI process", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-cli-e2e-"));
    tempDirs.push(tempDir);

    const repoPath = await createFixtureRepo(tempDir);
    const outputDir = join(tempDir, "bootcamp-output");
    const responseFile = join(tempDir, "mock-response.json");
    const repoName = `local/${basename(repoPath)}`;
    await writeFile(responseFile, JSON.stringify(buildMockFacts(repoName), null, 2), "utf-8");

    const result = await runCli([repoPath, "--no-clone", "--output", outputDir, "--style", "oss"], {
      NODE_ENV: "test",
      REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Bootcamp Generated Successfully");
    expect(result.stderr).not.toContain("Analysis failed");
    expect(result.stderr).not.toContain("Document generation failed");

    const writtenFiles = await readdir(outputDir);
    expect(writtenFiles).toEqual(
      expect.arrayContaining([
        "BOOTCAMP.md",
        "ONBOARDING.md",
        "ARCHITECTURE.md",
        "CODEMAP.md",
        "FIRST_TASKS.md",
        "SECURITY.md",
        "RADAR.md",
        "DEPENDENCIES.md",
        "METRICS.md",
        "HEALTH.md",
        "diagrams.mmd",
        "repo_facts.json",
      ])
    );

    const health = await readFile(join(outputDir, "HEALTH.md"), "utf-8");
    expect(health).toContain("# Repo Health");
    expect(health).toContain("## Onboarding Readiness");

    const facts = JSON.parse(await readFile(join(outputDir, "repo_facts.json"), "utf-8"));
    expect(facts.repoName).toBe(repoName);
    expect(facts.stack.frameworks).toContain("Express");

    const bootcamp = await readFile(join(outputDir, "BOOTCAMP.md"), "utf-8");
    expect(bootcamp).toContain("fixture-cli-repo");
  }, 90_000);
  it.each(["html", "pdf"] as const)(
    "generates a navigable %s kit through the real CLI",
    async (format) => {
      const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-export-cli-"));
      tempDirs.push(tempDir);
      const repoPath = await createFixtureRepo(tempDir);
      const outputDir = join(tempDir, "output");
      const responseFile = join(tempDir, "mock-response.json");
      await writeFile(responseFile, JSON.stringify(buildMockFacts(`local/${basename(repoPath)}`)));
      const result = await runCli(
        [repoPath, "--no-clone", "--no-cache", "--output", outputDir, "--format", format],
        { NODE_ENV: "test", REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile }
      );
      expect(result.exitCode).toBe(0);
      const files = await readdir(outputDir);
      expect(files).toContain("ONBOARDING.html");
      expect(files).not.toContain("ONBOARDING.md");
      const bootcamp = await readFile(join(outputDir, "BOOTCAMP.html"), "utf-8");
      expect(bootcamp).toContain('href="./ONBOARDING.html"');
      expect(bootcamp).toContain('href="./ARCHITECTURE.html"');
      const tasks = await readFile(join(outputDir, "FIRST_TASKS.html"), "utf-8");
      expect(tasks).toContain('href="./ARCHITECTURE.html"');
      for (const file of files.filter((name) => name.endsWith(".html"))) {
        const content = await readFile(join(outputDir, file), "utf-8");
        for (const match of content.matchAll(/href="\.\/([^"?#]+\.html)(?:[?#][^"]*)?"/g)) {
          expect(files).toContain(decodeURIComponent(match[1]));
        }
      }
    },
    90_000
  );

  it("generates extended analysis from the selected package instead of the outer manifest", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-scoped-cli-"));
    tempDirs.push(tempDir);
    const repoPath = await createFixtureRepo(tempDir);
    const subdir = "packages/app";
    const selectedRoot = join(repoPath, subdir);
    await mkdir(join(selectedRoot, "src"), { recursive: true });
    await writeFile(
      join(selectedRoot, "package.json"),
      JSON.stringify({ name: "selected-app", dependencies: { "child-runtime": "^1.0.0" } })
    );
    await writeFile(join(selectedRoot, "README.md"), "# Selected package\n");
    await writeFile(join(selectedRoot, "src", "index.ts"), "export const publicValue = true;\n");
    execFileSync("git", ["add", "packages"], { cwd: repoPath });
    execFileSync("git", ["commit", "-m", "add child", "--no-gpg-sign"], {
      cwd: repoPath,
      stdio: "ignore",
    });
    await writeFile(
      join(selectedRoot, "src", "index.ts"),
      "const token = process.env.CHILD_TOKEN;\n"
    );
    execFileSync("git", ["add", "packages"], { cwd: repoPath });
    execFileSync("git", ["commit", "-m", "change child", "--no-gpg-sign"], {
      cwd: repoPath,
      stdio: "ignore",
    });
    const outputDir = join(tempDir, "output");
    const responseFile = join(tempDir, "mock-response.json");
    await writeFile(responseFile, JSON.stringify(buildMockFacts(`local/${basename(repoPath)}`)));
    const result = await runCli(
      [
        repoPath,
        "--no-clone",
        "--subdir",
        subdir,
        "--no-cache",
        "--compare",
        "HEAD~1",
        "--output",
        outputDir,
      ],
      {
        NODE_ENV: "test",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile,
      }
    );
    expect(result.exitCode).toBe(0);
    const dependencies = await readFile(join(outputDir, "DEPENDENCIES.md"), "utf-8");
    expect(dependencies).toContain("child-runtime");
    expect(dependencies).not.toContain("express");
    const diff = await readFile(join(outputDir, "DIFF.md"), "utf-8");
    expect(diff).toContain("CHILD_TOKEN");
    expect(diff).toContain("publicValue");
    const summary = JSON.parse(await readFile(join(outputDir, "summary.json"), "utf-8"));
    expect(summary.deps).toEqual({ total: 1, runtime: 1, dev: 0 });
    expect(
      JSON.parse(await readFile(join(repoPath, "package.json"), "utf-8")).dependencies
    ).toHaveProperty("express");
  }, 90_000);
});
