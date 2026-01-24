/**
 * Tests for URL parsing and repo ingestion
 */

import { describe, it, expect } from "vitest";
import { parseGitHubUrl } from "../src/ingest.js";

describe("parseGitHubUrl", () => {
  it("parses standard GitHub URL", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.fullName).toBe("owner/repo");
    expect(result.url).toBe("https://github.com/owner/repo");
  });

  it("parses URL with .git suffix", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo.git");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.fullName).toBe("owner/repo");
  });

  it("parses URL with trailing slash", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("parses SSH-style URL", () => {
    const result = parseGitHubUrl("git@github.com:owner/repo.git");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("throws on invalid URL", () => {
    expect(() => parseGitHubUrl("not-a-url")).toThrow("Invalid GitHub URL");
    expect(() => parseGitHubUrl("https://gitlab.com/owner/repo")).toThrow("Invalid GitHub URL");
  });

  it("handles complex repo names", () => {
    const result = parseGitHubUrl("https://github.com/owner/my-awesome-repo");
    expect(result.repo).toBe("my-awesome-repo");
  });
});
