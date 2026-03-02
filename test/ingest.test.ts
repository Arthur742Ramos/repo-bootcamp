/**
 * Tests for URL parsing and repo ingestion
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { parseGitHubUrl, detectFrameworksFromDeps, mergeFrameworksFromDeps, scanRepo } from "../src/ingest.js";
import type { StackInfo } from "../src/types.js";

describe("parseGitHubUrl", () => {
  it("parses standard GitHub URL", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.fullName).toBe("owner/repo");
    expect(result.url).toBe("https://github.com/owner/repo");
    expect(result.provider).toBe("github");
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
    expect(result.url).toBe("https://github.com/owner/repo");
  });

  it("parses GitLab URL", () => {
    const result = parseGitHubUrl("https://gitlab.com/owner/repo");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.url).toBe("https://gitlab.com/owner/repo");
    expect(result.provider).toBe("gitlab");
  });

  it("parses GitLab URL with nested groups", () => {
    const result = parseGitHubUrl("https://gitlab.com/group/subgroup/repo");
    expect(result.owner).toBe("group/subgroup");
    expect(result.repo).toBe("repo");
    expect(result.fullName).toBe("group/subgroup/repo");
  });

  it("parses Bitbucket URL", () => {
    const result = parseGitHubUrl("https://bitbucket.org/owner/repo");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.url).toBe("https://bitbucket.org/owner/repo");
    expect(result.provider).toBe("bitbucket");
  });

  it("parses SSH-style GitLab URL", () => {
    const result = parseGitHubUrl("git@gitlab.com:group/project.git");
    expect(result.owner).toBe("group");
    expect(result.repo).toBe("project");
    expect(result.url).toBe("https://gitlab.com/group/project");
  });

  it("parses SSH GitLab URL", () => {
    const result = parseGitHubUrl("git@gitlab.com:group/subgroup/repo.git");
    expect(result.owner).toBe("group/subgroup");
    expect(result.repo).toBe("repo");
    expect(result.provider).toBe("gitlab");
  });

  it("throws on invalid or unsupported URL", () => {
    expect(() => parseGitHubUrl("not-a-url")).toThrow("Invalid GitHub URL");
    expect(() => parseGitHubUrl("https://example.com/owner/repo")).toThrow("Invalid GitHub URL");
  });

  it("handles complex repo names", () => {
    const result = parseGitHubUrl("https://github.com/owner/my-awesome-repo");
    expect(result.repo).toBe("my-awesome-repo");
  });

  it("preserves dots in repo names like next.js", () => {
    // Repo names can contain dots (e.g., next.js, socket.io)
    // Only .git suffix should be stripped
    const result = parseGitHubUrl("https://github.com/owner/repo.js");
    expect(result.repo).toBe("repo.js");
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

  it("rejects URL values containing control characters", () => {
    expect(() => parseGitHubUrl("https://github.com/owner/repo\nbad")).toThrow("Invalid GitHub URL");
  });

  it("rejects traversal-style URL segments", () => {
    expect(() => parseGitHubUrl("https://github.com/%2E%2E/repo")).toThrow("Invalid GitHub URL");
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
    const result = parseGitHubUrl("https://github.com/owner/repo?tab=readme");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("handles URL with fragment", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo#readme");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("handles http (non-https) URL", () => {
    const result = parseGitHubUrl("http://github.com/owner/repo");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("throws on non-supported host URL with similar structure", () => {
    expect(() => parseGitHubUrl("https://sourcehut.org/owner/repo")).toThrow("Invalid GitHub URL");
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

describe("scanRepo", () => {
  it("skips ignored directories while scanning", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "bootcamp-ingest-"));
    try {
      await mkdir(join(repoPath, "src"), { recursive: true });
      await mkdir(join(repoPath, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(repoPath, "src", "index.ts"), "export const x = 1;\n", "utf-8");
      await writeFile(join(repoPath, "node_modules", "pkg", "index.js"), "module.exports = 1;\n", "utf-8");

      const scan = await scanRepo(repoPath, 200);
      expect(scan.files.some((f) => f.path.startsWith("node_modules/"))).toBe(false);
      expect(scan.files.some((f) => f.path === "src/index.ts")).toBe(true);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it("respects maxFiles when scanning", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "bootcamp-ingest-limit-"));
    try {
      await mkdir(join(repoPath, "src"), { recursive: true });
      for (let i = 0; i < 6; i++) {
        await writeFile(join(repoPath, "src", `file-${i}.ts`), `export const value${i} = ${i};\n`, "utf-8");
      }

      const scan = await scanRepo(repoPath, 2);
      expect(scan.files.length).toBeLessThanOrEqual(2);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it("detects npm workspace monorepos", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "bootcamp-ingest-monorepo-"));
    try {
      await mkdir(join(repoPath, "packages", "core"), { recursive: true });
      await mkdir(join(repoPath, "apps", "web"), { recursive: true });
      await writeFile(
        join(repoPath, "package.json"),
        JSON.stringify({
          name: "root",
          private: true,
          workspaces: ["packages/*", "apps/*"],
        }),
        "utf-8"
      );
      await writeFile(join(repoPath, "packages", "core", "package.json"), JSON.stringify({ name: "@acme/core" }), "utf-8");
      await writeFile(join(repoPath, "apps", "web", "package.json"), JSON.stringify({ name: "@acme/web" }), "utf-8");

      const scan = await scanRepo(repoPath, 500);
      expect(scan.monorepo?.isMonorepo).toBe(true);
      expect(scan.monorepo?.managers).toContain("npm-workspaces");
      expect(scan.monorepo?.workspacePackages.map((pkg) => pkg.name)).toEqual(
        expect.arrayContaining(["@acme/core", "@acme/web"])
      );
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it("detects monorepo manager signals", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "bootcamp-ingest-monorepo-signals-"));
    try {
      await mkdir(join(repoPath, "packages", "shared"), { recursive: true });
      await writeFile(join(repoPath, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n", "utf-8");
      await writeFile(join(repoPath, "lerna.json"), "{ \"version\": \"0.0.0\" }\n", "utf-8");
      await writeFile(join(repoPath, "nx.json"), "{ \"extends\": \"nx/presets/npm.json\" }\n", "utf-8");
      await writeFile(join(repoPath, "turbo.json"), "{ \"pipeline\": {} }\n", "utf-8");
      await writeFile(join(repoPath, "packages", "shared", "package.json"), JSON.stringify({ name: "@acme/shared" }), "utf-8");

      const scan = await scanRepo(repoPath, 500);
      expect(scan.monorepo?.managers).toEqual(expect.arrayContaining(["pnpm", "lerna", "nx", "turborepo"]));
      expect(scan.monorepo?.workspacePackages.some((pkg) => pkg.path === "packages/shared")).toBe(true);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });
});
