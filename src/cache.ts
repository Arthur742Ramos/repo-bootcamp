/**
 * Cache layer for analysis results
 * Stores/retrieves RepoFacts by repo fullName + commit SHA
 * Cache location: ~/.cache/repo-bootcamp/
 */

import { mkdir, readFile, writeFile, readdir, rm, stat } from "fs/promises";
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
  generationOptions?: NormalizedCacheGenerationOptions;
  createdAt: string;
  facts: RepoFacts;
}

export interface CacheGenerationOptions {
  focus?: string;
  style?: string;
  model?: string;
  audience?: string;
}

interface NormalizedCacheGenerationOptions {
  focus: string;
  style: string;
  model: string;
  audience: string;
}

function normalizeGenerationOptions(
  options?: CacheGenerationOptions
): NormalizedCacheGenerationOptions {
  return {
    focus: options?.focus || "",
    style: options?.style || "",
    model: options?.model || "",
    audience: options?.audience || "",
  };
}

function serializeGenerationOptions(options: NormalizedCacheGenerationOptions): string {
  return [
    `focus=${options.focus}`,
    `style=${options.style}`,
    `model=${options.model}`,
    `audience=${options.audience}`,
  ].join("|");
}

/**
 * Build a cache key from repo name and commit SHA
 */
function cacheKey(
  repoFullName: string,
  commitSha: string,
  generationOptions?: CacheGenerationOptions
): string {
  const normalizedOptions = normalizeGenerationOptions(generationOptions);
  const optionsFingerprint = serializeGenerationOptions(normalizedOptions);
  const hashSeed = optionsFingerprint === "focus=|style=|model=|audience="
    ? `${repoFullName}@${commitSha}`
    : `${repoFullName}@${commitSha}|${optionsFingerprint}`;

  const hash = createHash("sha256")
    .update(hashSeed)
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
  commitSha: string,
  generationOptions?: CacheGenerationOptions
): Promise<RepoFacts | null> {
  try {
    const expectedOptions = normalizeGenerationOptions(generationOptions);
    const filePath = join(CACHE_DIR, cacheKey(repoFullName, commitSha, generationOptions));
    const raw = await readFile(filePath, "utf-8");
    const entry: CacheEntry = JSON.parse(raw);
    const entryOptions = normalizeGenerationOptions(entry.generationOptions);

    if (
      entry.version !== CACHE_VERSION ||
      entry.repoFullName !== repoFullName ||
      entry.commitSha !== commitSha ||
      serializeGenerationOptions(entryOptions) !== serializeGenerationOptions(expectedOptions)
    ) {
      return null;
    }

    return entry.facts;
  } catch (err: unknown) {
    // Log and return null on failure
    if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
    return null;
  }
}

/**
 * Write analysis results to cache
 */
export async function writeCache(
  repoFullName: string,
  commitSha: string,
  facts: RepoFacts,
  generationOptions?: CacheGenerationOptions
): Promise<void> {
  await ensureCacheDir();
  const normalizedOptions = normalizeGenerationOptions(generationOptions);

  const entry: CacheEntry = {
    version: CACHE_VERSION,
    repoFullName,
    commitSha,
    generationOptions: normalizedOptions,
    createdAt: new Date().toISOString(),
    facts,
  };

  const filePath = join(CACHE_DIR, cacheKey(repoFullName, commitSha, generationOptions));
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
  } catch (err: unknown) {
    if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
    return 0;
  }
}

/**
 * Prune cache files older than maxAgeMs milliseconds
 * Returns the number of files deleted
 */
export async function pruneCache(maxAgeMs: number): Promise<number> {
  try {
    const files = await readdir(CACHE_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const now = Date.now();
    let pruned = 0;

    await Promise.all(
      jsonFiles.map(async (f) => {
        try {
          const filePath = join(CACHE_DIR, f);
          const fileStat = await stat(filePath);
          if (now - fileStat.mtimeMs > maxAgeMs) {
            await rm(filePath, { force: true });
            pruned++;
          }
        } catch (err: unknown) {
          // File may have been removed concurrently — skip
          if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
        }
      })
    );

    return pruned;
  } catch (err: unknown) {
    if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
    return 0;
  }
}

/**
 * Get the cache directory path (for display purposes)
 */
export function getCacheDir(): string {
  return CACHE_DIR;
}
