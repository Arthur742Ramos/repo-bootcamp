import { describe, it, expect, vi, beforeEach } from "vitest";

import type { RepoHealth } from "../src/health.js";
import type { CodebaseMetrics } from "../src/metrics.js";
import type { SecurityAnalysis } from "../src/security.js";

vi.mock("chalk", () => {
  const makeChalk = (): any =>
    new Proxy((...args: any[]) => args.join(""), {
      get: () => makeChalk(),
      apply: (_t: any, _a: any, args: any[]) => args.join(""),
    });
  return { default: makeChalk() };
});

const mockCleanup = vi.fn().mockResolvedValue(undefined);
const resolveRepoMock = vi.fn();
vi.mock("../src/repo-resolver.js", () => ({
  resolveRepo: (...args: any[]) => resolveRepoMock(...args),
}));

const scanMock = vi.fn();
vi.mock("../src/services/clone-service.js", () => ({
  scanRepositoryFiles: (...args: any[]) => scanMock(...args),
}));

const computeRepoHealthMock = vi.fn();
vi.mock("../src/health.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/health.js")>();
  return { ...actual, computeRepoHealth: (...a: any[]) => computeRepoHealthMock(...a) };
});

const computeCodebaseMetricsMock = vi.fn();
vi.mock("../src/metrics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/metrics.js")>();
  return { ...actual, computeCodebaseMetrics: (...a: any[]) => computeCodebaseMetricsMock(...a) };
});

const analyzeSecurityPatternsMock = vi.fn();
vi.mock("../src/security.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/security.js")>();
  return { ...actual, analyzeSecurityPatterns: (...a: any[]) => analyzeSecurityPatternsMock(...a) };
});

vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("no package.json")),
}));

import { runScanCommand, combinedScores } from "../src/commands/scan-command.js";

function makeHealth(score: number): RepoHealth {
  return {
    score,
    grade: score >= 80 ? "B" : "F",
    earnedWeight: 8,
    totalWeight: 10,
    passCount: 10,
    warnCount: 1,
    failCount: 2,
    checks: [],
    recommendations: ["Add a CODE_OF_CONDUCT.md"],
  } as unknown as RepoHealth;
}

function makeMetrics(score: number): CodebaseMetrics {
  return {
    totalFiles: 50,
    totalBytes: 1000,
    sourceFiles: 20,
    sourceBytes: 800,
    testFiles: 12,
    docFiles: 4,
    configFiles: 5,
    otherFiles: 9,
    averageFileBytes: 20,
    medianFileBytes: 15,
    testToSourceRatio: 0.6,
    languages: [],
    hotspots: [],
    directories: [],
    sizeClass: "small",
    approachability: { score, grade: score >= 80 ? "B" : "F", factors: ["Above-average file size"] },
  };
}

function makeSecurity(score: number): SecurityAnalysis {
  return {
    score,
    authPatterns: [],
    securityDeps: [],
    findings: [
      { category: "x", title: "SQL injection risk", description: "", severity: "high", recommendation: "Parameterize" },
    ],
    secretsHandling: { envFiles: [], configFiles: [], gitignoreSecrets: true, hasEnvExample: true },
    headers: { hasHelmet: true, hasCors: true, hasCSP: true },
    hasRateLimiting: true,
    hasInputValidation: true,
    hasSqlInjectionPrevention: false,
  };
}

function remoteSource() {
  return {
    path: "/tmp/cloned-repo",
    isLocal: false,
    repoName: "repo",
    repoInfo: { owner: "test", repo: "repo", fullName: "test/repo" },
    cleanup: () => mockCleanup(),
  };
}

describe("combinedScores", () => {
  it("extracts the three headline scores and the lowest", () => {
    const scores = combinedScores(makeHealth(88), makeMetrics(82), makeSecurity(100));
    expect(scores).toEqual({ health: 88, metrics: 82, security: 100, lowest: 82 });
  });

  it("picks security as lowest when it is the worst", () => {
    const scores = combinedScores(makeHealth(90), makeMetrics(85), makeSecurity(40));
    expect(scores.lowest).toBe(40);
  });
});

describe("runScanCommand", () => {
  const mockExit = vi
    .spyOn(process, "exit")
    .mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockClear();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    scanMock.mockResolvedValue({ files: [], readme: null, stack: {} });
    computeRepoHealthMock.mockReturnValue(makeHealth(88));
    computeCodebaseMetricsMock.mockReturnValue(makeMetrics(82));
    analyzeSecurityPatternsMock.mockResolvedValue(makeSecurity(100));
    resolveRepoMock.mockResolvedValue(remoteSource());
  });

  it("runs all three analyses from one scan and prints a combined report", async () => {
    await runScanCommand("https://github.com/test/repo", {});
    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(computeRepoHealthMock).toHaveBeenCalled();
    expect(computeCodebaseMetricsMock).toHaveBeenCalled();
    expect(analyzeSecurityPatternsMock).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("emits combined JSON with all three reports and a score summary", async () => {
    await runScanCommand("https://github.com/test/repo", { json: true });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.repo).toBe("test/repo");
    expect(parsed.scores.health.score).toBe(88);
    expect(parsed.scores.metrics.score).toBe(82);
    expect(parsed.scores.security.score).toBe(100);
    expect(parsed.scores.lowest).toBe(82);
    expect(parsed.health).toBeDefined();
    expect(parsed.metrics).toBeDefined();
    expect(parsed.security).toBeDefined();
  });

  it("exits non-zero with --check when the lowest score is below the minimum", async () => {
    computeCodebaseMetricsMock.mockReturnValue(makeMetrics(50));
    await expect(
      runScanCommand("https://github.com/test/repo", { check: true, minScore: 70 })
    ).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("does not exit with --check when all three meet the minimum", async () => {
    await runScanCommand("https://github.com/test/repo", { check: true, minScore: 70 });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("keeps the temporary clone with --keep-temp for remote repos", async () => {
    await runScanCommand("https://github.com/test/repo", { keepTemp: true });
    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it("exits non-zero and cleans up when scanning fails", async () => {
    scanMock.mockRejectedValueOnce(new Error("scan boom"));
    await expect(runScanCommand("https://github.com/test/repo", {})).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("exits 1 when the repository cannot be resolved", async () => {
    resolveRepoMock.mockRejectedValueOnce(new Error("nope"));
    await expect(runScanCommand("https://github.com/test/repo", {})).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
