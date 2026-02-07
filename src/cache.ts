/**
 * Cache layer for analysis results
 * Stores/retrieves RepoFacts by repo fullName + commit SHA
 * Cache location: ~/.cache/repo-bootcamp/
 */

import { mkdir, readFile, writeFile, readdir, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import type { RepoFacts } from "./types.js";

const CACHE_DIR = join(homedir(), ".cache", "repo-bootcamp");
const CACHE_VERSION = 1;

interface CacheEntry {
  version: number;
  repoFullName: string;
  commitSha: string;
  createdAt: string;
  facts: RepoFacts;
}

/**
 * Build a cache key from repo name and commit SHA
 */
function cacheKey(repoFullName: string, commitSha: string): string {
  const hash = createHash("sha256")
    .update(`${repoFullName}@${commitSha}`)
    .digest("hex")
    .substring(0, 16);
  const safeName = repoFullName.replace(/\//g, "-");
  return `${safeName}-${hash}.json`;
}

/**
 * Ensure the cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
}

/**
 * Read cached analysis results
 * Returns null if no cache hit or cache is invalid
 */
export async function readCache(
  repoFullName: string,
  commitSha: string
): Promise<RepoFacts | null> {
  try {
    const filePath = join(CACHE_DIR, cacheKey(repoFullName, commitSha));
    const raw = await readFile(filePath, "utf-8");
    const entry: CacheEntry = JSON.parse(raw);

    if (
      entry.version !== CACHE_VERSION ||
      entry.repoFullName !== repoFullName ||
      entry.commitSha !== commitSha
    ) {
      return null;
    }

    return entry.facts;
  } catch {
    return null;
  }
}

/**
 * Write analysis results to cache
 */
export async function writeCache(
  repoFullName: string,
  commitSha: string,
  facts: RepoFacts
): Promise<void> {
  await ensureCacheDir();

  const entry: CacheEntry = {
    version: CACHE_VERSION,
    repoFullName,
    commitSha,
    createdAt: new Date().toISOString(),
    facts,
  };

  const filePath = join(CACHE_DIR, cacheKey(repoFullName, commitSha));
  await writeFile(filePath, JSON.stringify(entry, null, 2), "utf-8");
}

/**
 * Clear all cached entries
 */
export async function clearCache(): Promise<number> {
  try {
    const files = await readdir(CACHE_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    await Promise.all(
      jsonFiles.map((f) => rm(join(CACHE_DIR, f), { force: true }))
    );
    return jsonFiles.length;
  } catch {
    return 0;
  }
}

/**
 * Get the cache directory path (for display purposes)
 */
export function getCacheDir(): string {
  return CACHE_DIR;
}
