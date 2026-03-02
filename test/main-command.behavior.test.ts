import { execSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepoFacts, BootcampOptions, ScanResult } from "../src/types.js";

const BASE_OPTIONS: BootcampOptions = {
  branch: "",
  focus: "all",
  audience: "backend",
  output: "",
  maxFiles: 200,
  noClone: true,
  verbose: false,
  jsonOnly: true,
  style: "oss",
};

function makeFacts(repoName = "local/fixture-no-clone"): RepoFacts {
  return {
    repoName,
    purpose: "Fixture repo for no-clone behavior tests",
    description: "A local fixture repository for command behavior validation.",
    confidence: "high",
    sources: ["README.md"],
    stack: {
      languages: ["TypeScript"],
      frameworks: [],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: false,
    },
    quickstart: {
      prerequisites: ["Node.js"],
      steps: ["npm install"],
      commands: [{ name: "install", command: "npm install", source: "package.json" }],
      commonErrors: [],
      sources: ["README.md"],
    },
    structure: {
      keyDirs: [{ path: "src/", purpose: "Source code", keyFiles: ["src/index.ts"] }],
      entrypoints: [{ path: "src/index.ts", type: "main", description: "Main entry" }],
      testDirs: ["test/"],
      docsDirs: [],
      sources: ["src/index.ts"],
    },
    ci: {
      workflows: [],
      mainChecks: [],
      sources: [],
    },
    contrib: {
      howToAddFeature: ["Open a PR"],
      howToAddTest: ["Add a test in test/"],
      codeStyle: "TypeScript",
      sources: ["README.md"],
    },
    architecture: {
      overview: "Simple local fixture app.",
      components: [{ name: "App", description: "Main component", directory: "src/" }],
      dataFlow: "input -> output",
      keyAbstractions: [{ name: "app", description: "Main application instance" }],
      codeExamples: [
        {
          title: "Entry point",
          file: "src/index.ts",
          code: "export const fixture = true;",
          explanation: "Simple fixture export.",
        },
      ],
      sources: ["src/index.ts"],
    },
    firstTasks: [],
    runbook: {
      applicable: false,
      deploySteps: [],
      observability: [],
      incidents: [],
      sources: [],
    },
  };
}

function makeScanResult(): ScanResult {
  return {
    files: [{ path: "src/index.ts", size: 24, isDirectory: false }],
    stack: {
      languages: ["TypeScript"],
      frameworks: [],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: false,
    },
    commands: [],
    ciWorkflows: [],
    readme: "# fixture",
    contributing: null,
    keySourceFiles: new Map([["src/index.ts", "export const fixture = true;"]]),
  };
}

async function createLocalFixtureRepo(): Promise<string> {
  const repoDir = await mkdtemp(join(tmpdir(), "bootcamp-no-clone-"));
  await mkdir(join(repoDir, "src"), { recursive: true });
  await writeFile(join(repoDir, "README.md"), "# no-clone fixture\n", "utf-8");
  await writeFile(join(repoDir, "package.json"), JSON.stringify({ name: "no-clone-fixture" }, null, 2), "utf-8");
  await writeFile(join(repoDir, "src", "index.ts"), "export const fixture = true;\n", "utf-8");

  execSync("git init -b main", { cwd: repoDir, stdio: "ignore" });
  execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: "ignore" });
  execSync('git config user.name "Test User"', { cwd: repoDir, stdio: "ignore" });
  execSync("git add -A", { cwd: repoDir, stdio: "ignore" });
  execSync('git commit -m "init" --no-gpg-sign', { cwd: repoDir, stdio: "ignore" });

  return repoDir;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runMainCommand --no-clone behavior", () => {
  it("uses local directory without invoking clone service", async () => {
    const repoPath = await createLocalFixtureRepo();
    const outputDir = join(repoPath, "bootcamp-output");
    const facts = makeFacts();
    const scanResult = makeScanResult();

    vi.resetModules();
    const cloneRepository = vi.fn();
    const cleanupRepository = vi.fn();
    const scanRepositoryFiles = vi.fn().mockResolvedValue(scanResult);
    const orchestrateAnalysis = vi.fn().mockResolvedValue({
      facts,
      analysisStats: {
        model: "mock-model",
        toolCalls: [],
        totalEvents: 0,
        responseLength: 0,
        startTime: Date.now(),
        endTime: Date.now(),
      },
      durationMs: 1,
      toolCalls: 0,
      model: "mock-model",
    });
    const prepareOutputDocuments = vi.fn().mockResolvedValue({
      documents: [{ name: "repo_facts.json", content: JSON.stringify(facts, null, 2) }],
      facts,
      security: { score: 95 },
      radar: { onboardingRisk: { score: 10, grade: "A", factors: [] } },
      deps: null,
    });
    const writeGeneratedOutputs = vi.fn().mockResolvedValue({ documentCount: 1 });
    const resolveRunConfiguration = vi.fn().mockResolvedValue({
      config: null,
      styleConfig: {
        name: "oss",
        description: "mock style",
        tone: "casual",
        sectionDepth: "standard",
        emoji: true,
        sections: {
          showRunbook: true,
          showSecurityDetails: true,
          showDependencyGraph: true,
          showRadar: true,
          showImpact: true,
        },
        badges: { style: "shields" },
        firstTasksCount: 8,
        introText: "mock",
      },
      outputFormat: "markdown",
    });

    vi.doMock("../src/services/clone-service.js", () => ({
      cloneRepository,
      cleanupRepository,
      scanRepositoryFiles,
    }));
    vi.doMock("../src/services/analysis-orchestration.js", () => ({
      orchestrateAnalysis,
      prepareOutputDocuments,
    }));
    vi.doMock("../src/services/output-writer.js", () => ({
      writeGeneratedOutputs,
    }));
    vi.doMock("../src/services/config-resolution.js", () => ({
      resolveRunConfiguration,
    }));

    const { runMainCommand } = await import("../src/commands/main-command.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    }) as (code?: number) => never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await expect(
        runMainCommand(repoPath, {
          ...BASE_OPTIONS,
          output: outputDir,
        }),
      ).rejects.toThrow("EXIT_0");
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      await rm(repoPath, { recursive: true, force: true });
    }

    expect(cloneRepository).not.toHaveBeenCalled();
    expect(scanRepositoryFiles).toHaveBeenCalledWith(repoPath, BASE_OPTIONS.maxFiles);
    expect(cleanupRepository).not.toHaveBeenCalled();
  });
});
