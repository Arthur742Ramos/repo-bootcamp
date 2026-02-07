import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { homedir } from "os";
import { mkdir, rm, writeFile } from "fs/promises";
import {
  isLocalPath,
  resolveLocalPath,
  getRepoNameFromPath,
  isGitRepo,
  resolveRepo,
} from "../src/repo-resolver.js";

describe("isLocalPath", () => {
  it("should return true for current directory '.'", () => {
    expect(isLocalPath(".")).toBe(true);
  });

  it("should return true for parent directory '..'", () => {
    expect(isLocalPath("..")).toBe(true);
  });

  it("should return true for absolute paths starting with /", () => {
    expect(isLocalPath("/Users/test/project")).toBe(true);
    expect(isLocalPath("/tmp/repo")).toBe(true);
  });

  it("should return true for relative paths starting with ./", () => {
    expect(isLocalPath("./my-project")).toBe(true);
    expect(isLocalPath("./")).toBe(true);
  });

  it("should return true for relative paths starting with ../", () => {
    expect(isLocalPath("../other-repo")).toBe(true);
    expect(isLocalPath("../../deep/path")).toBe(true);
  });

  it("should return true for home-relative paths starting with ~", () => {
    expect(isLocalPath("~")).toBe(true);
    expect(isLocalPath("~/projects/myapp")).toBe(true);
    expect(isLocalPath("~/")).toBe(true);
  });

  it("should return true for Windows-style paths", () => {
    expect(isLocalPath("C:\\Users\\test")).toBe(true);
    expect(isLocalPath("D:/projects/repo")).toBe(true);
  });

  it("should return false for GitHub HTTPS URLs", () => {
    expect(isLocalPath("https://github.com/owner/repo")).toBe(false);
    expect(isLocalPath("https://github.com/facebook/react")).toBe(false);
  });

  it("should return false for GitHub SSH URLs", () => {
    expect(isLocalPath("git@github.com:owner/repo.git")).toBe(false);
  });

  it("should return false for empty or invalid input", () => {
    expect(isLocalPath("")).toBe(false);
    expect(isLocalPath(null as any)).toBe(false);
    expect(isLocalPath(undefined as any)).toBe(false);
  });

  it("should return false for plain names that look like repos", () => {
    expect(isLocalPath("my-repo")).toBe(false);
    expect(isLocalPath("some-project")).toBe(false);
  });

  it("should handle whitespace-padded input", () => {
    expect(isLocalPath("  .  ")).toBe(true);
    expect(isLocalPath("  /tmp/repo  ")).toBe(true);
  });
});

describe("resolveLocalPath", () => {
  it("should expand ~ to home directory", () => {
    expect(resolveLocalPath("~")).toBe(homedir());
  });

  it("should expand ~/path to home directory + path", () => {
    const result = resolveLocalPath("~/projects/test");
    expect(result).toBe(resolve(homedir(), "projects/test"));
  });

  it("should resolve relative paths from cwd", () => {
    const result = resolveLocalPath("./test");
    expect(result).toBe(resolve(process.cwd(), "test"));
  });

  it("should resolve parent paths from cwd", () => {
    const result = resolveLocalPath("../other");
    expect(result).toBe(resolve(process.cwd(), "../other"));
  });

  it("should resolve . to cwd", () => {
    const result = resolveLocalPath(".");
    expect(result).toBe(resolve(process.cwd(), "."));
  });

  it("should keep absolute paths as-is", () => {
    const result = resolveLocalPath("/tmp/test-repo");
    expect(result).toBe("/tmp/test-repo");
  });
});

describe("getRepoNameFromPath", () => {
  it("should extract directory name from absolute path", () => {
    expect(getRepoNameFromPath("/Users/test/my-project")).toBe("my-project");
  });

  it("should extract directory name from relative path", () => {
    expect(getRepoNameFromPath("./some-repo")).toBe("some-repo");
  });

  it("should return 'local-repo' for root path", () => {
    expect(getRepoNameFromPath("/")).toBe("local-repo");
  });
});

describe("isGitRepo", () => {
  const testDir = "/tmp/test-git-repo-check";

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should return true for directories with .git folder", async () => {
    await mkdir(`${testDir}/.git`, { recursive: true });
    expect(await isGitRepo(testDir)).toBe(true);
  });

  it("should return false for directories without .git folder", async () => {
    expect(await isGitRepo(testDir)).toBe(false);
  });
});

describe("resolveRepo", () => {
  const testLocalRepo = "/tmp/test-local-repo-resolve";

  beforeEach(async () => {
    await rm(testLocalRepo, { recursive: true, force: true });
    await mkdir(testLocalRepo, { recursive: true });
    // Create a minimal structure
    await writeFile(`${testLocalRepo}/package.json`, '{"name":"test"}');
  });

  afterEach(async () => {
    await rm(testLocalRepo, { recursive: true, force: true });
  });

  it("should resolve local path and return correct RepoSource", async () => {
    const result = await resolveRepo(testLocalRepo);

    expect(result.isLocal).toBe(true);
    expect(result.path).toBe(testLocalRepo);
    expect(result.repoName).toBe("test-local-repo-resolve");
    expect(result.repoInfo.owner).toBe("local");
    expect(result.repoInfo.repo).toBe("test-local-repo-resolve");
  });

  it("should not delete local repo on cleanup", async () => {
    const result = await resolveRepo(testLocalRepo);
    await result.cleanup();

    // The directory should still exist
    const { stat } = await import("fs/promises");
    const stats = await stat(testLocalRepo);
    expect(stats.isDirectory()).toBe(true);
  });

  it("should throw error for non-existent local path", async () => {
    await expect(resolveRepo("/tmp/non-existent-path-12345")).rejects.toThrow(
      /does not exist/
    );
  });

  it("should throw error if path is a file, not directory", async () => {
    const filePath = `${testLocalRepo}/some-file.txt`;
    await writeFile(filePath, "content");

    await expect(resolveRepo(filePath)).rejects.toThrow(/not a directory/);
  });

  // Note: Testing GitHub URL requires network access and would clone a real repo
  // We skip that for unit tests but it's tested in integration tests
});
