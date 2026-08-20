import { describe, it, expect, vi, beforeEach } from "vitest";

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

const analyzeSecurityPatternsMock = vi.fn();
vi.mock("../src/security.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/security.js")>();
  return {
    ...actual,
    analyzeSecurityPatterns: (...args: any[]) => analyzeSecurityPatternsMock(...args),
  };
});

vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("no package.json")),
}));

import { runSecurityCommand } from "../src/commands/security-command.js";

function makeAnalysis(score: number): SecurityAnalysis {
  return {
    score,
    authPatterns: [],
    securityDeps: [
      { name: "helmet", purpose: "Security headers middleware", type: "security-header" },
    ],
    findings: [
      {
        category: "secrets",
        title: "Environment variable usage",
        description: "Reads process.env",
        severity: "info",
        file: "src/index.ts",
        line: 3,
        recommendation: "Ensure sensitive values are not logged",
      },
      {
        category: "injection",
        title: "Possible SQL injection",
        description: "String-concatenated query",
        severity: "high",
        file: "src/db.ts",
        recommendation: "Use parameterized queries",
      },
    ],
    secretsHandling: {
      envFiles: [],
      configFiles: [],
      gitignoreSecrets: true,
      hasEnvExample: false,
    },
    headers: { hasHelmet: true, hasCors: false, hasCSP: true },
    hasRateLimiting: true,
    hasInputValidation: false,
    hasSqlInjectionPrevention: false,
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

describe("runSecurityCommand", () => {
  const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
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
    analyzeSecurityPatternsMock.mockResolvedValue(makeAnalysis(90));
    resolveRepoMock.mockResolvedValue(remoteSource());
  });

  it("scans the repo, analyzes security, prints a report, and cleans up", async () => {
    await runSecurityCommand("https://github.com/test/repo", {});
    expect(scanMock).toHaveBeenCalledWith("/tmp/cloned-repo", 500);
    expect(analyzeSecurityPatternsMock).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("honors a custom maxFiles", async () => {
    await runSecurityCommand("https://github.com/test/repo", { maxFiles: 50 });
    expect(scanMock).toHaveBeenCalledWith("/tmp/cloned-repo", 50);
  });

  it("emits JSON when --json is set", async () => {
    await runSecurityCommand("https://github.com/test/repo", { json: true });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.repo).toBe("test/repo");
    expect(parsed.filesScanned).toBe(0);
    expect(parsed.score).toBe(90);
    expect(parsed.grade).toBe("A");
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(parsed.findings.length).toBe(2);
  });

  it("exits non-zero with --check when the security score is below the minimum", async () => {
    analyzeSecurityPatternsMock.mockResolvedValue(makeAnalysis(40));
    await expect(
      runSecurityCommand("https://github.com/test/repo", { check: true, minScore: 70 })
    ).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("does not exit with --check when the score meets the minimum", async () => {
    analyzeSecurityPatternsMock.mockResolvedValue(makeAnalysis(90));
    await runSecurityCommand("https://github.com/test/repo", { check: true, minScore: 70 });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("resolves and reports on a local path", async () => {
    resolveRepoMock.mockResolvedValue(localSource());
    await runSecurityCommand("./local-repo", {});
    expect(resolveRepoMock).toHaveBeenCalledWith("./local-repo", expect.any(String), undefined);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("keeps the temporary clone with --keep-temp for remote repos", async () => {
    await runSecurityCommand("https://github.com/test/repo", { keepTemp: true });
    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it("exits non-zero and cleans up when scanning fails", async () => {
    scanMock.mockRejectedValueOnce(new Error("scan boom"));
    await expect(runSecurityCommand("https://github.com/test/repo", {})).rejects.toThrow(
      "process.exit"
    );
    expect(errorSpy).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("exits 1 when the repository cannot be resolved", async () => {
    resolveRepoMock.mockRejectedValueOnce(new Error("nope"));
    await expect(runSecurityCommand("https://github.com/test/repo", {})).rejects.toThrow(
      "process.exit"
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
