/**
 * E2E smoke test
 *
 * Creates a minimal test fixture repo on disk, clones it, runs the full pipeline
 * (scan → generate), and verifies all expected output files are produced.
 *
 * The Copilot SDK analysis step is bypassed by providing mock RepoFacts,
 * since it requires authentication. Everything else runs for real.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import { scanRepo, mergeFrameworksFromDeps } from "../src/ingest.js";
import { extractDependencies, generateDependencyDocs } from "../src/deps.js";
import { analyzeSecurityPatterns, generateSecurityDocs } from "../src/security.js";
import { generateTechRadar, generateRadarDocs } from "../src/radar.js";
import { buildImportGraph, analyzeChangeImpact, generateImpactDocs, getKeyFilesForImpact } from "../src/impact.js";
import { runParallelAnalysis } from "../src/index.js";
import {
  generateBootcamp,
  generateOnboarding,
  generateArchitecture,
  generateCodemap,
  generateFirstTasks,
  generateRunbook,
  generateDiagrams,
} from "../src/generator.js";
import type { RepoFacts, BootcampOptions, RepoInfo } from "../src/types.js";

/** Minimal fixture repo layout */
async function createFixtureRepo(baseDir: string): Promise<string> {
  const repoDir = join(baseDir, "fixture-source");
  await mkdir(repoDir, { recursive: true });

  // package.json
  await writeFile(
    join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-repo",
        version: "1.0.0",
        scripts: { test: "echo ok", build: "echo build" },
        dependencies: { express: "^4.18.0" },
        devDependencies: { vitest: "^1.0.0" },
      },
      null,
      2,
    ),
  );

  // README
  await writeFile(join(repoDir, "README.md"), "# Fixture Repo\nA tiny repo for E2E testing.\n");

  // Source files
  await mkdir(join(repoDir, "src"), { recursive: true });
  await writeFile(
    join(repoDir, "src", "index.ts"),
    'import express from "express";\nconst app = express();\napp.listen(3000);\n',
  );
  await writeFile(
    join(repoDir, "src", "utils.ts"),
    'export function add(a: number, b: number) { return a + b; }\n',
  );

  // Test file
  await mkdir(join(repoDir, "test"), { recursive: true });
  await writeFile(
    join(repoDir, "test", "utils.test.ts"),
    'import { add } from "../src/utils";\nconsole.log(add(1, 2));\n',
  );

  // CI workflow
  await mkdir(join(repoDir, ".github", "workflows"), { recursive: true });
  await writeFile(
    join(repoDir, ".github", "workflows", "ci.yml"),
    "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm test\n",
  );

  // Init a git repo so scanRepo works in a realistic context
  execSync("git init && git add -A && git commit -m init --no-gpg-sign", {
    cwd: repoDir,
    stdio: "ignore",
  });

  return repoDir;
}

function cloneFixtureRepo(baseDir: string, sourceRepoPath: string): string {
  const cloneDir = join(baseDir, "fixture-repo");
  execSync(`git clone --quiet "${sourceRepoPath}" "${cloneDir}"`, {
    cwd: baseDir,
    stdio: "ignore",
  });
  return cloneDir;
}

/** Realistic mock facts matching the fixture repo */
function buildMockFacts(): RepoFacts {
  return {
    repoName: "test/fixture-repo",
    purpose: "A tiny repo for E2E testing",
    description: "Minimal Express server used as a test fixture.",
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
      prerequisites: ["Node.js 18+"],
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
      entrypoints: [{ path: "src/index.ts", type: "main", description: "Express server" }],
      testDirs: ["test"],
      docsDirs: [],
      sources: ["package.json"],
    },
    ci: {
      workflows: [{ name: "CI", file: ".github/workflows/ci.yml", triggers: ["push"], mainSteps: ["npm test"] }],
      mainChecks: ["Tests pass"],
      sources: [".github/workflows/ci.yml"],
    },
    contrib: {
      howToAddFeature: ["Create file in src/", "Add tests"],
      howToAddTest: ["Add .test.ts file in test/"],
      codeStyle: "Standard TypeScript",
      sources: ["README.md"],
    },
    architecture: {
      overview: "Simple Express server",
      components: [{ name: "Server", description: "HTTP server", directory: "src" }],
      dataFlow: "Request → Express → Response",
      keyAbstractions: [{ name: "app", description: "Express application instance" }],
      codeExamples: [
        {
          title: "Server startup",
          file: "src/index.ts",
          code: 'app.listen(3000)',
          explanation: "Starts the HTTP server",
        },
      ],
      sources: ["src/index.ts"],
    },
    firstTasks: [
      {
        title: "Add health endpoint",
        description: "Add GET /health returning 200",
        difficulty: "beginner",
        category: "feature",
        files: ["src/index.ts"],
        why: "Good first task",
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

const DEFAULT_OPTIONS: BootcampOptions = {
  branch: "main",
  focus: "all",
  audience: "oss-contributor",
  output: "",
  maxFiles: 200,
  noClone: false,
  verbose: false,
};

describe("E2E smoke test", () => {
  let tmpDir: string;
  let repoPath: string;
  let outputDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "bootcamp-e2e-"));
    const sourceRepoPath = await createFixtureRepo(tmpDir);
    repoPath = cloneFixtureRepo(tmpDir, sourceRepoPath);
    outputDir = join(tmpDir, "output");
    await mkdir(outputDir, { recursive: true });
  }, 30_000);

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("scans the fixture repo and detects stack correctly", async () => {
    const scan = await scanRepo(repoPath, 200);

    expect(scan.files.length).toBeGreaterThan(0);
    expect(scan.stack.languages).toContain("TypeScript");
    expect(scan.stack.hasCi).toBe(true);
    expect(scan.commands.length).toBeGreaterThan(0);
    expect(scan.readme).toContain("Fixture Repo");
  });

  it("extracts dependencies from the fixture repo", async () => {
    const deps = await extractDependencies(repoPath);

    expect(deps).not.toBeNull();
    expect(deps!.runtime.some((d) => d.name === "express")).toBe(true);
    expect(deps!.dev.some((d) => d.name === "vitest")).toBe(true);
  });

  it("runs the full generate pipeline and produces all expected output files", async () => {
    const scan = await scanRepo(repoPath, 200);
    const facts = buildMockFacts();

    // Run all analyzers concurrently via runParallelAnalysis
    const { deps, security, radar, impacts } = await runParallelAnalysis(repoPath, scan);

    const repoInfo: RepoInfo = {
      owner: "test",
      repo: "fixture-repo",
      url: "https://github.com/test/fixture-repo",
      branch: "main",
      fullName: "test/fixture-repo",
    };

    // Build document list (mirrors index.ts logic)
    const documents = [
      { name: "BOOTCAMP.md", content: generateBootcamp(facts, DEFAULT_OPTIONS) },
      { name: "ONBOARDING.md", content: generateOnboarding(facts) },
      { name: "ARCHITECTURE.md", content: generateArchitecture(facts) },
      { name: "CODEMAP.md", content: generateCodemap(facts) },
      { name: "FIRST_TASKS.md", content: generateFirstTasks(facts) },
      { name: "RUNBOOK.md", content: generateRunbook(facts) },
      { name: "diagrams.mmd", content: generateDiagrams(facts) },
      { name: "repo_facts.json", content: JSON.stringify(facts, null, 2) },
      { name: "SECURITY.md", content: generateSecurityDocs(security, repoInfo.repo) },
      { name: "RADAR.md", content: generateRadarDocs(radar, repoInfo.repo) },
    ];

    if (deps) {
      documents.push({ name: "DEPENDENCIES.md", content: generateDependencyDocs(deps, repoInfo.repo) });
    }

    if (impacts.length > 0) {
      documents.push({ name: "IMPACT.md", content: generateImpactDocs(impacts, repoInfo.repo) });
    }

    // Write all files
    for (const doc of documents) {
      await writeFile(join(outputDir, doc.name), doc.content, "utf-8");
    }

    // --- Assertions ---

    const expectedFiles = [
      "BOOTCAMP.md",
      "ONBOARDING.md",
      "ARCHITECTURE.md",
      "CODEMAP.md",
      "FIRST_TASKS.md",
      "RUNBOOK.md",
      "diagrams.mmd",
      "repo_facts.json",
      "SECURITY.md",
      "RADAR.md",
      "DEPENDENCIES.md",
      "IMPACT.md",
    ];

    const writtenFiles = await readdir(outputDir);
    for (const expected of expectedFiles) {
      expect(writtenFiles, `Missing output file: ${expected}`).toContain(expected);
    }

    // Verify non-empty content
    for (const expected of expectedFiles) {
      const content = await readFile(join(outputDir, expected), "utf-8");
      expect(content.length, `${expected} should not be empty`).toBeGreaterThan(0);
    }

    // Spot-check content quality
    const bootcamp = await readFile(join(outputDir, "BOOTCAMP.md"), "utf-8");
    expect(bootcamp).toContain("fixture-repo");

    const factsJson = JSON.parse(await readFile(join(outputDir, "repo_facts.json"), "utf-8"));
    expect(factsJson.repoName).toBe("test/fixture-repo");
    expect(factsJson.stack.languages).toContain("TypeScript");
  }, 30_000);
});
