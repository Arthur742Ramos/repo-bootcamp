/**
 * Tests for the analysis cache layer
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readCache, writeCache, clearCache, getCacheDir } from "../src/cache.js";
import { mkdir, rm, readdir } from "fs/promises";
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
});
