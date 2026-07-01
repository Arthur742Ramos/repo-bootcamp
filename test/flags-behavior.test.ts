import { execSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearCache, readCache, writeCache } from "../src/cache.js";
import { generateBootcamp } from "../src/generator.js";
import { scanRepo } from "../src/ingest.js";
import { getStyleConfig, type BootcampConfig } from "../src/plugins.js";
import { ProgressTracker } from "../src/progress.js";
import { prepareOutputDocuments } from "../src/services/analysis-orchestration.js";
import { scanRepositoryFiles } from "../src/services/clone-service.js";
import type { BootcampOptions, RepoFacts, RepoInfo } from "../src/types.js";

interface FixtureRepo {
  rootDir: string;
  sourceRepoPath: string;
  bareRemotePath: string;
}

const DEFAULT_OPTIONS: BootcampOptions = {
  branch: "",
  focus: "all",
  audience: "backend",
  output: "",
  maxFiles: 200,
  noClone: false,
  verbose: false,
  style: "oss",
};

function runGit(command: string, cwd: string): void {
  execSync(command, { cwd, stdio: "ignore" });
}

async function createFixtureRepo(): Promise<FixtureRepo> {
  const rootDir = await mkdtemp(join(tmpdir(), "bootcamp-flags-"));
  const sourceRepoPath = join(rootDir, "fixture-source");
  const bareRemotePath = join(rootDir, "fixture-remote.git");

  await mkdir(join(sourceRepoPath, "src"), { recursive: true });
  await writeFile(
    join(sourceRepoPath, "package.json"),
    JSON.stringify(
      {
        name: "fixture-source",
        version: "1.0.0",
        scripts: {
          dev: "node src/index.js",
          test: "echo ok",
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
  await writeFile(join(sourceRepoPath, "README.md"), "# Fixture source\n", "utf-8");
  await writeFile(join(sourceRepoPath, "src", "index.ts"), "export const answer = 42;\n", "utf-8");
  await writeFile(join(sourceRepoPath, "src", "branch.txt"), "main\n", "utf-8");

  runGit("git init -b main", sourceRepoPath);
  runGit('git config user.email "test@example.com"', sourceRepoPath);
  runGit('git config user.name "Test User"', sourceRepoPath);
  runGit("git add -A", sourceRepoPath);
  runGit('git commit -m "main commit" --no-gpg-sign', sourceRepoPath);

  runGit("git checkout -b feature", sourceRepoPath);
  await writeFile(join(sourceRepoPath, "src", "branch.txt"), "feature\n", "utf-8");
  runGit("git add -A", sourceRepoPath);
  runGit('git commit -m "feature commit" --no-gpg-sign', sourceRepoPath);
  runGit("git checkout main", sourceRepoPath);

  execSync(`git clone --bare "${sourceRepoPath}" "${bareRemotePath}"`, {
    cwd: rootDir,
    stdio: "ignore",
  });

  return {
    rootDir,
    sourceRepoPath,
    bareRemotePath,
  };
}

function makeFacts(repoName = "local/fixture-source"): RepoFacts {
  return {
    repoName,
    purpose: "Fixture repo for behavior tests",
    description: "This fixture repository validates behavior-level CLI flows.",
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
      prerequisites: ["Node.js"],
      steps: ["npm install", "npm run dev"],
      commands: [
        { name: "install", command: "npm install", source: "package.json" },
        { name: "dev", command: "npm run dev", source: "package.json" },
      ],
      commonErrors: [],
      sources: ["README.md"],
    },
    structure: {
      keyDirs: [{ path: "src/", purpose: "Application code", keyFiles: ["src/index.ts"] }],
      entrypoints: [{ path: "src/index.ts", type: "main", description: "Main entry point" }],
      testDirs: ["test/"],
      docsDirs: [],
      sources: ["package.json"],
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
      mainChecks: ["npm test"],
      sources: [".github/workflows/ci.yml"],
    },
    contrib: {
      howToAddFeature: ["Create a branch", "Open a PR"],
      howToAddTest: ["Add tests under test/"],
      codeStyle: "TypeScript + ESLint",
      sources: ["README.md"],
    },
    architecture: {
      overview: "Small fixture app used by behavior tests.",
      components: [{ name: "App", description: "Fixture entrypoint", directory: "src/" }],
      dataFlow: "Input -> processing -> output",
      keyAbstractions: [{ name: "answer", description: "Sample export value" }],
      codeExamples: [
        {
          title: "Fixture entrypoint",
          file: "src/index.ts",
          code: "export const answer = 42;",
          explanation: "Exports a value for testing.",
        },
      ],
      sources: ["src/index.ts"],
    },
    firstTasks: [
      {
        title: "Add unit test",
        description: "Create a unit test for answer export.",
        difficulty: "beginner",
        category: "test",
        files: ["src/index.ts", "test/index.test.ts"],
        why: "Improves confidence quickly.",
      },
      {
        title: "Improve README",
        description: "Document local dev command.",
        difficulty: "beginner",
        category: "docs",
        files: ["README.md"],
        why: "Helps onboarding.",
      },
      {
        title: "Add lint rule",
        description: "Tighten lint rules for imports.",
        difficulty: "intermediate",
        category: "refactor",
        files: ["eslint.config.js"],
        why: "Keeps code quality steady.",
      },
      {
        title: "Add health endpoint",
        description: "Expose a basic health endpoint.",
        difficulty: "advanced",
        category: "feature",
        files: ["src/index.ts"],
        why: "Improves operability.",
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

describe("critical flag behavior", () => {
  it("changes BOOTCAMP output when style pack changes", () => {
    const facts = makeFacts();
    const startupDoc = generateBootcamp(facts, { ...DEFAULT_OPTIONS, style: "startup" });
    const ossDoc = generateBootcamp(facts, { ...DEFAULT_OPTIONS, style: "oss" });

    expect(startupDoc).not.toEqual(ossDoc);
    expect(startupDoc).toContain("Let's get you up and running fast!");
    expect(ossDoc).toContain("Welcome to the project!");
  });

  it("applies plugin facts patches to generated output documents", async () => {
    const fixture = await createFixtureRepo();
    try {
      const pluginPath = join(fixture.rootDir, "patch-plugin.mjs");
      await writeFile(
        pluginPath,
        `export default {
  name: "patch-plugin",
  version: "1.0.0",
  async analyze() {
    return {
      docs: [],
      factsPatch: { description: "Patched description from plugin" },
      extraData: { patched: true }
    };
  }
};`,
        "utf-8",
      );

      const scanResult = await scanRepo(fixture.sourceRepoPath, 200);
      const repoInfo: RepoInfo = {
        owner: "local",
        repo: "fixture-source",
        url: `file://${fixture.sourceRepoPath}`,
        branch: "main",
        fullName: "local/fixture-source",
      };
      const config: BootcampConfig = {
        plugins: [pathToFileURL(pluginPath).href],
      };
      const progress = new ProgressTracker(false);

      const { documents } = await prepareOutputDocuments({
        repoPath: fixture.sourceRepoPath,
        repoInfo,
        scanResult,
        facts: makeFacts(repoInfo.fullName),
        options: DEFAULT_OPTIONS,
        config,
        styleConfig: getStyleConfig("oss"),
        progress,
      });

      const factsDoc = documents.find((doc) => doc.name === "repo_facts.json");
      const bootcampDoc = documents.find((doc) => doc.name === "BOOTCAMP.md");
      expect(factsDoc).toBeDefined();
      expect(bootcampDoc).toBeDefined();

      const parsedFacts = JSON.parse(factsDoc!.content);
      expect(parsedFacts.description).toBe("Patched description from plugin");
      expect(parsedFacts.plugins?.["patch-plugin"]?.patched).toBe(true);
      expect(bootcampDoc!.content).toContain("Patched description from plugin");
    } finally {
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("cache option sensitivity", () => {
  beforeEach(async () => {
    await clearCache();
  });

  afterEach(async () => {
    await clearCache();
  });

  it("uses generation options as part of cache lookup", async () => {
    const facts = makeFacts("cache-owner/cache-repo");
    const repo = "cache-owner/cache-repo";
    const sha = "abc1234567890";
    const startupOptions = {
      focus: "all",
      style: "startup",
      model: "mock-model",
      audience: "backend",
    };
    const ossOptions = {
      ...startupOptions,
      style: "oss",
    };

    await writeCache(repo, sha, facts, startupOptions);

    const startupHit = await readCache(repo, sha, startupOptions);
    const ossMiss = await readCache(repo, sha, ossOptions);

    expect(startupHit).not.toBeNull();
    expect(startupHit!.repoName).toBe("cache-owner/cache-repo");
    expect(ossMiss).toBeNull();
  });
});

describe("scan scope threading (--exclude / --subdir)", () => {
  it("scopes the file scan to --subdir via scanRepositoryFiles", async () => {
    const fixture = await createFixtureRepo();
    try {
      const scoped = await scanRepositoryFiles(fixture.sourceRepoPath, 200, { subdir: "src" });
      const paths = scoped.files.filter((f) => !f.isDirectory).map((f) => f.path);

      // fast-glob runs with cwd=<repo>/src, so entries are relative to src/ and
      // the root-level files fall outside the scanned tree.
      expect(paths).toContain("index.ts");
      expect(paths).toContain("branch.txt");
      expect(paths).not.toContain("package.json");
      expect(paths).not.toContain("README.md");
    } finally {
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("drops --exclude trees from the scan via scanRepositoryFiles", async () => {
    const fixture = await createFixtureRepo();
    try {
      const full = await scanRepositoryFiles(fixture.sourceRepoPath, 200);
      const excluded = await scanRepositoryFiles(fixture.sourceRepoPath, 200, {
        exclude: ["src", "src/**"],
      });

      const fullPaths = full.files.filter((f) => !f.isDirectory).map((f) => f.path);
      const exclPaths = excluded.files.filter((f) => !f.isDirectory).map((f) => f.path);

      expect(fullPaths).toContain("src/index.ts");
      expect(exclPaths).not.toContain("src/index.ts");
      // Unrelated root files are still scanned.
      expect(exclPaths).toContain("package.json");
    } finally {
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("keeps the plain scan unchanged when no scope is passed", async () => {
    const fixture = await createFixtureRepo();
    try {
      const paths = (await scanRepositoryFiles(fixture.sourceRepoPath, 200)).files
        .filter((f) => !f.isDirectory)
        .map((f) => f.path);
      expect(paths).toContain("package.json");
      expect(paths).toContain("src/index.ts");
    } finally {
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});
