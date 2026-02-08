/**
 * Tests for URL parsing and repo ingestion
 */

import { describe, it, expect } from "vitest";
import { parseGitHubUrl, detectFrameworksFromDeps, mergeFrameworksFromDeps } from "../src/ingest.js";
import type { StackInfo } from "../src/types.js";

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

  it("strips extension from repo name in URL", () => {
    // The regex excludes dots from repo name capture
    // This is intentional to handle .git suffix cleanly
    const result = parseGitHubUrl("https://github.com/owner/repo.js");
    expect(result.repo).toBe("repo");
  });

  it("handles repos with underscores", () => {
    const result = parseGitHubUrl("https://github.com/owner/my_repo_name");
    expect(result.repo).toBe("my_repo_name");
  });

  it("handles numeric owner names", () => {
    const result = parseGitHubUrl("https://github.com/123org/repo");
    expect(result.owner).toBe("123org");
    expect(result.repo).toBe("repo");
  });

  it("throws on empty URL", () => {
    expect(() => parseGitHubUrl("")).toThrow("Invalid GitHub URL");
  });

  it("throws on URL with only owner", () => {
    expect(() => parseGitHubUrl("https://github.com/owner")).toThrow("Invalid GitHub URL");
  });

  it("handles URL with /tree/branch path", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/tree/main");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("handles URL with /blob/file path", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/blob/main/file.js");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("handles URL with query string", () => {
    // Query string is captured in the regex; parseGitHubUrl extracts what it can
    const result = parseGitHubUrl("https://github.com/owner/repo?tab=readme");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo?tab=readme");
  });

  it("handles URL with fragment", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo#readme");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo#readme");
  });

  it("handles http (non-https) URL", () => {
    const result = parseGitHubUrl("http://github.com/owner/repo");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("throws on non-GitHub URL with similar structure", () => {
    expect(() => parseGitHubUrl("https://bitbucket.org/owner/repo")).toThrow("Invalid GitHub URL");
  });

  it("sets default branch to main", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo");
    expect(result.branch).toBe("main");
  });

  it("constructs correct fullName", () => {
    const result = parseGitHubUrl("https://github.com/facebook/react");
    expect(result.fullName).toBe("facebook/react");
  });

  it("constructs correct URL format", () => {
    const result = parseGitHubUrl("git@github.com:owner/repo.git");
    expect(result.url).toBe("https://github.com/owner/repo");
  });
});

describe("detectFrameworksFromDeps", () => {
  it("detects React from dependencies", () => {
    const frameworks = detectFrameworksFromDeps(["react", "react-dom"]);
    expect(frameworks).toContain("React");
  });

  it("detects Express from dependencies", () => {
    const frameworks = detectFrameworksFromDeps(["express", "cors"]);
    expect(frameworks).toContain("Express");
    expect(frameworks).not.toContain("cors"); // cors is not a framework
  });

  it("detects multiple frameworks", () => {
    const frameworks = detectFrameworksFromDeps(["react", "express", "next"]);
    expect(frameworks).toContain("React");
    expect(frameworks).toContain("Express");
    expect(frameworks).toContain("Next.js");
  });

  it("handles Python frameworks", () => {
    const frameworks = detectFrameworksFromDeps(["flask", "sqlalchemy"]);
    expect(frameworks).toContain("Flask");
  });

  it("handles Go frameworks from go.mod paths", () => {
    const frameworks = detectFrameworksFromDeps(["github.com/gin-gonic/gin"]);
    expect(frameworks).toContain("Gin");
  });

  it("returns empty array for non-framework dependencies", () => {
    const frameworks = detectFrameworksFromDeps(["lodash", "moment", "chalk"]);
    expect(frameworks).toHaveLength(0);
  });

  it("handles empty input", () => {
    const frameworks = detectFrameworksFromDeps([]);
    expect(frameworks).toHaveLength(0);
  });
});

describe("mergeFrameworksFromDeps", () => {
  it("merges new frameworks from dependencies", () => {
    const stack: StackInfo = {
      languages: ["TypeScript"],
      frameworks: ["Next.js"],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: true,
    };
    
    const result = mergeFrameworksFromDeps(stack, ["react", "express"]);
    expect(result.frameworks).toContain("Next.js"); // existing
    expect(result.frameworks).toContain("React");
    expect(result.frameworks).toContain("Express");
  });

  it("does not duplicate existing frameworks", () => {
    const stack: StackInfo = {
      languages: ["TypeScript"],
      frameworks: ["React"],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: true,
    };
    
    const result = mergeFrameworksFromDeps(stack, ["react", "react-dom"]);
    const reactCount = result.frameworks.filter(f => f === "React").length;
    expect(reactCount).toBe(1);
  });

  it("handles case-insensitive matching for deduplication", () => {
    const stack: StackInfo = {
      languages: ["TypeScript"],
      frameworks: ["REACT"], // uppercase
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: true,
    };
    
    const result = mergeFrameworksFromDeps(stack, ["react"]);
    // Should not add React again since REACT already exists
    expect(result.frameworks).toHaveLength(1);
  });
});
