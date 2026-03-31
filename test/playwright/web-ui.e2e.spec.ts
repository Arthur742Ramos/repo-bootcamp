import { execFileSync } from "child_process";
import { once } from "events";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { pathToFileURL } from "url";

import { expect, test } from "@playwright/test";

import type { RepoFacts } from "../../src/types.js";
import { getAvailablePort, spawnCli, waitForHttpReady, waitForOutput } from "../e2e/helpers.js";

async function createFixtureRepo(baseDir: string): Promise<string> {
  const repoDir = join(baseDir, "fixture-web-ui-repo");
  await mkdir(join(repoDir, "src"), { recursive: true });
  await mkdir(join(repoDir, "test"), { recursive: true });
  await mkdir(join(repoDir, ".github", "workflows"), { recursive: true });

  await writeFile(
    join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-web-ui-repo",
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
          typescript: "^5.0.0",
          vitest: "^4.0.0",
        },
      },
      null,
      2
    ),
    "utf-8"
  );
  await writeFile(
    join(repoDir, "README.md"),
    "# Fixture Web UI Repo\n\nA local repository used for browser end-to-end coverage.\n",
    "utf-8"
  );
  await writeFile(
    join(repoDir, "src", "index.ts"),
    'import express from "express";\nexport const app = express();\n',
    "utf-8"
  );
  await writeFile(
    join(repoDir, "test", "index.test.ts"),
    'import { app } from "../src/index";\nconsole.log(Boolean(app));\n',
    "utf-8"
  );
  await writeFile(
    join(repoDir, ".github", "workflows", "ci.yml"),
    "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
    "utf-8"
  );

  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], { cwd: repoDir, stdio: "ignore" });

  return repoDir;
}

async function createBareRepo(sourceRepoPath: string, baseDir: string): Promise<string> {
  const bareRepoPath = join(baseDir, "fixture-web-ui-remote.git");
  execFileSync("git", ["clone", "--bare", sourceRepoPath, bareRepoPath], { stdio: "ignore" });
  return bareRepoPath;
}

function buildMockFacts(repoName: string): RepoFacts {
  return {
    repoName,
    purpose: "A local fixture repo for browser end-to-end web coverage",
    description: "Minimal Express application used to verify the live web demo flow.",
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
      overview: "Small Express application with a single entrypoint.",
      components: [
        { name: "Application", description: "Express app bootstrap", directory: "src/" },
      ],
      dataFlow: "Browser or CLI -> app logic -> response",
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

test.describe("web UI", () => {
  const tempDirs: string[] = [];
  const children: ReturnType<typeof spawnCli>[] = [];

  test.afterEach(async () => {
    await Promise.all(
      children.map(async ({ child }) => {
        if (child.exitCode === null) {
          child.kill("SIGTERM");
          await once(child, "close");
        }
      })
    );
    children.length = 0;

    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  test("submits analysis, streams progress, and opens generated files in the browser", async ({ page }) => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-web-ui-e2e-"));
    tempDirs.push(tempDir);

    const repoPath = await createFixtureRepo(tempDir);
    const bareRepoPath = await createBareRepo(repoPath, tempDir);
    const port = await getAvailablePort();
    const repoUrl = "https://github.com/test/fixture-web-ui-repo";
    const responseFile = join(tempDir, "mock-response.json");
    const repoName = `test/${basename(repoPath)}`;
    await writeFile(responseFile, JSON.stringify(buildMockFacts(repoName), null, 2), "utf-8");

    const bareRepoUrl = pathToFileURL(bareRepoPath).href;
    const serverProcess = spawnCli(
      ["web", "--port", String(port)],
      {
        NODE_ENV: "test",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.${bareRepoUrl}.insteadOf`,
        GIT_CONFIG_VALUE_0: `${repoUrl}.git`,
      },
      tempDir
    );
    children.push(serverProcess);

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForOutput(serverProcess.getOutput, "Server running at:", 30_000);
    try {
      await waitForHttpReady(`${baseUrl}/`);
    } catch (error: unknown) {
      const { stdout, stderr } = serverProcess.getOutput();
      throw new Error(
        `Web server failed to become reachable: ${(error as Error).message}\n\nstdout:\n${stdout || "(empty)"}\n\nstderr:\n${stderr || "(empty)"}`
      );
    }

    await page.goto(baseUrl);

    await expect(page.getByRole("heading", { name: "Repo Bootcamp" })).toBeVisible();
    await page.locator("#repoUrl").fill(repoUrl);
    await page.locator("#analyzeBtn").click();

    await expect(page.locator("#progress")).toBeVisible();
    await expect(page.locator("#progress")).toContainText("Parsing repository URL...");
    await expect(page.locator("#progress")).toContainText("Bootcamp generated successfully!", {
      timeout: 90_000,
    });

    await expect(page.locator("#analyzeBtn")).toHaveText("Analyze");
    await expect(page.locator("#results")).toHaveClass(/show/);
    await expect(page.locator("#stats")).toContainText("Security Score");
    await expect(page.locator("#stats")).toContainText("Onboarding Risk");
    await expect(page.locator("#files")).toContainText("BOOTCAMP.md");
    await expect(page.locator("#files")).toContainText("repo_facts.json");

    await page.locator('[data-file="BOOTCAMP.md"]').click();
    await expect(page.locator("#modal")).toHaveClass(/show/);
    await expect(page.locator("#modalTitle")).toHaveText("BOOTCAMP.md");
    await expect(page.locator("#modalContent")).toContainText("fixture-web-ui-repo");

    await page.keyboard.press("Escape");
    await expect(page.locator("#modal")).toBeHidden();

    const { stderr } = serverProcess.getOutput();
    expect(stderr).not.toContain("Analysis failed");
    expect(stderr).not.toContain("Document generation failed");
  });
});
