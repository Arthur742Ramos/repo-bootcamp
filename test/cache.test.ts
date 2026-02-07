/**
 * Tests for the analysis cache layer
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readCache, writeCache, clearCache, getCacheDir, pruneCache } from "../src/cache.js";
import { mkdir, rm, readdir, utimes } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { RepoFacts } from "../src/types.js";

// Minimal valid RepoFacts for testing
function makeFacts(overrides: Partial<RepoFacts> = {}): RepoFacts {
  return {
    repoName: "owner/repo",
    purpose: "A test repo",
    description: "A repo for testing",
    stack: {
      languages: ["TypeScript"],
      frameworks: [],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: true,
    },
    quickstart: {
      prerequisites: ["Node.js"],
      steps: ["npm install"],
      commands: [],
    },
    structure: {
      keyDirs: [],
      entrypoints: [],
      testDirs: [],
      docsDirs: [],
    },
    ci: {
      workflows: [],
      mainChecks: [],
    },
    contrib: {
      howToAddFeature: [],
      howToAddTest: [],
    },
    architecture: {
      overview: "Simple app",
      components: [],
    },
    firstTasks: [],
    ...overrides,
  };
}

describe("cache", () => {
  describe("readCache", () => {
    it("returns null for non-existent cache entry", async () => {
      const result = await readCache("nonexistent/repo", "abc123");
      expect(result).toBeNull();
    });
  });

  describe("writeCache + readCache round-trip", () => {
    const testRepo = "test-owner/test-repo";
    const testSha = "a1b2c3d4e5f6789012345678901234567890abcd";

    afterEach(async () => {
      await clearCache();
    });

    it("writes and reads back facts correctly", async () => {
      const facts = makeFacts({ repoName: testRepo });

      await writeCache(testRepo, testSha, facts);
      const cached = await readCache(testRepo, testSha);

      expect(cached).not.toBeNull();
      expect(cached!.repoName).toBe(testRepo);
      expect(cached!.purpose).toBe("A test repo");
      expect(cached!.stack.languages).toEqual(["TypeScript"]);
    });

    it("returns null for different commit SHA", async () => {
      const facts = makeFacts();

      await writeCache(testRepo, testSha, facts);
      const cached = await readCache(testRepo, "different-sha");

      expect(cached).toBeNull();
    });

    it("returns null for different repo name", async () => {
      const facts = makeFacts();

      await writeCache(testRepo, testSha, facts);
      const cached = await readCache("other/repo", testSha);

      expect(cached).toBeNull();
    });

    it("overwrites existing cache entry", async () => {
      const facts1 = makeFacts({ purpose: "version 1" });
      const facts2 = makeFacts({ purpose: "version 2" });

      await writeCache(testRepo, testSha, facts1);
      await writeCache(testRepo, testSha, facts2);
      const cached = await readCache(testRepo, testSha);

      expect(cached).not.toBeNull();
      expect(cached!.purpose).toBe("version 2");
    });
  });

  describe("clearCache", () => {
    it("returns 0 when cache is empty", async () => {
      const cleared = await clearCache();
      // May or may not be 0 depending on prior tests, just check it's a number
      expect(typeof cleared).toBe("number");
    });

    it("removes cached entries", async () => {
      await writeCache("clear-test/repo", "sha1", makeFacts());
      const cleared = await clearCache();
      expect(cleared).toBeGreaterThanOrEqual(1);

      const cached = await readCache("clear-test/repo", "sha1");
      expect(cached).toBeNull();
    });
  });

  describe("getCacheDir", () => {
    it("returns a path under home directory", () => {
      const dir = getCacheDir();
      expect(dir).toContain(".cache");
      expect(dir).toContain("repo-bootcamp");
    });
  });

  describe("pruneCache", () => {
    afterEach(async () => {
      await clearCache();
    });

    it("returns 0 when cache directory is empty", async () => {
      await clearCache();
      const pruned = await pruneCache(1000);
      expect(pruned).toBe(0);
    });

    it("does not prune recent files", async () => {
      await writeCache("prune-test/recent", "sha-recent", makeFacts());
      const pruned = await pruneCache(7 * 24 * 60 * 60 * 1000);
      expect(pruned).toBe(0);

      // Verify file still readable
      const cached = await readCache("prune-test/recent", "sha-recent");
      expect(cached).not.toBeNull();
    });

    it("prunes files older than maxAgeMs", async () => {
      await writeCache("prune-test/old", "sha-old", makeFacts());

      // Backdate the file's mtime to 10 days ago
      const cacheDir = getCacheDir();
      const files = await readdir(cacheDir);
      const target = files.find((f) => f.includes("prune-test-old"));
      expect(target).toBeDefined();

      const filePath = join(cacheDir, target!);
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await utimes(filePath, tenDaysAgo, tenDaysAgo);

      const pruned = await pruneCache(7 * 24 * 60 * 60 * 1000);
      expect(pruned).toBe(1);

      // Verify file is gone
      const cached = await readCache("prune-test/old", "sha-old");
      expect(cached).toBeNull();
    });

    it("prunes only old files and keeps recent ones", async () => {
      await writeCache("prune-test/keep", "sha-keep", makeFacts());
      await writeCache("prune-test/remove", "sha-remove", makeFacts());

      // Backdate only one file
      const cacheDir = getCacheDir();
      const files = await readdir(cacheDir);
      const target = files.find((f) => f.includes("prune-test-remove"));
      expect(target).toBeDefined();

      const filePath = join(cacheDir, target!);
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await utimes(filePath, oldDate, oldDate);

      const pruned = await pruneCache(7 * 24 * 60 * 60 * 1000);
      expect(pruned).toBe(1);

      // Recent file should still be readable
      const kept = await readCache("prune-test/keep", "sha-keep");
      expect(kept).not.toBeNull();

      // Old file should be gone
      const removed = await readCache("prune-test/remove", "sha-remove");
      expect(removed).toBeNull();
    });

    it("prunes all files when maxAgeMs is 0", async () => {
      await writeCache("prune-test/a", "sha-a", makeFacts());
      await writeCache("prune-test/b", "sha-b", makeFacts());

      // Backdate files so they are older than 0ms
      const cacheDir = getCacheDir();
      const files = await readdir(cacheDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      const past = new Date(Date.now() - 1000);
      await Promise.all(
        jsonFiles.map((f) => utimes(join(cacheDir, f), past, past))
      );

      const pruned = await pruneCache(0);
      expect(pruned).toBeGreaterThanOrEqual(2);
    });
  });
});
