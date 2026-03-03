import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClone = vi.fn().mockResolvedValue("/tmp/fake-repo");
const mockCleanup = vi.fn().mockResolvedValue(undefined);
const mockScan = vi.fn().mockResolvedValue({ files: [], keySourceFiles: new Set(), stack: {} });

vi.mock("../src/services/clone-service.js", () => ({
  cloneRepository: (...args: any[]) => mockClone(...args),
  cleanupRepository: (...args: any[]) => mockCleanup(...args),
  scanRepositoryFiles: (...args: any[]) => mockScan(...args),
}));

vi.mock("../src/ingest.js", () => ({
  parseGitHubUrl: vi.fn((url: string) => {
    if (url === "bad-url") throw new Error("Invalid URL");
    return { owner: "test", repo: "repo", fullName: "test/repo", url: "https://github.com/test/repo", branch: "main" };
  }),
}));

const mockInteractive = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/interactive.js", () => ({
  runInteractiveMode: (...args: any[]) => mockInteractive(...args),
}));

import { runAskCommand } from "../src/commands/ask-command.js";

describe("runAskCommand", () => {
  const mockExit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("process.exit"); }) as any);

  beforeEach(() => { vi.clearAllMocks(); });

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
});
