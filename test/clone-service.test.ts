import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCloneRepo = vi.fn().mockResolvedValue("/tmp/cloned");
const mockScanRepo = vi.fn().mockResolvedValue({ files: [], keySourceFiles: new Set() });
vi.mock("../src/ingest.js", () => ({
  cloneRepo: (...args: any[]) => mockCloneRepo(...args),
  scanRepo: (...args: any[]) => mockScanRepo(...args),
}));

vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return { ...actual, rm: vi.fn().mockResolvedValue(undefined) };
});

import { cloneRepository, scanRepositoryFiles, cleanupRepository } from "../src/services/clone-service.js";

describe("clone-service", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("cloneRepository", () => {
    const validInfo = { owner: "test", repo: "repo", url: "https://github.com/test/repo", fullName: "test/repo", branch: "main" };

    it("clones with valid info", async () => {
      const result = await cloneRepository(validInfo as any);
      expect(result).toBe("/tmp/cloned");
      expect(mockCloneRepo).toHaveBeenCalled();
    });

    it("passes branch and fullClone", async () => {
      await cloneRepository(validInfo as any, "dev", true);
      expect(mockCloneRepo).toHaveBeenCalledWith(validInfo, expect.anything(), "dev", true);
    });

    it("rejects missing URL", async () => {
      await expect(cloneRepository({ owner: "a", repo: "b", url: "" } as any)).rejects.toThrow("URL is required");
    });

    it("rejects URL starting with dash", async () => {
      await expect(cloneRepository({ owner: "a", repo: "b", url: "-evil" } as any)).rejects.toThrow("unsafe");
    });

    it("rejects URL with newlines", async () => {
      await expect(cloneRepository({ owner: "a", repo: "b", url: "https://foo\nbar" } as any)).rejects.toThrow("unsafe");
    });

    it("rejects unsupported protocol", async () => {
      await expect(cloneRepository({ owner: "a", repo: "b", url: "ftp://foo" } as any)).rejects.toThrow("Unsupported");
    });

    it("rejects missing owner", async () => {
      await expect(cloneRepository({ owner: "", repo: "b", url: "https://github.com/a/b" } as any)).rejects.toThrow("owner and name");
    });

    it("rejects branch with ..", async () => {
      await expect(cloneRepository(validInfo as any, "a..b")).rejects.toThrow("unsafe");
    });

    it("rejects branch starting with dash", async () => {
      await expect(cloneRepository(validInfo as any, "-branch")).rejects.toThrow("unsafe");
    });

    it("rejects branch with backslash", async () => {
      await expect(cloneRepository(validInfo as any, "a\\b")).rejects.toThrow("unsafe");
    });

    it("rejects branch with @{", async () => {
      await expect(cloneRepository(validInfo as any, "a@{b}")).rejects.toThrow("unsafe");
    });

    it("rejects branch with special chars", async () => {
      await expect(cloneRepository(validInfo as any, "a b")).rejects.toThrow("unsafe");
    });
  });

  describe("scanRepositoryFiles", () => {
    it("delegates to scanRepo", async () => {
      const result = await scanRepositoryFiles("/some/path", 100);
      expect(mockScanRepo).toHaveBeenCalledWith("/some/path", 100);
    });
  });

  describe("cleanupRepository", () => {
    it("removes the repo directory", async () => {
      await cleanupRepository("/tmp/repo");
      const { rm } = await import("fs/promises");
      expect(rm).toHaveBeenCalledWith("/tmp/repo", { recursive: true, force: true });
    });
  });
});
