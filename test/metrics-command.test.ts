import { describe, it, expect, vi, beforeEach } from "vitest";

import type { CodebaseMetrics } from "../src/metrics.js";

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

const computeCodebaseMetricsMock = vi.fn();
vi.mock("../src/metrics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/metrics.js")>();
  return {
    ...actual,
    computeCodebaseMetrics: (...args: any[]) => computeCodebaseMetricsMock(...args),
  };
});

import { runMetricsCommand } from "../src/commands/metrics-command.js";

function makeMetrics(score: number): CodebaseMetrics {
  return {
    totalFiles: 42,
    totalBytes: 123_456,
    sourceFiles: 20,
    sourceBytes: 90_000,
    testFiles: 12,
    docFiles: 4,
    configFiles: 5,
    otherFiles: 1,
    averageFileBytes: 2_939,
    medianFileBytes: 1_500,
    testToSourceRatio: 0.6,
    languages: [
      { language: "TypeScript", files: 30, bytes: 100_000, percentage: 81 },
      { language: "JavaScript", files: 2, bytes: 23_456, percentage: 19 },
    ],
    hotspots: [{ path: "src/big.ts", bytes: 40_000, language: "TypeScript" }],
    directories: [{ path: "src", files: 20, bytes: 90_000, percentage: 72.9 }],
    sizeClass: "small",
    approachability: {
      score,
      grade: score >= 80 ? "B" : score >= 70 ? "C" : "F",
      factors: ["Compact codebase is quick to navigate"],
    },
  };
}

function localSource() {
  return {
    path: "/repo",
    isLocal: true,
    repoName: "repo",
    repoInfo: { owner: "local", repo: "repo", fullName: "local/repo" },
    cleanup: () => mockCleanup(),
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

describe("runMetricsCommand", () => {
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
    computeCodebaseMetricsMock.mockReturnValue(makeMetrics(82));
    resolveRepoMock.mockResolvedValue(remoteSource());
  });

  it("scans the repo, computes metrics, prints a report, and cleans up", async () => {
    await runMetricsCommand("https://github.com/test/repo", {});
    expect(scanMock).toHaveBeenCalledWith("/tmp/cloned-repo", 500);
    expect(computeCodebaseMetricsMock).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("honors a custom maxFiles", async () => {
    await runMetricsCommand("https://github.com/test/repo", { maxFiles: 123 });
    expect(scanMock).toHaveBeenCalledWith("/tmp/cloned-repo", 123);
  });

  it("emits JSON when --json is set", async () => {
    await runMetricsCommand("https://github.com/test/repo", { json: true });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.repo).toBe("test/repo");
    expect(parsed.filesScanned).toBe(0);
    expect(parsed.approachability.score).toBe(82);
    expect(parsed.approachability.grade).toBe("B");
    expect(parsed.sizeClass).toBe("small");
    expect(Array.isArray(parsed.languages)).toBe(true);
    expect(Array.isArray(parsed.hotspots)).toBe(true);
  });

  it("exits non-zero with --check when the approachability score is below the minimum", async () => {
    computeCodebaseMetricsMock.mockReturnValue(makeMetrics(50));
    await expect(
      runMetricsCommand("https://github.com/test/repo", { check: true, minScore: 70 })
    ).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("does not exit with --check when the score meets the minimum", async () => {
    computeCodebaseMetricsMock.mockReturnValue(makeMetrics(82));
    await runMetricsCommand("https://github.com/test/repo", { check: true, minScore: 70 });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("resolves and reports on a local path", async () => {
    resolveRepoMock.mockResolvedValue(localSource());
    await runMetricsCommand("./local-repo", {});
    expect(resolveRepoMock).toHaveBeenCalledWith("./local-repo", expect.any(String), undefined);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("keeps the temporary clone with --keep-temp for remote repos", async () => {
    await runMetricsCommand("https://github.com/test/repo", { keepTemp: true });
    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it("exits non-zero and cleans up when scanning fails", async () => {
    scanMock.mockRejectedValueOnce(new Error("scan boom"));
    await expect(runMetricsCommand("https://github.com/test/repo", {})).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("exits 1 when the repository cannot be resolved", async () => {
    resolveRepoMock.mockRejectedValueOnce(new Error("nope"));
    await expect(runMetricsCommand("https://github.com/test/repo", {})).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
