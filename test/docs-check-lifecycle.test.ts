import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocsAnalysisResult } from "../src/docs-analyzer.js";

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  resolve: vi.fn(),
  analyze: vi.fn(),
  fix: vi.fn(),
}));

vi.mock("../src/repo-resolver.js", () => ({
  isLocalPath: () => false,
  resolveRepo: mocks.resolve,
}));
vi.mock("../src/docs-analyzer.js", () => ({ analyzeDocumentation: mocks.analyze }));
vi.mock("../src/docs-fixer.js", () => ({ fixDocumentation: mocks.fix }));

import { runDocsCommand } from "../src/commands/docs-command.js";

function analysis(stale: boolean): DocsAnalysisResult {
  return {
    versionMismatches: stale
      ? [{ type: "node", documented: "18", actual: ">=20", location: "README.md" }]
      : [],
    frameworkIssues: [],
    cliDrift: [],
    prerequisiteIssues: [],
    badgeIssues: [],
    isStale: stale,
    summary: { errors: stale ? 1 : 0, warnings: 0, ok: stale ? 0 : 1 },
  };
}

describe("docs command gate and clone lifecycle", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cleanup.mockResolvedValue(undefined);
    mocks.resolve.mockResolvedValue({
      path: "/tmp/docs-fixture-clone",
      isLocal: false,
      repoInfo: { fullName: "owner/fixture" },
      cleanup: mocks.cleanup,
    });
    mocks.analyze.mockResolvedValue(analysis(true));
    mocks.fix.mockResolvedValue({ filesModified: 1, changesApplied: 1, results: [] });
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit requested");
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  async function expectCleanFailure(options: { check?: boolean; fix?: boolean }) {
    await expect(runDocsCommand("https://github.com/owner/fixture", options)).rejects.toThrow(
      "exit requested"
    );
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mocks.cleanup.mock.invocationCallOrder[0]).toBeLessThan(
      exitSpy.mock.invocationCallOrder[0]
    );
  }

  it("cleans a remote clone before a stale check exits", async () => {
    await expectCleanFailure({ check: true });
    expect(mocks.fix).not.toHaveBeenCalled();
  });

  it("gates on the repaired analysis and cleans the clone after success", async () => {
    mocks.analyze.mockResolvedValueOnce(analysis(true)).mockResolvedValueOnce(analysis(false));
    await runDocsCommand("https://github.com/owner/fixture", { check: true, fix: true });
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(mocks.analyze).toHaveBeenNthCalledWith(2, "/tmp/docs-fixture-clone");
    expect(logSpy.mock.calls.flat().join("\n")).toContain("up to date after fixes");
    expect(exitSpy).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });

  it("retains the failure gate when automatic repairs leave unresolved issues", async () => {
    await expectCleanFailure({ check: true, fix: true });
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("remains stale after automatic fixes");
  });

  it("does not claim a successful repair when no automatic fixes exist", async () => {
    mocks.fix.mockResolvedValue({ filesModified: 0, changesApplied: 0, results: [] });
    await expectCleanFailure({ check: true, fix: true });
    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls.flat().join("\n")).toContain("No automatic fixes available");
  });

  it.each(["analysis", "repair", "recheck"])(
    "cleans up and reports a %s failure before exiting",
    async (phase) => {
      if (phase === "analysis") mocks.analyze.mockRejectedValue(new Error("read failed"));
      if (phase === "repair") mocks.fix.mockRejectedValue(new Error("write failed"));
      if (phase === "recheck")
        mocks.analyze
          .mockResolvedValueOnce(analysis(true))
          .mockRejectedValueOnce(new Error("recheck failed"));
      await expectCleanFailure({ check: true, fix: true });
      expect(errorSpy.mock.calls.flat().join("\n")).toContain("Documentation analysis failed:");
    }
  );
});
