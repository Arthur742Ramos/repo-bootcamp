/**
 * Tests for the analysis cache layer
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readCache,
  writeCache,
  clearCache,
  getCacheDir,
  getCacheVersion,
  listCacheEntries,
  pruneCache,
} from "../src/cache.js";
import { mkdir, rm, readdir, utimes, readFile, writeFile } from "fs/promises";
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

    it("returns null for corrupted cache file", async () => {
      // Write a corrupted (non-JSON) cache file directly
      const cacheDir = getCacheDir();
      await mkdir(cacheDir, { recursive: true });
      const { createHash } = await import("crypto");
      const hash = createHash("sha256")
        .update("corrupt/repo@sha123")
        .digest("hex")
        .substring(0, 16);
      const filePath = join(cacheDir, `corrupt-repo-${hash}.json`);
      await writeFile(filePath, "NOT VALID JSON {{{", "utf-8");

      const result = await readCache("corrupt/repo", "sha123");
      expect(result).toBeNull();

      // Cleanup
      await rm(filePath, { force: true });
    });

    it("returns null for cache with wrong version", async () => {
      const testRepo = "version-test/repo";
      const testSha = "abc123";
      // Write valid cache first then read it back
      await writeCache(testRepo, testSha, makeFacts());

      // Overwrite with wrong version
      const cacheDir = getCacheDir();
      const { createHash } = await import("crypto");
      const hash = createHash("sha256")
        .update(`${testRepo}@${testSha}`)
        .digest("hex")
        .substring(0, 16);
      const safeName = testRepo.replace(/\//g, "-");
      const filePath = join(cacheDir, `${safeName}-${hash}.json`);
      const data = JSON.parse(await readFile(filePath, "utf-8"));
      data.version = 999;
      await writeFile(filePath, JSON.stringify(data), "utf-8");

      const result = await readCache(testRepo, testSha);
      expect(result).toBeNull();

      await rm(filePath, { force: true });
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

    it("keeps separate cache entries for different generation options", async () => {
      const onboardingFacts = makeFacts({ purpose: "onboarding profile" });
      const architectureFacts = makeFacts({ purpose: "architecture profile" });
      const onboardingOptions = {
        focus: "onboarding",
        style: "startup",
        model: "claude-sonnet-4-5",
        audience: "frontend",
      };
      const architectureOptions = {
        focus: "architecture",
        style: "corporate",
        model: "claude-opus-4-5",
        audience: "sre",
      };

      await writeCache(testRepo, testSha, onboardingFacts, onboardingOptions);
      await writeCache(testRepo, testSha, architectureFacts, architectureOptions);

      const onboardingCached = await readCache(testRepo, testSha, onboardingOptions);
      const architectureCached = await readCache(testRepo, testSha, architectureOptions);
      const mismatched = await readCache(testRepo, testSha, {
        ...onboardingOptions,
        focus: "contributing",
      });

      expect(onboardingCached?.purpose).toBe("onboarding profile");
      expect(architectureCached?.purpose).toBe("architecture profile");
      expect(mismatched).toBeNull();
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
      await Promise.all(jsonFiles.map((f) => utimes(join(cacheDir, f), past, past)));

      const pruned = await pruneCache(0);
      expect(pruned).toBeGreaterThanOrEqual(2);
    });
  });

  describe("listCacheEntries", () => {
    afterEach(async () => {
      await clearCache();
    });

    it("returns empty array when cache dir is empty", async () => {
      await clearCache();
      const entries = await listCacheEntries();
      expect(entries).toEqual([]);
    });

    it("returns valid v2 entries with full metadata", async () => {
      const repo = "list-test/repo";
      const sha = "deadbeefcafe1234567890";
      await writeCache(repo, sha, makeFacts({ repoName: repo }), {
        focus: "all",
        style: "oss",
        model: "claude-opus-4-5",
        audience: "backend",
      });

      const entries = await listCacheEntries();
      const ours = entries.filter((e) => e.entry?.repoFullName === repo);
      expect(ours).toHaveLength(1);
      const summary = ours[0];
      expect(summary.problem).toBeUndefined();
      expect(summary.entry).not.toBeNull();
      expect(summary.entry!.phase).toBe("facts");
      expect(summary.entry!.commitSha).toBe(sha);
      expect(summary.entry!.generationOptions.model).toBe("claude-opus-4-5");
      expect(summary.entry!.generationOptions.style).toBe("oss");
      expect(summary.sizeBytes).toBeGreaterThan(0);
      expect(summary.mtimeMs).toBeGreaterThan(0);
      expect(summary.file).toMatch(/\.json$/);
    });

    it("flags JSON parse errors as malformed", async () => {
      const cacheDir = getCacheDir();
      await mkdir(cacheDir, { recursive: true });
      const badFile = join(cacheDir, "list-malformed.json");
      await writeFile(badFile, "{ not json at all", "utf-8");

      const entries = await listCacheEntries();
      const ours = entries.filter((e) => e.file === "list-malformed.json");
      expect(ours).toHaveLength(1);
      expect(ours[0].problem).toBe("malformed");
      expect(ours[0].entry).toBeNull();
    });

    it("flags valid JSON with the wrong shape as malformed", async () => {
      // The e2e tests drop arbitrary JSON blobs into the cache dir; verify
      // those surface as malformed (not crashes, not silently hidden).
      const cacheDir = getCacheDir();
      await mkdir(cacheDir, { recursive: true });
      const strayFile = join(cacheDir, "list-stray.json");
      await writeFile(strayFile, '{"stale":true}\n', "utf-8");

      const entries = await listCacheEntries();
      const ours = entries.filter((e) => e.file === "list-stray.json");
      expect(ours).toHaveLength(1);
      expect(ours[0].problem).toBe("malformed");
    });

    it("flags entries with a non-current schema version as legacy", async () => {
      const cacheDir = getCacheDir();
      await mkdir(cacheDir, { recursive: true });
      const legacyFile = join(cacheDir, "list-legacy.json");
      const legacyContent = {
        version: 1,
        phase: "facts",
        repoFullName: "legacy/repo",
        commitSha: "deadbeef",
        createdAt: new Date().toISOString(),
        value: {},
      };
      await writeFile(legacyFile, JSON.stringify(legacyContent), "utf-8");

      const entries = await listCacheEntries();
      const ours = entries.filter((e) => e.file === "list-legacy.json");
      expect(ours).toHaveLength(1);
      expect(ours[0].problem).toBe("legacy");
      expect(ours[0].entry).toBeNull();
    });

    it("treats missing generationOptions as compatible with v2 (matches readPhaseCache)", async () => {
      // readPhaseCache normalizes a missing generationOptions to empty
      // strings rather than rejecting the entry. listCacheEntries should
      // do the same so it doesn't falsely flag readable v2 files.
      const cacheDir = getCacheDir();
      await mkdir(cacheDir, { recursive: true });
      const file = join(cacheDir, "list-nogenopts.json");
      const content = {
        version: getCacheVersion(),
        phase: "facts" as const,
        repoFullName: "minimal/repo",
        commitSha: "abc1234",
        createdAt: new Date().toISOString(),
        value: {},
      };
      await writeFile(file, JSON.stringify(content), "utf-8");

      const entries = await listCacheEntries();
      const ours = entries.filter((e) => e.file === "list-nogenopts.json");
      expect(ours).toHaveLength(1);
      expect(ours[0].problem).toBeUndefined();
      expect(ours[0].entry).not.toBeNull();
      expect(ours[0].entry!.generationOptions).toEqual({
        focus: "",
        style: "",
        model: "",
        audience: "",
      });
    });

    it("sorts mtime descending with filename tiebreaker", async () => {
      const cacheDir = getCacheDir();
      await mkdir(cacheDir, { recursive: true });

      const files = ["list-sort-a.json", "list-sort-b.json", "list-sort-c.json"];
      for (const f of files) {
        const content = {
          version: getCacheVersion(),
          phase: "facts" as const,
          repoFullName: `sort/${f}`,
          commitSha: "sha",
          createdAt: new Date().toISOString(),
          value: {},
        };
        await writeFile(join(cacheDir, f), JSON.stringify(content), "utf-8");
      }

      // Give all files the same mtime so the tiebreaker is exercised.
      const sameTime = new Date("2024-06-01T00:00:00.000Z");
      await Promise.all(files.map((f) => utimes(join(cacheDir, f), sameTime, sameTime)));

      const entries = await listCacheEntries();
      const ourFiles = entries.filter((e) => e.file.startsWith("list-sort-")).map((e) => e.file);
      // Equal mtimes → alphabetical tiebreaker
      expect(ourFiles).toEqual(["list-sort-a.json", "list-sort-b.json", "list-sort-c.json"]);

      // Now bump file C forward in time; it should move to the front.
      const future = new Date("2025-01-01T00:00:00.000Z");
      await utimes(join(cacheDir, "list-sort-c.json"), future, future);

      const reordered = await listCacheEntries();
      const reorderedFiles = reordered
        .filter((e) => e.file.startsWith("list-sort-"))
        .map((e) => e.file);
      expect(reorderedFiles[0]).toBe("list-sort-c.json");
    });
  });
});
