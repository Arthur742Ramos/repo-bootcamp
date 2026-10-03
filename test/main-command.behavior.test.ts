import { execSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from "fs/promises";
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
  await writeFile(
    join(repoDir, "package.json"),
    JSON.stringify({ name: "no-clone-fixture" }, null, 2),
    "utf-8"
  );
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
  it.each([undefined, "src", "source-alias"])(
    "uses local directory and scopes analysis to %s without cloning",
    async (subdir) => {
      const repoPath = await createLocalFixtureRepo();
      if (subdir === "source-alias")
        await symlink(join(repoPath, "src"), join(repoPath, subdir), "junction");
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
            subdir,
            output: outputDir,
          })
        ).rejects.toThrow("EXIT_0");
      } finally {
        exitSpy.mockRestore();
        logSpy.mockRestore();
        await rm(repoPath, { recursive: true, force: true });
      }

      expect(cloneRepository).not.toHaveBeenCalled();
      if (subdir) {
        expect(scanRepositoryFiles).toHaveBeenCalledWith(
          repoPath,
          BASE_OPTIONS.maxFiles,
          expect.objectContaining({ subdir })
        );
      } else {
        expect(scanRepositoryFiles).toHaveBeenCalledWith(repoPath, BASE_OPTIONS.maxFiles);
      }
      const selectedRoot = subdir ? join(repoPath, subdir) : repoPath;
      expect(orchestrateAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          repoPath: selectedRoot,
          repoInfo: expect.objectContaining({
            ...(subdir ? { sourcePathPrefix: subdir === "source-alias" ? "src" : subdir } : {}),
          }),
        })
      );
      expect(prepareOutputDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: selectedRoot })
      );
      expect(cleanupRepository).not.toHaveBeenCalled();
    }
  );

  it("cleans up a remote clone when scanning fails before generation", async () => {
    vi.resetModules();
    const cloneRepository = vi.fn().mockResolvedValue("/tmp/remote-clone");
    const cleanupRepository = vi.fn().mockResolvedValue(undefined);
    const scanRepositoryFiles = vi.fn().mockRejectedValue(new Error("scan failed"));
    const resolveRunConfiguration = vi.fn().mockResolvedValue({
      config: null,
      styleConfig: makeStyleConfig(),
      outputFormat: "markdown",
    });

    vi.doMock("../src/services/clone-service.js", () => ({
      cloneRepository,
      cleanupRepository,
      scanRepositoryFiles,
    }));
    vi.doMock("../src/services/config-resolution.js", () => ({ resolveRunConfiguration }));

    const { runMainCommand } = await import("../src/commands/main-command.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    }) as (code?: number) => never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        runMainCommand("https://github.com/test/repo", {
          ...BASE_OPTIONS,
          noClone: false,
          jsonOnly: true,
        })
      ).rejects.toThrow("EXIT_1");
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(cloneRepository).toHaveBeenCalled();
    expect(scanRepositoryFiles).toHaveBeenCalledWith("/tmp/remote-clone", BASE_OPTIONS.maxFiles);
    expect(cleanupRepository).toHaveBeenCalledWith("/tmp/remote-clone");
  });

  it("cleans up a remote clone when analysis fails", async () => {
    vi.resetModules();
    const cloneRepository = vi.fn().mockResolvedValue("/tmp/remote-analysis-failure");
    const cleanupRepository = vi.fn().mockResolvedValue(undefined);
    const scanRepositoryFiles = vi.fn().mockResolvedValue(makeScanResult());
    const orchestrateAnalysis = vi.fn().mockRejectedValue(new Error("analysis failed"));
    const resolveRunConfiguration = vi.fn().mockResolvedValue({
      config: null,
      styleConfig: makeStyleConfig(),
      outputFormat: "markdown",
    });

    vi.doMock("../src/services/clone-service.js", () => ({
      cloneRepository,
      cleanupRepository,
      scanRepositoryFiles,
    }));
    vi.doMock("../src/services/analysis-orchestration.js", () => ({
      orchestrateAnalysis,
    }));
    vi.doMock("../src/services/config-resolution.js", () => ({ resolveRunConfiguration }));

    const { runMainCommand } = await import("../src/commands/main-command.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    }) as (code?: number) => never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        runMainCommand("https://github.com/test/repo", {
          ...BASE_OPTIONS,
          noClone: false,
        })
      ).rejects.toThrow("EXIT_1");
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(orchestrateAnalysis).toHaveBeenCalled();
    expect(cleanupRepository).toHaveBeenCalledWith("/tmp/remote-analysis-failure");
  });

  it("does not clean up a local repository when analysis fails", async () => {
    const repoPath = await createLocalFixtureRepo();

    vi.resetModules();
    const cleanupRepository = vi.fn();
    const scanRepositoryFiles = vi.fn().mockResolvedValue(makeScanResult());
    const orchestrateAnalysis = vi.fn().mockRejectedValue(new Error("analysis failed"));
    const resolveRunConfiguration = vi.fn().mockResolvedValue({
      config: null,
      styleConfig: makeStyleConfig(),
      outputFormat: "markdown",
    });

    vi.doMock("../src/services/clone-service.js", () => ({
      cloneRepository: vi.fn(),
      cleanupRepository,
      scanRepositoryFiles,
    }));
    vi.doMock("../src/services/analysis-orchestration.js", () => ({
      orchestrateAnalysis,
    }));
    vi.doMock("../src/services/config-resolution.js", () => ({ resolveRunConfiguration }));

    const { runMainCommand } = await import("../src/commands/main-command.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    }) as (code?: number) => never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(runMainCommand(repoPath, BASE_OPTIONS)).rejects.toThrow("EXIT_1");
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await rm(repoPath, { recursive: true, force: true });
    }

    expect(cleanupRepository).not.toHaveBeenCalled();
  });

  it("keeps a remote clone when --keep-temp analysis fails", async () => {
    vi.resetModules();
    const cloneRepository = vi.fn().mockResolvedValue("/tmp/remote-kept-analysis");
    const cleanupRepository = vi.fn().mockResolvedValue(undefined);
    const scanRepositoryFiles = vi.fn().mockResolvedValue(makeScanResult());
    const orchestrateAnalysis = vi.fn().mockRejectedValue(new Error("analysis failed"));
    const resolveRunConfiguration = vi.fn().mockResolvedValue({
      config: null,
      styleConfig: makeStyleConfig(),
      outputFormat: "markdown",
    });

    vi.doMock("../src/services/clone-service.js", () => ({
      cloneRepository,
      cleanupRepository,
      scanRepositoryFiles,
    }));
    vi.doMock("../src/services/analysis-orchestration.js", () => ({
      orchestrateAnalysis,
    }));
    vi.doMock("../src/services/config-resolution.js", () => ({ resolveRunConfiguration }));

    const { runMainCommand } = await import("../src/commands/main-command.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    }) as (code?: number) => never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        runMainCommand("https://github.com/test/repo", {
          ...BASE_OPTIONS,
          noClone: false,
          keepTemp: true,
        })
      ).rejects.toThrow("EXIT_1");
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(cleanupRepository).not.toHaveBeenCalled();
  });

  it("cleans up a remote clone when the output directory cannot be created", async () => {
    vi.resetModules();
    const cloneRepository = vi.fn().mockResolvedValue("/tmp/remote-mkdir-failure");
    const cleanupRepository = vi.fn().mockResolvedValue(undefined);
    const scanRepositoryFiles = vi.fn().mockResolvedValue(makeScanResult());
    const orchestrateAnalysis = vi.fn().mockResolvedValue(makeAnalysis(makeFacts()));
    const resolveRunConfiguration = vi.fn().mockResolvedValue({
      config: null,
      styleConfig: makeStyleConfig(),
      outputFormat: "markdown",
    });
    const actualFs = await vi.importActual<typeof import("fs/promises")>("fs/promises");
    const mkdir = vi.fn().mockRejectedValue(new Error("mkdir failed"));

    vi.doMock("fs/promises", () => ({ ...actualFs, mkdir }));
    vi.doMock("../src/services/clone-service.js", () => ({
      cloneRepository,
      cleanupRepository,
      scanRepositoryFiles,
    }));
    vi.doMock("../src/services/analysis-orchestration.js", () => ({
      orchestrateAnalysis,
    }));
    vi.doMock("../src/services/config-resolution.js", () => ({ resolveRunConfiguration }));

    const { runMainCommand } = await import("../src/commands/main-command.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    }) as (code?: number) => never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        runMainCommand("https://github.com/test/repo", {
          ...BASE_OPTIONS,
          noClone: false,
        })
      ).rejects.toThrow("EXIT_1");
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.doUnmock("fs/promises");
    }

    expect(mkdir).toHaveBeenCalled();
    expect(cleanupRepository).toHaveBeenCalledWith("/tmp/remote-mkdir-failure");
  });

  it("cleans up a remote clone when document generation fails", async () => {
    const outputDir = join(tmpdir(), "bootcamp-generation-failure");
    await rm(outputDir, { recursive: true, force: true });

    vi.resetModules();
    const cloneRepository = vi.fn().mockResolvedValue("/tmp/remote-generation-failure");
    const cleanupRepository = vi.fn().mockResolvedValue(undefined);
    const scanRepositoryFiles = vi.fn().mockResolvedValue(makeScanResult());
    const facts = makeFacts();
    const orchestrateAnalysis = vi.fn().mockResolvedValue(makeAnalysis(facts));
    const prepareOutputDocuments = vi.fn().mockResolvedValue(makePreparedResult(facts));
    const writeGeneratedOutputs = vi.fn().mockRejectedValue(new Error("generation failed"));
    const resolveRunConfiguration = vi.fn().mockResolvedValue({
      config: null,
      styleConfig: makeStyleConfig(),
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
    vi.doMock("../src/services/output-writer.js", () => ({ writeGeneratedOutputs }));
    vi.doMock("../src/services/config-resolution.js", () => ({ resolveRunConfiguration }));

    const { runMainCommand } = await import("../src/commands/main-command.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    }) as (code?: number) => never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        runMainCommand("https://github.com/test/repo", {
          ...BASE_OPTIONS,
          noClone: false,
          output: outputDir,
        })
      ).rejects.toThrow("EXIT_1");
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await rm(outputDir, { recursive: true, force: true });
    }

    expect(writeGeneratedOutputs).toHaveBeenCalled();
    expect(cleanupRepository).toHaveBeenCalledWith("/tmp/remote-generation-failure");
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
        })
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
        runMainCommand(repoPath, { ...BASE_OPTIONS, jsonOnly: false, output: outputDir })
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
    expect(summary.scores.health).toEqual({
      score: 90,
      grade: "A",
      passCount: 1,
      warnCount: 0,
      failCount: 0,
    });
    expect(summary.deps).toEqual({ total: 3, runtime: 2, dev: 1 });
  });
});

describe("runMainCommand --watch and --interactive", () => {
  it.each([false, true])("refreshes watched commits (dirty=%s)", async (dirty) => {
    const repoPath = await createLocalFixtureRepo();
    const outputDir = join(repoPath, "bootcamp-output");
    await symlink(join(repoPath, "src"), join(repoPath, "source-alias"), "junction");
    await mkdir(join(repoPath, "other-src"));
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

    let capturedOnChange: ((commitSha?: string) => Promise<void>) | undefined;
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
        subdir: "source-alias",
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

      expect(prepareOutputDocuments.mock.calls[0][0].repoInfo.sourcePathPrefix).toBe("src");
      // Retarget the contained alias as a Git update can, then rescan.
      await rm(join(repoPath, "source-alias"));
      await symlink(join(repoPath, "other-src"), join(repoPath, "source-alias"), "junction");
      // Commit generated fixture artifacts so the clean case is truly clean.
      execSync("git add -A", { cwd: repoPath, stdio: "ignore" });
      execSync('git commit -m "fixture artifacts" --no-gpg-sign', {
        cwd: repoPath,
        stdio: "ignore",
      });
      if (dirty)
        await writeFile(join(repoPath, "src", "index.ts"), "export const changed = true;\n");
      const initialRepoInfo = orchestrateAnalysis.mock.calls[0][0].repoInfo;
      const initialCommitSha = initialRepoInfo.commitSha;
      // Simulate the exact commit delivered after watch updates the checkout.
      const updatedCommitSha = "0123456789abcdef0123456789abcdef01234567";
      await capturedOnChange!(updatedCommitSha);
      expect(initialRepoInfo.commitSha).toBe(initialCommitSha);
      expect(analyzeRepo.mock.calls[0][1].commitSha).toBe(updatedCommitSha);
      expect(analyzeRepo.mock.calls[0][3].noCache).toBe(dirty);
      expect(prepareOutputDocuments.mock.calls.at(-1)![0].options.noCache).toBe(dirty);
      expect(prepareOutputDocuments.mock.calls.at(-1)![0].repoInfo.commitSha).toBe(
        updatedCommitSha
      );
      const regeneratedSummary = JSON.parse(
        await readFile(join(outputDir, "summary.json"), "utf-8")
      );
      const regeneratedManifest = JSON.parse(
        await readFile(join(outputDir, "ANALYSIS_MANIFEST.json"), "utf-8")
      );
      expect(regeneratedSummary.commitSha).toBe(updatedCommitSha);
      expect(regeneratedManifest.repository.commitSha).toBe(updatedCommitSha);

      expect(scanRepositoryFiles.mock.calls.length).toBe(scansBefore + 1);
      expect(analyzeRepo).toHaveBeenCalledTimes(1);
      expect(startWatch).toHaveBeenCalledWith(repoPath, expect.any(Object));
      expect(scanRepositoryFiles).toHaveBeenLastCalledWith(
        repoPath,
        200,
        expect.objectContaining({ subdir: "source-alias" })
      );
      expect(analyzeRepo.mock.calls[0][0]).toBe(join(repoPath, "source-alias"));
      expect(analyzeRepo.mock.calls[0][1].sourcePathPrefix).toBe("other-src");
      expect(prepareOutputDocuments.mock.calls.at(-1)![0].repoPath).toBe(
        join(repoPath, "source-alias")
      );
      expect(prepareOutputDocuments.mock.calls.at(-1)![0].repoInfo.sourcePathPrefix).toBe(
        "other-src"
      );
      expect(prepareOutputDocuments.mock.calls.at(-1)![0].repositoryRoot).toBe(repoPath);
      expect(writeGeneratedOutputs.mock.calls.length).toBe(writesBefore + 1);
      const lastWrite = writeGeneratedOutputs.mock.calls.at(-1)![0] as {
        allowIssueCreation?: boolean;
      };
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

  it.each([true, false])(
    "runs scoped interactive analysis and preserves checkout cleanup (local=%s)",
    async (isLocal) => {
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
        cloneRepository: vi.fn().mockResolvedValue(repoPath),
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
        await runMainCommand(isLocal ? repoPath : "https://github.com/test/repo", {
          ...BASE_OPTIONS,
          noClone: isLocal,
          jsonOnly: false,
          interactive: true,
          subdir: "src",
          output: outputDir,
        });

        expect(runInteractiveMode).toHaveBeenCalledTimes(1);
        expect(runInteractiveMode.mock.calls[0][0]).toBe(join(repoPath, "src"));
        expect(runInteractiveMode.mock.calls[0][1].sourcePathPrefix).toBe("src");
        if (isLocal) {
          expect(cleanupRepository).not.toHaveBeenCalled();
        } else {
          expect(cleanupRepository).toHaveBeenCalledExactlyOnceWith(repoPath);
          expect(cleanupRepository).not.toHaveBeenCalledWith(join(repoPath, "src"));
        }
      } finally {
        exitSpy.mockRestore();
        logSpy.mockRestore();
        await rm(repoPath, { recursive: true, force: true });
      }
    }
  );
});
