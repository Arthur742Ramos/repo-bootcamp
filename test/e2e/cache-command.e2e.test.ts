import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

describe("cache commands", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("prunes old cache entries and clears the remaining cache through the real CLI process", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-cache-e2e-"));
    tempDirs.push(tempDir);

    const homeDir = join(tempDir, "home");
    const cacheDir = join(homeDir, ".cache", "repo-bootcamp");
    await mkdir(cacheDir, { recursive: true });

    const staleFile = join(cacheDir, "stale-entry.json");
    const freshFile = join(cacheDir, "fresh-entry.json");
    await writeFile(staleFile, '{"stale":true}\n', "utf-8");
    await writeFile(freshFile, '{"fresh":true}\n', "utf-8");

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await utimes(staleFile, tenDaysAgo, tenDaysAgo);

    const pruneResult = await runCli(
      ["cache", "prune", "--max-age", "7"],
      { HOME: homeDir },
      60_000,
      tempDir
    );
    expect(pruneResult.exitCode).toBe(0);
    expect(pruneResult.stdout).toContain("Pruned 1 cache file(s)");

    const remainingAfterPrune = await readdir(cacheDir);
    expect(remainingAfterPrune).toEqual(["fresh-entry.json"]);

    const clearResult = await runCli(["cache", "clear"], { HOME: homeDir }, 60_000, tempDir);
    expect(clearResult.exitCode).toBe(0);
    expect(clearResult.stdout).toContain("Cleared 1 cache file(s)");

    const remainingAfterClear = await readdir(cacheDir);
    expect(remainingAfterClear).toEqual([]);
  }, 90_000);

  it("lists cache entries with metadata and supports --json output", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-cache-list-e2e-"));
    tempDirs.push(tempDir);

    const homeDir = join(tempDir, "home");
    const cacheDir = join(homeDir, ".cache", "repo-bootcamp");
    await mkdir(cacheDir, { recursive: true });

    // Seed: one well-formed v2 facts entry and one stray JSON blob.
    // Writing the JSON directly lets us avoid module-load ordering between
    // the test process and the spawned CLI (which read CACHE_DIR from
    // their own respective home dirs).
    const validEntry = {
      version: 2,
      phase: "facts" as const,
      repoFullName: "owner/example",
      commitSha: "facebead123456789012",
      generationOptions: {
        focus: "all",
        style: "oss",
        model: "claude-opus-4-5",
        audience: "backend",
      },
      createdAt: new Date().toISOString(),
      value: { repoName: "owner/example" },
    };
    const validFile = join(cacheDir, "owner-example-facebead12345678.json");
    await writeFile(validFile, JSON.stringify(validEntry), "utf-8");

    const strayFile = join(cacheDir, "stray-blob.json");
    await writeFile(strayFile, '{"foo":"bar"}\n', "utf-8");

    // Human-readable listing.
    const listResult = await runCli(["cache", "list"], { HOME: homeDir }, 60_000, tempDir);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain("Cache directory:");
    expect(listResult.stdout).toContain("owner/example");
    expect(listResult.stdout).toContain("facts");
    expect(listResult.stdout).toContain("facebea"); // SHA truncated to 7 chars
    expect(listResult.stdout).toContain("claude-opus-4-5");
    expect(listResult.stdout).toContain("(malformed) stray-blob.json");
    expect(listResult.stdout).toContain("Total: 2 entries");

    // JSON output for machine consumption.
    const jsonResult = await runCli(
      ["cache", "list", "--json"],
      { HOME: homeDir },
      60_000,
      tempDir
    );
    expect(jsonResult.exitCode).toBe(0);
    const parsed = JSON.parse(jsonResult.stdout);
    expect(parsed.version).toBe(2);
    expect(parsed.totalEntries).toBe(2);
    expect(parsed.totalBytes).toBeGreaterThan(0);
    expect(Array.isArray(parsed.entries)).toBe(true);

    const validInJson = parsed.entries.find(
      (e: { entry: { repoFullName?: string } | null }) => e.entry?.repoFullName === "owner/example"
    );
    expect(validInJson).toBeDefined();
    expect(validInJson.entry.commitSha).toBe("facebead123456789012"); // full SHA in JSON
    expect(validInJson.entry.generationOptions.model).toBe("claude-opus-4-5");
    expect(validInJson.problem).toBeNull();

    const strayInJson = parsed.entries.find((e: { file: string }) => e.file === "stray-blob.json");
    expect(strayInJson).toBeDefined();
    expect(strayInJson.problem).toBe("malformed");
    expect(strayInJson.entry).toBeNull();
  }, 90_000);

  it("renders an empty-cache message and still emits valid JSON when nothing is cached", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-cache-list-empty-e2e-"));
    tempDirs.push(tempDir);

    const homeDir = join(tempDir, "home");
    // Note: deliberately do not create the cache dir — the command should
    // tolerate its absence the same way prune/clear do.

    const listResult = await runCli(["cache", "list"], { HOME: homeDir }, 60_000, tempDir);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain("Cache is empty");

    const jsonResult = await runCli(
      ["cache", "list", "--json"],
      { HOME: homeDir },
      60_000,
      tempDir
    );
    expect(jsonResult.exitCode).toBe(0);
    const parsed = JSON.parse(jsonResult.stdout);
    expect(parsed.totalEntries).toBe(0);
    expect(parsed.totalBytes).toBe(0);
    expect(parsed.entries).toEqual([]);
  }, 90_000);
});
