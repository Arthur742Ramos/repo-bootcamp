import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("chalk", () => {
  const makeChalk = (): any =>
    new Proxy((...args: any[]) => args.join(""), {
      get: () => makeChalk(),
      apply: (_t: any, _a: any, args: any[]) => args.join(""),
    });
  return { default: makeChalk() };
});

const mockClone = vi.fn().mockResolvedValue("/tmp/fake-repo");
const mockCleanup = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/services/clone-service.js", () => ({
  cloneRepository: (...args: any[]) => mockClone(...args),
  cleanupRepository: (...args: any[]) => mockCleanup(...args),
}));

vi.mock("../src/ingest.js", () => ({
  parseGitHubUrl: vi.fn((url: string) => {
    if (url.includes("bad")) throw new Error("Invalid repo");
    return { owner: "test", repo: "repo", fullName: "test/repo", url, branch: "main" };
  }),
}));

vi.mock("../src/diff.js", () => ({
  parsePullRequestTarget: vi.fn((target: string) => {
    if (target === "invalid") throw new Error("Invalid PR reference");
    return { repoUrl: "https://github.com/test/repo", prNumber: 42 };
  }),
  fetchPullRequestRefs: vi.fn().mockResolvedValue({
    baseRef: "abc",
    headRef: "def",
    baseName: "main",
    headName: "feature",
    title: "Test PR",
    url: "https://github.com/test/repo/pull/42",
  }),
  analyzeDiff: vi.fn().mockResolvedValue({ files: [], additions: 10, deletions: 5 }),
  generateDiffDocs: vi.fn().mockReturnValue("# DIFF\nChanges"),
}));

vi.mock("../src/formatter.js", () => ({
  formatDocName: vi.fn((name: string) => name),
  applyOutputFormat: vi.fn((docs: any[]) => docs),
}));

vi.mock("../src/progress.js", () => {
  class MockProgressTracker {
    startPhase = vi.fn();
    succeed = vi.fn();
    fail = vi.fn();
    warn = vi.fn();
    update = vi.fn();
    stop = vi.fn();
  }
  return { ProgressTracker: MockProgressTracker };
});

vi.mock("../src/services/config-resolution.js", () => ({
  resolveOutputFormat: vi.fn((f: string) => {
    if (f === "bad-format") throw new Error("Unknown format");
    return f;
  }),
}));

vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

import { runPullRequestDiff } from "../src/commands/diff-command.js";

describe("runPullRequestDiff", () => {
  const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as any);
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs successfully end-to-end", async () => {
    await runPullRequestDiff("test/repo#42", {});
    expect(mockClone).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("exits on invalid PR target", async () => {
    await expect(runPullRequestDiff("invalid", {})).rejects.toThrow("process.exit");
  });

  it("exits on invalid format", async () => {
    await expect(runPullRequestDiff("test/repo#42", { format: "bad-format" })).rejects.toThrow(
      "process.exit"
    );
  });

  it("keeps temp when keepTemp is true", async () => {
    await runPullRequestDiff("test/repo#42", { keepTemp: true });
    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it("uses custom output dir", async () => {
    await runPullRequestDiff("test/repo#42", { output: "/tmp/custom-out" });
    expect(mockClone).toHaveBeenCalled();
  });
});

describe("runPullRequestDiff error branches", () => {
  const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as any);
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exits on invalid repo URL", async () => {
    const { parsePullRequestTarget } = await import("../src/diff.js");
    (parsePullRequestTarget as any).mockReturnValueOnce({ repoUrl: "bad-repo", prNumber: 1 });
    const { parseGitHubUrl } = await import("../src/ingest.js");
    (parseGitHubUrl as any).mockImplementationOnce(() => {
      throw new Error("Invalid repo");
    });
    await expect(runPullRequestDiff("test/repo#1", {})).rejects.toThrow("process.exit");
  });

  it("exits on clone failure", async () => {
    mockClone.mockRejectedValueOnce(new Error("clone boom"));
    await expect(runPullRequestDiff("test/repo#42", {})).rejects.toThrow("process.exit");
  });

  it("exits on diff failure", async () => {
    const { fetchPullRequestRefs } = await import("../src/diff.js");
    (fetchPullRequestRefs as any).mockRejectedValueOnce(new Error("diff boom"));
    await expect(runPullRequestDiff("test/repo#42", {})).rejects.toThrow("process.exit");
  });

  it("exits on mkdir failure", async () => {
    const { mkdir } = await import("fs/promises");
    (mkdir as any).mockRejectedValueOnce(new Error("mkdir fail"));
    await expect(runPullRequestDiff("test/repo#42", {})).rejects.toThrow("process.exit");
  });

  it("exits on writeFile failure", async () => {
    const { writeFile } = await import("fs/promises");
    (writeFile as any).mockRejectedValueOnce(new Error("write fail"));
    await expect(runPullRequestDiff("test/repo#42", {})).rejects.toThrow("process.exit");
  });

  it("warns on cleanup failure", async () => {
    mockCleanup.mockRejectedValueOnce(new Error("cleanup fail"));
    await runPullRequestDiff("test/repo#42", {});
    // Should not throw - cleanup failure is just a warning
  });

  it("passes verbose and fullClone options", async () => {
    await runPullRequestDiff("test/repo#42", { verbose: true, fullClone: true });
    expect(mockClone).toHaveBeenCalledWith(expect.anything(), undefined, true);
  });
});
