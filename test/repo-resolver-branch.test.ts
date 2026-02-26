import { beforeEach, describe, expect, it, vi } from "vitest";

const mockParseGitHubUrl = vi.fn();
const mockCloneRepo = vi.fn();

vi.mock("../src/ingest.js", () => ({
  parseGitHubUrl: mockParseGitHubUrl,
  cloneRepo: mockCloneRepo,
}));

import { resolveRepo } from "../src/repo-resolver.js";

describe("resolveRepo branch wiring", () => {
  beforeEach(() => {
    mockParseGitHubUrl.mockReset();
    mockCloneRepo.mockReset();
    mockParseGitHubUrl.mockReturnValue({
      owner: "octo",
      repo: "demo",
      url: "https://github.com/octo/demo",
      branch: "main",
      fullName: "octo/demo",
    });
    mockCloneRepo.mockResolvedValue("/tmp/mock-clone");
  });

  it("passes the requested branch to cloneRepo for GitHub URLs", async () => {
    await resolveRepo("https://github.com/octo/demo", "/tmp/out", "develop");

    expect(mockCloneRepo).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "octo/demo" }),
      "/tmp/out",
      "develop"
    );
  });
});
