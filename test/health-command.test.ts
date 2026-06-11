import { describe, it, expect, vi, beforeEach } from "vitest";

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
vi.mock("../src/health.js", () => ({
  computeRepoHealth: (...args: any[]) => computeRepoHealthMock(...args),
}));

import { runHealthCommand } from "../src/commands/health-command.js";

function makeHealth(score: number) {
  return {
    score,
    grade: score >= 70 ? "C" : "F",
    earnedWeight: score / 10,
    totalWeight: 10,
    passCount: 2,
    warnCount: 1,
    failCount: 3,
    checks: [
      { id: "readme-present", label: "README", category: "Documentation", status: "pass", weight: 3, detail: "README present" },
      { id: "tests", label: "Automated tests", category: "Quality", status: "fail", weight: 3, detail: "Automated tests not found", recommendation: "Add a test suite" },
    ],
    recommendations: score >= 100 ? [] : ["Add a test suite"],
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

describe("runHealthCommand", () => {
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
    computeRepoHealthMock.mockReturnValue(makeHealth(85));
    resolveRepoMock.mockResolvedValue(remoteSource());
  });

  it("scans the repo, computes health, prints a report, and cleans up", async () => {
    await runHealthCommand("https://github.com/test/repo", {});
    expect(scanMock).toHaveBeenCalledWith("/tmp/cloned-repo", 500);
    expect(computeRepoHealthMock).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("emits JSON when --json is set", async () => {
    await runHealthCommand("https://github.com/test/repo", { json: true });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.repo).toBe("test/repo");
    expect(parsed.score).toBe(85);
    expect(parsed.grade).toBe("C");
    expect(Array.isArray(parsed.checks)).toBe(true);
  });

  it("exits non-zero with --check when score is below the minimum", async () => {
    computeRepoHealthMock.mockReturnValue(makeHealth(50));
    await expect(
      runHealthCommand("https://github.com/test/repo", { check: true, minScore: 70 })
    ).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("does not exit with --check when the score meets the minimum", async () => {
    computeRepoHealthMock.mockReturnValue(makeHealth(85));
    await runHealthCommand("https://github.com/test/repo", { check: true, minScore: 70 });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("resolves and reports on a local path", async () => {
    resolveRepoMock.mockResolvedValue(localSource());
    await runHealthCommand("./local-repo", {});
    expect(resolveRepoMock).toHaveBeenCalledWith("./local-repo", expect.any(String), undefined);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("keeps the temporary clone with --keep-temp for remote repos", async () => {
    await runHealthCommand("https://github.com/test/repo", { keepTemp: true });
    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it("exits non-zero and cleans up when scanning fails", async () => {
    scanMock.mockRejectedValueOnce(new Error("scan boom"));
    await expect(runHealthCommand("https://github.com/test/repo", {})).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("exits 1 when the repository cannot be resolved", async () => {
    resolveRepoMock.mockRejectedValueOnce(new Error("nope"));
    await expect(runHealthCommand("https://github.com/test/repo", {})).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
