import { describe, it, expect, vi, beforeEach } from "vitest";

import type { TechRadar } from "../src/types.js";

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

const extractDependenciesMock = vi.fn();
vi.mock("../src/deps.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/deps.js")>();
  return { ...actual, extractDependencies: (...a: any[]) => extractDependenciesMock(...a) };
});

const analyzeSecurityPatternsMock = vi.fn();
vi.mock("../src/security.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/security.js")>();
  return { ...actual, analyzeSecurityPatterns: (...a: any[]) => analyzeSecurityPatternsMock(...a) };
});

const generateTechRadarMock = vi.fn();
vi.mock("../src/radar.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/radar.js")>();
  return { ...actual, generateTechRadar: (...a: any[]) => generateTechRadarMock(...a) };
});

vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("no package.json")),
}));

import { runRadarCommand } from "../src/commands/radar-command.js";

function makeRadar(score: number): TechRadar {
  return {
    modern: [{ name: "TypeScript", category: "modern", reason: "Type-safe JavaScript" }],
    stable: [{ name: "CI/CD", category: "stable", reason: "Automated testing" }],
    legacy: [{ name: "express", category: "legacy", reason: "Consider Hono" }],
    risky: [],
    onboardingRisk: {
      score,
      grade: score <= 20 ? "A" : score <= 50 ? "C" : "F",
      factors: score > 0 ? ["Missing CONTRIBUTING guide"] : [],
    },
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

describe("runRadarCommand", () => {
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
    scanMock.mockResolvedValue({
      files: [],
      stack: { languages: [], hasCi: false, hasDocker: false },
      readme: "x",
      contributing: null,
    });
    extractDependenciesMock.mockResolvedValue(null);
    analyzeSecurityPatternsMock.mockResolvedValue(null);
    generateTechRadarMock.mockReturnValue(makeRadar(10));
    resolveRepoMock.mockResolvedValue(remoteSource());
  });

  it("scans once, builds the radar, prints a report, and cleans up", async () => {
    await runRadarCommand("https://github.com/test/repo", {});
    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(generateTechRadarMock).toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("Tech Radar");
    expect(printed).toContain("Onboarding risk");
    expect(printed).toContain("TypeScript");
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("emits radar JSON with --json", async () => {
    await runRadarCommand("https://github.com/test/repo", { json: true });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.repo).toBe("test/repo");
    expect(parsed.onboardingRisk.score).toBe(10);
    expect(parsed.modern[0].name).toBe("TypeScript");
    expect(parsed.legacy[0].name).toBe("express");
  });

  it("exits non-zero with --check when risk exceeds --max-risk", async () => {
    generateTechRadarMock.mockReturnValue(makeRadar(70));
    await expect(
      runRadarCommand("https://github.com/test/repo", { check: true, maxRisk: 50 })
    ).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("does not exit with --check when risk is within --max-risk", async () => {
    generateTechRadarMock.mockReturnValue(makeRadar(10));
    await runRadarCommand("https://github.com/test/repo", { check: true, maxRisk: 50 });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("passes the scan's doc flags into generateTechRadar", async () => {
    scanMock.mockResolvedValue({
      files: [{ path: "a.ts", size: 1, isDirectory: false }],
      stack: { languages: ["TypeScript"] },
      readme: "yes",
      contributing: null,
    });
    await runRadarCommand("https://github.com/test/repo", {});
    const args = generateTechRadarMock.mock.calls[0];
    expect(args[4]).toBe(true); // hasReadme  (!!readme)
    expect(args[5]).toBe(false); // hasContributing (!!contributing)
  });

  it("keeps the temporary clone with --keep-temp for remote repos", async () => {
    await runRadarCommand("https://github.com/test/repo", { keepTemp: true });
    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it("exits non-zero and cleans up when the scan fails", async () => {
    scanMock.mockRejectedValueOnce(new Error("scan boom"));
    await expect(runRadarCommand("https://github.com/test/repo", {})).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("exits 1 when the repository cannot be resolved", async () => {
    resolveRepoMock.mockRejectedValueOnce(new Error("nope"));
    await expect(runRadarCommand("https://github.com/test/repo", {})).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
