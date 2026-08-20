import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClone = vi.fn().mockResolvedValue("/tmp/fake-repo");
const mockCleanup = vi.fn().mockResolvedValue(undefined);
const mockScan = vi.fn().mockResolvedValue({ files: [], keySourceFiles: new Set(), stack: {} });
const mockResolveRepo = vi.fn().mockResolvedValue({
  path: "/tmp/local-repo",
  isLocal: true,
  repoName: "local-repo",
  repoInfo: {
    owner: "local",
    repo: "local-repo",
    fullName: "local/local-repo",
    url: "file:///tmp/local-repo",
    branch: "local",
  },
  cleanup: vi.fn().mockResolvedValue(undefined),
});
const mockIsLocalPath = vi.fn((input: string) => input.startsWith("/"));

vi.mock("../src/services/clone-service.js", () => ({
  cloneRepository: (...args: any[]) => mockClone(...args),
  cleanupRepository: (...args: any[]) => mockCleanup(...args),
  scanRepositoryFiles: (...args: any[]) => mockScan(...args),
}));

vi.mock("../src/ingest.js", () => ({
  parseGitHubUrl: vi.fn((url: string) => {
    if (url === "bad-url") throw new Error("Invalid URL");
    return {
      owner: "test",
      repo: "repo",
      fullName: "test/repo",
      url: "https://github.com/test/repo",
      branch: "main",
    };
  }),
}));

vi.mock("../src/repo-resolver.js", () => ({
  isLocalPath: (input: string) => mockIsLocalPath(input),
  resolveRepo: (...args: any[]) => mockResolveRepo(...args),
}));

const mockInteractive = vi.fn().mockResolvedValue(undefined);
const mockQuickAsk = vi.fn().mockResolvedValue("mock answer");
vi.mock("../src/interactive.js", () => ({
  runInteractiveMode: (...args: any[]) => mockInteractive(...args),
  quickAsk: (...args: any[]) => mockQuickAsk(...args),
}));

import { runAskCommand } from "../src/commands/ask-command.js";

describe("runAskCommand", () => {
  const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as any);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clones, scans, runs interactive mode, and cleans up", async () => {
    await runAskCommand("https://github.com/test/repo", {});
    expect(mockClone).toHaveBeenCalled();
    expect(mockScan).toHaveBeenCalled();
    expect(mockInteractive).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("passes branch and model options", async () => {
    await runAskCommand("https://github.com/test/repo", { branch: "dev", model: "gpt-4" });
    expect(mockClone).toHaveBeenCalledWith(expect.anything(), "dev", false);
  });

  it("uses a local repository when given a filesystem path", async () => {
    await runAskCommand("/tmp/local-repo", {});

    expect(mockResolveRepo).toHaveBeenCalledWith("/tmp/local-repo", process.cwd(), undefined);
    expect(mockClone).not.toHaveBeenCalled();
    expect(mockCleanup).not.toHaveBeenCalled();
    expect(mockInteractive).toHaveBeenCalledWith(
      "/tmp/local-repo",
      expect.objectContaining({ fullName: "local/local-repo" }),
      expect.anything(),
      process.cwd(),
      undefined,
      expect.objectContaining({ saveTranscript: true })
    );
  });

  it("exits on invalid URL", async () => {
    await expect(runAskCommand("bad-url", {})).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("exits on clone failure", async () => {
    mockClone.mockRejectedValueOnce(new Error("clone failed"));
    await expect(runAskCommand("https://github.com/test/repo", {})).rejects.toThrow("process.exit");
  });

  it("exits on scan failure", async () => {
    mockScan.mockRejectedValueOnce(new Error("scan failed"));
    await expect(runAskCommand("https://github.com/test/repo", {})).rejects.toThrow("process.exit");
  });

  it("ignores cleanup errors", async () => {
    mockCleanup.mockRejectedValueOnce(new Error("cleanup fail"));
    await runAskCommand("https://github.com/test/repo", {});
  });

  describe("one-shot mode (question supplied)", () => {
    it("answers a single question via quickAsk and skips the REPL", async () => {
      await runAskCommand("/tmp/local-repo", {
        question: "Where is main?",
        verbose: true,
        model: "gpt-4",
      });

      expect(mockQuickAsk).toHaveBeenCalledTimes(1);
      const [repoPath, repoInfo, , question, verbose, model] = mockQuickAsk.mock.calls[0];
      expect(repoPath).toBe("/tmp/local-repo");
      expect(repoInfo).toEqual(expect.objectContaining({ fullName: "local/local-repo" }));
      expect(question).toBe("Where is main?");
      expect(verbose).toBe(true);
      expect(model).toBe("gpt-4");
      // One-shot never enters the interactive REPL and never writes a transcript.
      expect(mockInteractive).not.toHaveBeenCalled();
    });

    it("clones, answers once, and cleans up for a remote repo", async () => {
      await runAskCommand("https://github.com/test/repo", { question: "How do tests run?" });

      expect(mockClone).toHaveBeenCalled();
      expect(mockScan).toHaveBeenCalled();
      expect(mockQuickAsk).toHaveBeenCalledTimes(1);
      expect(mockInteractive).not.toHaveBeenCalled();
      expect(mockCleanup).toHaveBeenCalled();
    });

    it("trims the question and falls back to the REPL when it is blank", async () => {
      await runAskCommand("/tmp/local-repo", { question: "   " });

      expect(mockQuickAsk).not.toHaveBeenCalled();
      expect(mockInteractive).toHaveBeenCalled();
    });

    it("passes the trimmed question to quickAsk", async () => {
      await runAskCommand("/tmp/local-repo", { question: "  spaced out  " });

      expect(mockQuickAsk).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        "spaced out",
        undefined,
        undefined
      );
    });

    it("exits 1 when quickAsk fails", async () => {
      mockQuickAsk.mockRejectedValueOnce(new Error("session boom"));
      await expect(
        runAskCommand("https://github.com/test/repo", { question: "boom?" })
      ).rejects.toThrow("process.exit");
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
