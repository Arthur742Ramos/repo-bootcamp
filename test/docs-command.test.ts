import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("chalk", () => {
  const makeChalk = (): any => new Proxy((...args: any[]) => args.join(""), {
    get: () => makeChalk(),
    apply: (_t: any, _a: any, args: any[]) => args.join(""),
  });
  return { default: makeChalk() };
});

const mockCleanup = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/repo-resolver.js", () => ({
  isLocalPath: vi.fn((p: string) => p.startsWith(".") || p.startsWith("/")),
  resolveRepo: vi.fn().mockResolvedValue({
    path: "/tmp/resolved-repo",
    isLocal: false,
    repoInfo: { owner: "test", repo: "repo", fullName: "test/repo" },
    cleanup: () => mockCleanup(),
  }),
}));

const mockAnalyze = vi.fn().mockResolvedValue({
  versionMismatches: [],
  frameworkIssues: [],
  cliDrift: [],
  prerequisiteIssues: [],
  badgeIssues: [],
  isStale: false,
  summary: { errors: 0, warnings: 0 },
});
vi.mock("../src/docs-analyzer.js", () => ({
  analyzeDocumentation: (...args: any[]) => mockAnalyze(...args),
}));

const mockFix = vi.fn().mockResolvedValue({ changesApplied: 0, filesModified: 0, results: [] });
vi.mock("../src/docs-fixer.js", () => ({
  fixDocumentation: (...args: any[]) => mockFix(...args),
}));

import { runDocsCommand } from "../src/commands/docs-command.js";

describe("runDocsCommand", () => {
  const mockExit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("process.exit"); }) as any);
  beforeEach(() => { vi.clearAllMocks(); });

  it("runs analysis on a repo URL and cleans up", async () => {
    await runDocsCommand("https://github.com/test/repo", {});
    expect(mockAnalyze).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("handles stale docs with --check and exits 1", async () => {
    mockAnalyze.mockResolvedValueOnce({
      versionMismatches: [{ type: "node", documented: "16", actual: "18", location: "README.md" }],
      frameworkIssues: [],
      cliDrift: [],
      prerequisiteIssues: [],
      badgeIssues: [],
      isStale: true,
      summary: { errors: 1, warnings: 0 },
    });
    await expect(runDocsCommand("https://github.com/test/repo", { check: true })).rejects.toThrow("process.exit");
  });

  it("applies fixes when --fix and stale", async () => {
    mockAnalyze.mockResolvedValueOnce({
      versionMismatches: [],
      frameworkIssues: [{ framework: "React", version: "18" }],
      cliDrift: [],
      prerequisiteIssues: [],
      badgeIssues: [],
      isStale: true,
      summary: { errors: 0, warnings: 1 },
    });
    mockFix.mockResolvedValueOnce({ changesApplied: 1, filesModified: 1, results: [{ file: "README.md", changes: ["added React"] }] });
    await runDocsCommand("https://github.com/test/repo", { fix: true });
    expect(mockFix).toHaveBeenCalled();
  });

  it("handles all issue types in output", async () => {
    mockAnalyze.mockResolvedValueOnce({
      versionMismatches: [{ type: "node", documented: "16", actual: "18", location: "README" }],
      frameworkIssues: [{ framework: "Express" }],
      cliDrift: [{ type: "missing", actual: "build" }, { type: "extra", documented: "deploy" }],
      prerequisiteIssues: [{ type: "env", name: "API_KEY" }, { type: "tool", name: "docker" }],
      badgeIssues: [{ line: 5, status: "broken", url: "https://example.com/badge.svg" }],
      isStale: true,
      summary: { errors: 2, warnings: 3 },
    });
    await runDocsCommand("https://github.com/test/repo", {});
    expect(mockAnalyze).toHaveBeenCalled();
  });

  it("handles local path", async () => {
    await runDocsCommand("./local-repo", {});
    expect(mockAnalyze).toHaveBeenCalled();
  });
});
