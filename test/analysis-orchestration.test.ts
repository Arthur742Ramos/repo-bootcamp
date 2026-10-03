/**
 * Tests for analysis orchestration service (src/services/analysis-orchestration.ts)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BootcampOptions, RepoFacts, RepoInfo, ScanResult } from "../src/types.js";
import type { StyleConfig } from "../src/plugins.js";

const { analyzeRepoMock, runParallelAnalysisMock } = vi.hoisted(() => ({
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

// orchestrateAnalysis now consults the on-disk facts cache (E8). Stub it to a
// deterministic miss so these tests exercise the live analyzeRepo path and do
// not read/write the real ~/.cache directory (which would leak state between
// tests — an earlier test's writeCache would satisfy a later test's readCache).
vi.mock("../src/cache.js", () => ({
  readCache: vi.fn().mockResolvedValue(null),
  writeCache: vi.fn().mockResolvedValue(undefined),
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

import {
  orchestrateAnalysis,
  prepareOutputDocuments,
} from "../src/services/analysis-orchestration.js";
import { analyzeDiff } from "../src/diff.js";
import { generateOnboarding } from "../src/generator.js";
import { ProgressTracker } from "../src/progress.js";
import { readCache, writeCache } from "../src/cache.js";
import { scanRepo } from "../src/ingest.js";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

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
  url: "https://github.com/test-owner/test-repo",
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
  quickstart: {
    prerequisites: ["Task 3"],
    steps: ["Read CONTRIBUTING"],
    commands: [],
    commonErrors: [],
    sources: ["README.md"],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readCache).mockResolvedValue(null);

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
      secretsHandling: {
        envFiles: [],
        configFiles: [],
        gitignoreSecrets: true,
        hasEnvExample: false,
      },
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
  it("hydrates scoped Go conventions from live or cached empty facts, preserves explicit commands, and fingerprints loaded manifests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bootcamp-go-cache-"));
    try {
      await mkdir(join(dir, "packages/app/pkg"), { recursive: true });
      await writeFile(join(dir, "go.work"), "go 1.22\nuse ./packages/app\n");
      await writeFile(join(dir, "packages/app/go.mod"), "module example.invalid/app-a\ngo 1.22\n");
      await writeFile(join(dir, "packages/app/pkg/demo.go"), "package demo\n");
      const root = await scanRepo(dir, 100);
      const first = await scanRepo(dir, 100, { subdir: "packages/app" });
      await writeFile(join(dir, "packages/app/go.mod"), "module example.invalid/app-b\ngo 1.22\n");
      const edited = await scanRepo(dir, 100, { subdir: "packages/app" });
      await writeFile(join(dir, "packages/app/pkg/demo.go"), "// fake demo\n");
      const sourceChanged = await scanRepo(dir, 100, { subdir: "packages/app" });
      await writeFile(join(dir, "packages/app/pkg/demo.go"), "package demo\n");
      const sourceExcluded = await scanRepo(dir, 100, {
        subdir: "packages/app",
        exclude: ["**/*.go"],
      });
      const limited = await scanRepo(dir, 1, { subdir: "packages/app" });
      const excluded = await scanRepo(dir, 100, { subdir: "packages/app", exclude: ["go.mod"] });
      const ancestor = await scanRepo(dir, 100, { subdir: "packages/app/pkg" });
      expect(root.commands).toEqual([]);
      expect(ancestor.commands).toEqual([]);
      expect(excluded.commands).toEqual([]);
      expect(first.commands.map(({ command }) => command)).toEqual([
        "go build ./...",
        "go test ./...",
      ]);
      expect(first.commands).toEqual(edited.commands);
      expect(first.files).toEqual(edited.files);
      expect(first.goModFingerprint).not.toBe(edited.goModFingerprint);
      expect(sourceChanged.files).toEqual(edited.files);
      expect(sourceChanged.commands).toEqual([]);
      expect(sourceChanged.goModFingerprint).toBe(edited.goModFingerprint);
      expect(sourceChanged.goPackageFingerprint).not.toBe(edited.goPackageFingerprint);
      expect(sourceExcluded.commands).toEqual([]);
      expect(limited.commands).toEqual([]);
      expect(first.taskfileFingerprint).toBeUndefined();
      expect(edited.taskfileFingerprint).toBeUndefined();
      expect(excluded.goModFingerprint).toBeUndefined();
      expect(excluded.taskfileFingerprint).toBeUndefined();
      const fingerprints: string[] = [];
      for (const cached of [false, true]) {
        for (const scanResult of [first, edited, sourceChanged, excluded]) {
          const facts = structuredClone(mockFacts);
          if (cached) vi.mocked(readCache).mockResolvedValue(facts);
          else {
            vi.mocked(readCache).mockResolvedValue(null);
            analyzeRepoMock.mockResolvedValue({
              facts,
              stats: { toolCalls: [], model: "fixture" },
            });
          }
          const result = await orchestrateAnalysis({
            repoPath: join(dir, "packages/app"),
            repoInfo: mockRepoInfo,
            scanResult,
            options: { ...defaultOptions, subdir: "packages/app" },
            styleConfig: defaultStyleConfig,
            progress: { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any,
            analysisStart: Date.now(),
          });
          expect(result.facts.quickstart.commands).toEqual(scanResult.commands);
          fingerprints.push(vi.mocked(readCache).mock.calls.at(-1)![2]!.scanFingerprint!);
        }
      }
      expect(new Set(fingerprints).size).toBe(4);
      const explicit = structuredClone(mockFacts);
      explicit.quickstart.commands = [
        { name: "documented", command: "go test -race ./...", source: "README.md" },
      ];
      vi.mocked(readCache).mockResolvedValue(explicit);
      const result = await orchestrateAnalysis({
        repoPath: dir,
        repoInfo: mockRepoInfo,
        scanResult: first,
        options: defaultOptions,
        styleConfig: defaultStyleConfig,
        progress: { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any,
        analysisStart: Date.now(),
      });
      expect(result.facts).toBe(explicit);
      expect(result.facts.quickstart.commands).toEqual(explicit.quickstart.commands);
      await writeFile(
        join(dir, "packages/app/Taskfile.yml"),
        "includes: {checks: './checks.yml'}\n"
      );
      await writeFile(join(dir, "packages/app/checks.yml"), "tasks: {verify: 'echo verify'}\n");
      const withTasks = await scanRepo(dir, 100, { subdir: "packages/app" });
      await writeFile(join(dir, "packages/app/go.mod"), "module example.invalid/app-c\ngo 1.22\n");
      const changedGo = await scanRepo(dir, 100, { subdir: "packages/app" });
      const hiddenGo = await scanRepo(dir, 100, { subdir: "packages/app", exclude: ["go.mod"] });
      const hiddenTasks = await scanRepo(dir, 100, {
        subdir: "packages/app",
        exclude: ["checks.yml"],
      });
      expect(withTasks.taskfileFingerprint).toBeDefined();
      expect(changedGo.taskfileFingerprint).toBe(withTasks.taskfileFingerprint);
      expect(hiddenGo.taskfileFingerprint).toBe(withTasks.taskfileFingerprint);
      expect(changedGo.goModFingerprint).not.toBe(withTasks.goModFingerprint);
      expect(changedGo.goPackageFingerprint).toBe(withTasks.goPackageFingerprint);
      expect(hiddenGo.goModFingerprint).toBeUndefined();
      expect(hiddenTasks.taskfileFingerprint).toBeDefined();
      expect(hiddenTasks.taskfileFingerprint).not.toBe(withTasks.taskfileFingerprint);
      expect(hiddenTasks.goModFingerprint).toBe(changedGo.goModFingerprint);
      expect(hiddenTasks.goPackageFingerprint).toBe(changedGo.goPackageFingerprint);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it.each([false, true])(
    "hydrates Cargo defaults without mutating raw facts for cached=%s",
    async (cached) => {
      const facts = structuredClone(mockFacts);
      const original = structuredClone(facts);
      const commands = [
        { name: "build", command: "cargo build", source: "Cargo.toml" },
        { name: "test", command: "cargo test", source: "Cargo.toml" },
      ];
      if (cached) vi.mocked(readCache).mockResolvedValue(facts);
      else analyzeRepoMock.mockResolvedValue({ facts, stats: { toolCalls: [], model: "fixture" } });
      const result = await orchestrateAnalysis({
        repoPath: "/repo",
        repoInfo: mockRepoInfo,
        scanResult: { ...mockScanResult, commands, cargoFingerprint: "a".repeat(64) },
        options: defaultOptions,
        styleConfig: defaultStyleConfig,
        progress: { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any,
        analysisStart: Date.now(),
      });
      expect(result.facts.quickstart.commands).toEqual(commands);
      expect(facts).toEqual(original);
      if (!cached) expect(vi.mocked(writeCache).mock.calls[0][2]).toBe(facts);
    }
  );
  const detected = [
    { name: "app:test", command: "task app:test", source: "Taskfile", description: "App tests" },
  ];
  const analyze = (
    facts: RepoFacts,
    cached: boolean,
    options: BootcampOptions = defaultOptions
  ) => {
    if (cached) vi.mocked(readCache).mockResolvedValue(facts);
    else analyzeRepoMock.mockResolvedValue({ facts, stats: { toolCalls: [], model: "fixture" } });
    return orchestrateAnalysis({
      repoPath: "/repo",
      repoInfo: mockRepoInfo,
      scanResult: { ...mockScanResult, commands: detected },
      options,
      styleConfig: defaultStyleConfig,
      progress: { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any,
      analysisStart: Date.now(),
    });
  };
  it.each([false, true])(
    "fills only empty commands for cached=%s while preserving quickstart fields and source facts",
    async (cached) => {
      const facts = structuredClone(mockFacts);
      const original = structuredClone(facts);
      const result = await analyze(facts, cached);
      expect(result.facts.quickstart).toEqual({ ...original.quickstart, commands: detected });
      expect(facts).toEqual(original);
      expect(result.facts.quickstart.commands).not.toBe(detected);
      if (cached) expect(analyzeRepoMock).not.toHaveBeenCalled();
      else expect(vi.mocked(writeCache).mock.calls[0][2]).toBe(facts);
    }
  );
  it.each([false, true])(
    "preserves every nonempty explicit command for cached=%s",
    async (cached) => {
      const facts = {
        ...mockFacts,
        quickstart: {
          ...mockFacts.quickstart,
          commands: [
            {
              name: "documented",
              command: "task custom:check\n# documented flags",
              source: "README.md",
            },
          ],
        },
      };
      expect((await analyze(facts, cached)).facts).toBe(facts);
    }
  );
  it.each([false, true])("repairs empty command lists with fast=%s", async (fast) => {
    const options = { ...defaultOptions, fast };
    expect((await analyze(mockFacts, false, options)).facts.quickstart.commands).toEqual(detected);
    expect(analyzeRepoMock.mock.calls[0][3]).toBe(options);
  });
  it("changes phase-cache identity for included edits and excludes hidden commands from hydrated facts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bootcamp-task-cache-"));
    try {
      await writeFile(join(dir, "Taskfile.yml"), "includes: {app: './child.yml'}");
      await writeFile(join(dir, "child.yml"), "tasks: {test: 'echo test'}");
      const scans = [await scanRepo(dir, 100)];
      await writeFile(join(dir, "child.yml"), "tasks: {test: 'echo best'}");
      scans.push(await scanRepo(dir, 100));
      await writeFile(join(dir, "child.yml"), "tasks: {lint: 'echo lint'}");
      scans.push(await scanRepo(dir, 100), await scanRepo(dir, 100, { exclude: ["child.yml"] }));
      const identities: string[] = [];
      for (const scanResult of scans) {
        vi.mocked(readCache).mockResolvedValue(mockFacts);
        const result = await orchestrateAnalysis({
          repoPath: dir,
          repoInfo: mockRepoInfo,
          scanResult,
          options: defaultOptions,
          styleConfig: defaultStyleConfig,
          progress: { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any,
          analysisStart: Date.now(),
        });
        expect(result.facts.quickstart.commands).toEqual(scanResult.commands);
        identities.push(vi.mocked(readCache).mock.calls.at(-1)![2]!.scanFingerprint!);
      }
      expect(new Set(identities).size).toBe(4);
      expect(scans[0].commands[0].name).toBe("app:test");
      expect(scans[1].commands).toEqual(scans[0].commands);
      expect(scans[1].files).toEqual(scans[0].files);
      expect(scans[2].commands[0].name).toBe("app:lint");
      expect(scans[3].commands).toEqual([]);
      await writeFile(join(dir, "child.yml"), "tasks: {devs: 'echo devs'}");
      const excludedAgain = await scanRepo(dir, 100, { exclude: ["child.yml"] });
      expect(excludedAgain.taskfileFingerprint).toBe(scans[3].taskfileFingerprint);
      expect(analyzeRepoMock).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
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
      async (
        _path: string,
        _info: any,
        _scan: any,
        _opts: any,
        onMessage: (msg: string) => void
      ) => {
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
  it("passes the selected local checkout into onboarding generation", async () => {
    const repoInfo = { ...mockRepoInfo, url: "file:///repo", sourcePathPrefix: "packages/my app" };
    await prepareOutputDocuments({
      repoPath: "/repo/packages/my app",
      repositoryRoot: "/repo",
      repoInfo,
      scanResult: mockScanResult,
      facts: mockFacts,
      options: defaultOptions,
      config: null,
      styleConfig: defaultStyleConfig,
      progress: { update: vi.fn() } as any,
    });
    expect(generateOnboarding).toHaveBeenCalledWith(expect.anything(), defaultOptions, {
      repoInfo,
      localPath: "/repo/packages/my app",
    });
  });
  it("passes the requested tag through detached-HEAD metadata to onboarding", async () => {
    const repoInfo = { ...mockRepoInfo, branch: "HEAD" };
    const options = { ...defaultOptions, branch: "v2.0" };
    await prepareOutputDocuments({
      repoPath: "/repo",
      repoInfo,
      scanResult: mockScanResult,
      facts: mockFacts,
      options,
      config: null,
      styleConfig: defaultStyleConfig,
      progress: { update: vi.fn() } as any,
    });
    expect(generateOnboarding).toHaveBeenCalledWith(expect.anything(), options, {
      repoInfo,
      localPath: undefined,
      ref: "v2.0",
    });
  });
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

    const docNames = result.documents.map((d) => d.name);
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

    const docNames = result.documents.map((d) => d.name);
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

    const docNames = result.documents.map((d) => d.name);
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
      options: {
        ...defaultOptions,
        subdir: "packages/api",
        maxFiles: 13,
        exclude: ["**/generated/**"],
      },
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
        generationOptions: expect.objectContaining({
          subdir: "packages/api",
          maxFiles: 13,
          exclude: ["**/generated/**"],
        }),
      })
    );
  });

  it("keeps Git comparison at the outer checkout while analyzing selected files", async () => {
    const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;
    await prepareOutputDocuments({
      repoPath: "/repo/packages/app",
      repositoryRoot: "/repo",
      repoInfo: mockRepoInfo,
      scanResult: mockScanResult,
      facts: mockFacts,
      options: { ...defaultOptions, compare: "HEAD~1", subdir: "packages/app" },
      config: null,
      styleConfig: defaultStyleConfig,
      progress,
    });
    expect(analyzeDiff).toHaveBeenCalledWith("/repo", "HEAD~1", "HEAD");
    expect(runParallelAnalysisMock).toHaveBeenCalledWith(
      "/repo/packages/app",
      mockScanResult,
      progress,
      expect.any(Object)
    );
  });

  it("includes IMPACT.md when impacts are present", async () => {
    const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;
    runParallelAnalysisMock.mockResolvedValue({
      deps: null,
      security: {
        score: 85,
        authPatterns: [],
        securityDeps: [],
        findings: [],
        secretsHandling: {
          envFiles: [],
          configFiles: [],
          gitignoreSecrets: true,
          hasEnvExample: false,
        },
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
      impacts: [
        {
          file: "src/index.ts",
          affectedFiles: ["src/app.ts"],
          affectedTests: [],
          affectedDocs: [],
          importedBy: [],
          imports: [],
        },
      ],
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

    expect(result.documents.map((d) => d.name)).toContain("IMPACT.md");
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

    expect(result.documents.map((d) => d.name)).not.toContain("IMPACT.md");
  });
});
