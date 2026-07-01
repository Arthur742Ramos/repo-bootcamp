import { execSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "fs/promises";
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

  it("suppresses banner and decorative output in quiet mode, printing the output dir", async () => {
    const repoPath = await createLocalFixtureRepo();
    const outputDir = join(repoPath, "bootcamp-output");
    const facts = makeFacts();
    const scanResult = makeScanResult();

    vi.resetModules();
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
      metrics: { approachability: { score: 90, grade: "A" }, totalFiles: 1, sourceFiles: 1 },
      health: { score: 90, grade: "A", passCount: 1, warnCount: 0, failCount: 0 },
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
          showMetrics: true,
          showHealth: true,
        },
        badges: { style: "shields" },
        firstTasksCount: 8,
        introText: "mock",
      },
      outputFormat: "markdown",
    });

    vi.doMock("../src/services/clone-service.js", () => ({
      cloneRepository: vi.fn(),
      cleanupRepository: vi.fn(),
      scanRepositoryFiles,
    }));
    vi.doMock("../src/services/analysis-orchestration.js", () => ({
      orchestrateAnalysis,
      prepareOutputDocuments,
    }));
    vi.doMock("../src/services/output-writer.js", () => ({ writeGeneratedOutputs }));
    vi.doMock("../src/services/config-resolution.js", () => ({ resolveRunConfiguration }));

    const { runMainCommand } = await import("../src/commands/main-command.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    }) as (code?: number) => never);
    const logged: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      logged.push(String(msg ?? ""));
    });

    try {
      await expect(
        runMainCommand(repoPath, {
          ...BASE_OPTIONS,
          jsonOnly: false,
          quiet: true,
          output: outputDir,
        }),
      ).rejects.toThrow("EXIT_0");
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      await rm(repoPath, { recursive: true, force: true });
    }

    const output = logged.join("\n");
    // No banner, headers, stack table, success box, or file tree.
    expect(output).not.toContain("Turn any repo into a Day 1 onboarding kit");
    expect(output).not.toContain("Detected Stack");
    expect(output).not.toContain("Bootcamp Generated Successfully");
    expect(output).not.toContain("Next step");
    // The output directory is printed so a caller can capture it.
    expect(logged).toContain(outputDir);
  });
});

function makeStyleConfig() {
  return {
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
      showMetrics: true,
      showHealth: true,
    },
    badges: { style: "shields" },
    firstTasksCount: 8,
    introText: "mock",
  };
}

function makePreparedResult(facts: RepoFacts, overrides: Record<string, unknown> = {}) {
  return {
    documents: [{ name: "repo_facts.json", content: JSON.stringify(facts, null, 2) }],
    facts,
    security: { score: 95 },
    radar: { onboardingRisk: { score: 10, grade: "A", factors: [] } },
    deps: { totalCount: 3, runtime: [{}, {}], dev: [{}] },
    metrics: { approachability: { score: 90, grade: "A" }, totalFiles: 1, sourceFiles: 1 },
    health: { score: 90, grade: "A", passCount: 1, warnCount: 0, failCount: 0 },
    outputTargets: [],
    ...overrides,
  };
}

function makeAnalysis(facts: RepoFacts) {
  return {
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
  };
}

describe("runMainCommand summary.json", () => {
  it("writes a machine-readable summary.json with scores and dep totals", async () => {
    const repoPath = await createLocalFixtureRepo();
    const outputDir = join(repoPath, "bootcamp-output");
    const facts = makeFacts();
    const scanResult = makeScanResult();

    vi.resetModules();
    const scanRepositoryFiles = vi.fn().mockResolvedValue(scanResult);
    const orchestrateAnalysis = vi.fn().mockResolvedValue(makeAnalysis(facts));
    const prepareOutputDocuments = vi.fn().mockResolvedValue(makePreparedResult(facts));
    const writeGeneratedOutputs = vi.fn().mockResolvedValue({ documentCount: 1 });
    const resolveRunConfiguration = vi.fn().mockResolvedValue({
      config: null,
      styleConfig: makeStyleConfig(),
      outputFormat: "markdown",
    });

    vi.doMock("../src/services/clone-service.js", () => ({
      cloneRepository: vi.fn(),
      cleanupRepository: vi.fn(),
      scanRepositoryFiles,
    }));
    vi.doMock("../src/services/analysis-orchestration.js", () => ({
      orchestrateAnalysis,
      prepareOutputDocuments,
    }));
    vi.doMock("../src/services/output-writer.js", () => ({ writeGeneratedOutputs }));
    vi.doMock("../src/services/config-resolution.js", () => ({ resolveRunConfiguration }));

    const { runMainCommand } = await import("../src/commands/main-command.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    }) as (code?: number) => never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    let summary: any;
    try {
      await expect(
        runMainCommand(repoPath, { ...BASE_OPTIONS, jsonOnly: false, output: outputDir }),
      ).rejects.toThrow("EXIT_0");
      summary = JSON.parse(await readFile(join(outputDir, "summary.json"), "utf-8"));
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      await rm(repoPath, { recursive: true, force: true });
    }

    expect(typeof summary.repo).toBe("string");
    expect(summary.repo.startsWith("local/")).toBe(true);
    expect(typeof summary.generatedAt).toBe("string");
    expect(Array.isArray(summary.files)).toBe(true);
    expect(summary.scores.security.score).toBe(95);
    expect(typeof summary.scores.security.grade).toBe("string");
    expect(summary.scores.onboardingRisk).toEqual({ score: 10, grade: "A" });
    expect(summary.scores.approachability).toEqual({ score: 90, grade: "A" });
    expect(summary.scores.health).toEqual({ score: 90, grade: "A", passCount: 1, warnCount: 0, failCount: 0 });
    expect(summary.deps).toEqual({ total: 3, runtime: 2, dev: 1 });
  });
});

describe("runMainCommand --watch and --interactive", () => {
  it("re-scans, re-analyzes and re-writes (issue creation off) on change, and stops on SIGINT", async () => {
    const repoPath = await createLocalFixtureRepo();
    const outputDir = join(repoPath, "bootcamp-output");
    const facts = makeFacts();
    const scanResult = makeScanResult();

    vi.resetModules();
    const scanRepositoryFiles = vi.fn().mockResolvedValue(scanResult);
    const orchestrateAnalysis = vi.fn().mockResolvedValue(makeAnalysis(facts));
    const analyzeRepo = vi.fn().mockResolvedValue({
      facts,
      stats: {
        model: "mock-model",
        toolCalls: [],
        totalEvents: 0,
        responseLength: 0,
        startTime: Date.now(),
        endTime: Date.now(),
      },
    });
    const prepareOutputDocuments = vi.fn().mockResolvedValue(makePreparedResult(facts));
    const writeGeneratedOutputs = vi.fn().mockResolvedValue({ documentCount: 1 });
    const resolveRunConfiguration = vi.fn().mockResolvedValue({
      config: null,
      styleConfig: makeStyleConfig(),
      outputFormat: "markdown",
    });

    let capturedOnChange: (() => Promise<void>) | undefined;
    const stop = vi.fn();
    const startWatch = vi.fn().mockImplementation((_path: string, opts: any) => {
      capturedOnChange = opts.onChangeDetected;
      return { stop };
    });

    vi.doMock("../src/services/clone-service.js", () => ({
      cloneRepository: vi.fn(),
      cleanupRepository: vi.fn(),
      scanRepositoryFiles,
    }));
    vi.doMock("../src/services/analysis-orchestration.js", () => ({
      orchestrateAnalysis,
      prepareOutputDocuments,
    }));
    vi.doMock("../src/services/output-writer.js", () => ({ writeGeneratedOutputs }));
    vi.doMock("../src/services/config-resolution.js", () => ({ resolveRunConfiguration }));
    vi.doMock("../src/watch.js", () => ({ startWatch }));
    vi.doMock("../src/agent.js", () => ({ analyzeRepo }));

    const { runMainCommand } = await import("../src/commands/main-command.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    }) as (code?: number) => never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const onSpy = vi.spyOn(process, "on");

    let sigintHandler: ((...a: any[]) => void) | undefined;
    let sigtermHandler: ((...a: any[]) => void) | undefined;
    try {
      // Watch mode awaits a forever-pending promise and never resolves, so we
      // fire-and-forget and drive the captured change handler ourselves.
      void runMainCommand(repoPath, {
        ...BASE_OPTIONS,
        jsonOnly: false,
        watch: true,
        output: outputDir,
      }).catch(() => {});

      await vi.waitFor(() => expect(startWatch).toHaveBeenCalledTimes(1));

      const sigintCall = onSpy.mock.calls.find((c) => c[0] === "SIGINT");
      const sigtermCall = onSpy.mock.calls.find((c) => c[0] === "SIGTERM");
      sigintHandler = sigintCall?.[1] as any;
      sigtermHandler = sigtermCall?.[1] as any;
      expect(sigintHandler).toBeTypeOf("function");

      const scansBefore = scanRepositoryFiles.mock.calls.length;
      const writesBefore = writeGeneratedOutputs.mock.calls.length;

      // Simulate a detected change.
      await capturedOnChange!();

      expect(scanRepositoryFiles.mock.calls.length).toBe(scansBefore + 1);
      expect(analyzeRepo).toHaveBeenCalledTimes(1);
      expect(writeGeneratedOutputs.mock.calls.length).toBe(writesBefore + 1);
      const lastWrite = writeGeneratedOutputs.mock.calls.at(-1)![0] as { allowIssueCreation?: boolean };
      expect(lastWrite.allowIssueCreation).toBe(false);

      // SIGINT stops the watch handle before exiting.
      expect(() => sigintHandler!()).toThrow("EXIT_0");
      expect(stop).toHaveBeenCalled();
    } finally {
      if (sigintHandler) process.removeListener("SIGINT", sigintHandler as any);
      if (sigtermHandler) process.removeListener("SIGTERM", sigtermHandler as any);
      exitSpy.mockRestore();
      logSpy.mockRestore();
      onSpy.mockRestore();
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it("runs the interactive REPL and skips cleanup for a local repo", async () => {
    const repoPath = await createLocalFixtureRepo();
    const outputDir = join(repoPath, "bootcamp-output");
    const facts = makeFacts();
    const scanResult = makeScanResult();

    vi.resetModules();
    const scanRepositoryFiles = vi.fn().mockResolvedValue(scanResult);
    const cleanupRepository = vi.fn();
    const orchestrateAnalysis = vi.fn().mockResolvedValue(makeAnalysis(facts));
    const prepareOutputDocuments = vi.fn().mockResolvedValue(makePreparedResult(facts));
    const writeGeneratedOutputs = vi.fn().mockResolvedValue({ documentCount: 1 });
    const resolveRunConfiguration = vi.fn().mockResolvedValue({
      config: null,
      styleConfig: makeStyleConfig(),
      outputFormat: "markdown",
    });
    const runInteractiveMode = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../src/services/clone-service.js", () => ({
      cloneRepository: vi.fn(),
      cleanupRepository,
      scanRepositoryFiles,
    }));
    vi.doMock("../src/services/analysis-orchestration.js", () => ({
      orchestrateAnalysis,
      prepareOutputDocuments,
    }));
    vi.doMock("../src/services/output-writer.js", () => ({ writeGeneratedOutputs }));
    vi.doMock("../src/services/config-resolution.js", () => ({ resolveRunConfiguration }));
    vi.doMock("../src/interactive.js", () => ({ runInteractiveMode }));

    const { runMainCommand } = await import("../src/commands/main-command.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    }) as (code?: number) => never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      // Interactive mode with a local repo returns normally (no process.exit).
      await runMainCommand(repoPath, {
        ...BASE_OPTIONS,
        jsonOnly: false,
        interactive: true,
        output: outputDir,
      });

      expect(runInteractiveMode).toHaveBeenCalledTimes(1);
      // Local repos are never deleted, even after interactive mode ends.
      expect(cleanupRepository).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      await rm(repoPath, { recursive: true, force: true });
    }
  });
});
