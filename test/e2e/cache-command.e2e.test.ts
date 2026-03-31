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

    const pruneResult = await runCli(["cache", "prune", "--max-age", "7"], { HOME: homeDir }, 60_000, tempDir);
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
});
