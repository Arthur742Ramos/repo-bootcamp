/**
 * Tests for analysis orchestration service (src/services/analysis-orchestration.ts)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BootcampOptions, RepoFacts, RepoInfo, ScanResult } from "../src/types.js";
import type { StyleConfig } from "../src/plugins.js";

const {
  analyzeRepoMock,
  runParallelAnalysisMock,
} = vi.hoisted(() => ({
  analyzeRepoMock: vi.fn(),
  runParallelAnalysisMock: vi.fn(),
}));

vi.mock("../src/agent.js", () => ({
  analyzeRepo: analyzeRepoMock,
}));

vi.mock("../src/analysis.js", () => ({
  runParallelAnalysis: runParallelAnalysisMock,
}));

vi.mock("../src/diff.js", () => ({
  analyzeDiff: vi.fn(),
  generateDiffDocs: vi.fn(() => "diff-doc"),
}));

vi.mock("../src/deps.js", () => ({
  generateDependencyDocs: vi.fn(() => "deps-doc"),
}));

vi.mock("../src/generator.js", () => ({
  generateBootcamp: vi.fn(() => "bootcamp-content"),
  generateOnboarding: vi.fn(() => "onboarding-content"),
  generateArchitecture: vi.fn(() => "architecture-content"),
  generateCodemap: vi.fn(() => "codemap-content"),
  generateFirstTasks: vi.fn(() => "first-tasks-content"),
  generateRunbook: vi.fn(() => "runbook-content"),
  generateDiagrams: vi.fn(() => "diagrams-content"),
}));

vi.mock("../src/impact.js", () => ({
  generateImpactDocs: vi.fn(() => "impact-doc"),
}));

vi.mock("../src/radar.js", () => ({
  generateRadarDocs: vi.fn(() => "radar-doc"),
}));

vi.mock("../src/security.js", () => ({
  generateSecurityDocs: vi.fn(() => "security-doc"),
}));

vi.mock("../src/plugins.js", () => ({
  loadPlugins: vi.fn().mockResolvedValue([]),
  runPlugins: vi.fn().mockResolvedValue({
    factsPatch: {},
    docs: [],
    extraData: {},
    formatters: [],
    outputTargets: [],
  }),
}));

vi.mock("chalk", () => ({
  default: { yellow: (s: string) => s },
}));

import { orchestrateAnalysis, prepareOutputDocuments } from "../src/services/analysis-orchestration.js";
import { ProgressTracker } from "../src/progress.js";

const defaultOptions: BootcampOptions = {
  branch: "main",
  focus: "all",
  audience: "all",
  output: "./out",
  maxFiles: 200,
  noClone: false,
  verbose: false,
  format: "markdown",
};

const defaultStyleConfig: StyleConfig = {
  name: "startup",
  description: "startup style",
  tone: "casual",
  sectionDepth: "standard",
  firstTasksCount: 5,
  maxCodeExamples: 5,
  sections: {
    showRunbook: true,
    showSecurityDetails: true,
    showRadar: true,
    showDependencyGraph: true,
    showImpact: true,
  },
};

const mockRepoInfo: RepoInfo = {
  owner: "test-owner",
  repo: "test-repo",
  fullName: "test-owner/test-repo",
  commitSha: "abc123",
  defaultBranch: "main",
  branch: "main",
  isLocal: false,
};

const mockScanResult: ScanResult = {
  files: [{ path: "src/index.ts", size: 500, isDirectory: false }],
  stack: {
    languages: [{ name: "TypeScript", percentage: 100 }],
    frameworks: [],
    buildTools: [],
    testFrameworks: [],
    linters: [],
  },
  monorepo: null,
  commands: [],
  ciWorkflows: [],
  readme: "# Test",
  contributing: null,
  keySourceFiles: new Map(),
};

const mockFacts: RepoFacts = {
  purpose: "Test project",
  techStack: "TypeScript",
  architecture: "Modular",
  keyFiles: [],
  conventions: [],
  setupSteps: [],
  firstTasks: [
    { title: "task1", description: "d1", difficulty: "easy", files: [] },
    { title: "task2", description: "d2", difficulty: "easy", files: [] },
    { title: "task3", description: "d3", difficulty: "medium", files: [] },
    { title: "task4", description: "d4", difficulty: "medium", files: [] },
    { title: "task5", description: "d5", difficulty: "hard", files: [] },
    { title: "task6", description: "d6", difficulty: "hard", files: [] },
  ],
  codeExamples: [],
  gotchas: [],
  testingStrategy: "",
  deploymentInfo: "",
  diagrams: { dependencyGraph: "", moduleRelations: "", flowDiagram: "" },
  contextSummary: "",
};

beforeEach(() => {
  vi.clearAllMocks();

  analyzeRepoMock.mockResolvedValue({
    facts: mockFacts,
    stats: {
      toolCalls: [{ name: "tool1" }, { name: "tool2" }],
      model: "gpt-4",
      tokensUsed: 1000,
    },
  });

  runParallelAnalysisMock.mockResolvedValue({
    deps: null,
    security: {
      score: 85,
      authPatterns: [],
      securityDeps: [],
      findings: [],
      secretsHandling: { envFiles: [], configFiles: [], gitignoreSecrets: true, hasEnvExample: false },
      headers: { hasHelmet: false, hasCors: false, hasCSP: false },
      hasRateLimiting: false,
      hasInputValidation: false,
      hasSqlInjectionPrevention: false,
    },
    radar: {
      modern: [],
      stable: [],
      legacy: [],
      risky: [],
      onboardingRisk: { score: 20, grade: "A", factors: [] },
    },
    impacts: [],
  });
});

describe("orchestrateAnalysis", () => {
  it("returns analysis result with correct structure", async () => {
    const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;

    const result = await orchestrateAnalysis({
      repoPath: "/repo",
      repoInfo: mockRepoInfo,
      scanResult: mockScanResult,
      options: defaultOptions,
      styleConfig: defaultStyleConfig,
      progress,
      analysisStart: Date.now() - 1000,
    });

    expect(result.facts).toEqual(mockFacts);
    expect(result.toolCalls).toBe(2);
    expect(result.model).toBe("gpt-4");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records tool calls via progress tracker", async () => {
    const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;

    analyzeRepoMock.mockImplementation(
      async (_path: string, _info: any, _scan: any, _opts: any, onMessage: (msg: string) => void) => {
        onMessage("Tool: readFile");
        onMessage("Processing...");
        return {
          facts: mockFacts,
          stats: { toolCalls: [], model: "gpt-4", tokensUsed: 0 },
        };
      }
    );

    await orchestrateAnalysis({
      repoPath: "/repo",
      repoInfo: mockRepoInfo,
      scanResult: mockScanResult,
      options: defaultOptions,
      styleConfig: defaultStyleConfig,
      progress,
      analysisStart: Date.now(),
    });

    expect(progress.recordToolCall).toHaveBeenCalledWith("readFile");
    expect(progress.update).toHaveBeenCalledWith("Tool: readFile");
    expect(progress.update).toHaveBeenCalledWith("Processing...");
  });

  it("calls progress.succeed on completion", async () => {
    const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;

    await orchestrateAnalysis({
      repoPath: "/repo",
      repoInfo: mockRepoInfo,
      scanResult: mockScanResult,
      options: defaultOptions,
      styleConfig: defaultStyleConfig,
      progress,
      analysisStart: Date.now(),
    });

    expect(progress.succeed).toHaveBeenCalledWith("Analysis complete");
  });
});

describe("prepareOutputDocuments", () => {
  it("generates core documents", async () => {
    const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;

    const result = await prepareOutputDocuments({
      repoPath: "/repo",
      repoInfo: mockRepoInfo,
      scanResult: mockScanResult,
      facts: mockFacts,
      options: defaultOptions,
      config: null,
      styleConfig: defaultStyleConfig,
      progress,
    });

    const docNames = result.documents.map(d => d.name);
    expect(docNames).toContain("BOOTCAMP.md");
    expect(docNames).toContain("ONBOARDING.md");
    expect(docNames).toContain("ARCHITECTURE.md");
    expect(docNames).toContain("CODEMAP.md");
    expect(docNames).toContain("FIRST_TASKS.md");
    expect(docNames).toContain("diagrams.mmd");
    expect(docNames).toContain("repo_facts.json");
  });

  it("includes optional sections when style config enables them", async () => {
    const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;

    const result = await prepareOutputDocuments({
      repoPath: "/repo",
      repoInfo: mockRepoInfo,
      scanResult: mockScanResult,
      facts: mockFacts,
      options: defaultOptions,
      config: null,
      styleConfig: defaultStyleConfig,
      progress,
    });

    const docNames = result.documents.map(d => d.name);
    expect(docNames).toContain("RUNBOOK.md");
    expect(docNames).toContain("SECURITY.md");
    expect(docNames).toContain("RADAR.md");
  });

  it("excludes optional sections when style config disables them", async () => {
    const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;
    const minimalStyle: StyleConfig = {
      ...defaultStyleConfig,
      sections: {
        showRunbook: false,
        showSecurityDetails: false,
        showRadar: false,
        showDependencyGraph: false,
        showImpact: false,
      },
    };

    const result = await prepareOutputDocuments({
      repoPath: "/repo",
      repoInfo: mockRepoInfo,
      scanResult: mockScanResult,
      facts: mockFacts,
      options: defaultOptions,
      config: null,
      styleConfig: minimalStyle,
      progress,
    });

    const docNames = result.documents.map(d => d.name);
    expect(docNames).not.toContain("RUNBOOK.md");
    expect(docNames).not.toContain("SECURITY.md");
    expect(docNames).not.toContain("RADAR.md");
  });

  it("slices firstTasks to firstTasksCount", async () => {
    const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;
    const style3Tasks: StyleConfig = { ...defaultStyleConfig, firstTasksCount: 3 };

    const result = await prepareOutputDocuments({
      repoPath: "/repo",
      repoInfo: mockRepoInfo,
      scanResult: mockScanResult,
      facts: mockFacts,
      options: defaultOptions,
      config: null,
      styleConfig: style3Tasks,
      progress,
    });

    expect(result.facts.firstTasks.length).toBe(3);
  });

  it("calls runParallelAnalysis with cache options", async () => {
    const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;

    await prepareOutputDocuments({
      repoPath: "/repo",
      repoInfo: mockRepoInfo,
      scanResult: mockScanResult,
      facts: mockFacts,
      options: defaultOptions,
      config: null,
      styleConfig: defaultStyleConfig,
      progress,
    });

    expect(runParallelAnalysisMock).toHaveBeenCalledWith(
      "/repo",
      mockScanResult,
      progress,
      expect.objectContaining({
        repoFullName: "test-owner/test-repo",
        commitSha: "abc123",
      })
    );
  });

  it("includes IMPACT.md when impacts are present", async () => {
    const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;
    runParallelAnalysisMock.mockResolvedValue({
      deps: null,
      security: { score: 85, authPatterns: [], securityDeps: [], findings: [], secretsHandling: { envFiles: [], configFiles: [], gitignoreSecrets: true, hasEnvExample: false }, headers: { hasHelmet: false, hasCors: false, hasCSP: false }, hasRateLimiting: false, hasInputValidation: false, hasSqlInjectionPrevention: false },
      radar: { modern: [], stable: [], legacy: [], risky: [], onboardingRisk: { score: 20, grade: "A", factors: [] } },
      impacts: [{ file: "src/index.ts", affectedFiles: ["src/app.ts"], affectedTests: [], affectedDocs: [], importedBy: [], imports: [] }],
    });

    const result = await prepareOutputDocuments({
      repoPath: "/repo",
      repoInfo: mockRepoInfo,
      scanResult: mockScanResult,
      facts: mockFacts,
      options: defaultOptions,
      config: null,
      styleConfig: defaultStyleConfig,
      progress,
    });

    expect(result.documents.map(d => d.name)).toContain("IMPACT.md");
  });

  it("excludes IMPACT.md when impacts are empty", async () => {
    const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;

    const result = await prepareOutputDocuments({
      repoPath: "/repo",
      repoInfo: mockRepoInfo,
      scanResult: mockScanResult,
      facts: mockFacts,
      options: defaultOptions,
      config: null,
      styleConfig: defaultStyleConfig,
      progress,
    });

    expect(result.documents.map(d => d.name)).not.toContain("IMPACT.md");
  });
});
