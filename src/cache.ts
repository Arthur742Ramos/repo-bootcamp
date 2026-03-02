/**
 * Cache layer for analysis results
 * Stores/retrieves per-phase analysis data by repo fullName + commit SHA
 * Cache location: ~/.cache/repo-bootcamp/
 */

import { mkdir, readFile, writeFile, readdir, rm, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import type { RepoFacts } from "./types.js";

const CACHE_DIR = join(homedir(), ".cache", "repo-bootcamp");
const CACHE_VERSION = 2;

export type CachePhase = "facts" | "deps" | "security" | "impact";
export type AnalysisPhase = Exclude<CachePhase, "facts">;

interface CacheEntry<T = unknown> {
  version: number;
  phase: CachePhase;
  repoFullName: string;
  commitSha: string;
  generationOptions?: NormalizedCacheGenerationOptions;
  createdAt: string;
  value: T;
}

export type CacheReadResult<T> =
  | { hit: true; value: T }
  | { hit: false };

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
 * Build a cache key from repo name, commit SHA, and cache phase
 */
function cacheKey(
  repoFullName: string,
  commitSha: string,
  generationOptions?: CacheGenerationOptions,
  phase: CachePhase = "facts"
): string {
  const normalizedOptions = normalizeGenerationOptions(generationOptions);
  const optionsFingerprint = serializeGenerationOptions(normalizedOptions);
  const baseSeed = optionsFingerprint === "focus=|style=|model=|audience="
    ? `${repoFullName}@${commitSha}`
    : `${repoFullName}@${commitSha}|${optionsFingerprint}`;
  const hashSeed = phase === "facts" ? baseSeed : `${baseSeed}|phase=${phase}`;

  const hash = createHash("sha256")
    .update(hashSeed)
    .digest("hex")
    .substring(0, 16);
  const safeName = repoFullName.replace(/\//g, "-");
  const phaseSuffix = phase === "facts" ? "" : `-${phase}`;
  return `${safeName}${phaseSuffix}-${hash}.json`;
}

/**
 * Ensure the cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
}

/**
 * Read a specific cached analysis phase.
 */
export async function readPhaseCache<T>(
  phase: CachePhase,
  repoFullName: string,
  commitSha: string,
  generationOptions?: CacheGenerationOptions
): Promise<CacheReadResult<T>> {
  try {
    const expectedOptions = normalizeGenerationOptions(generationOptions);
    const filePath = join(CACHE_DIR, cacheKey(repoFullName, commitSha, generationOptions, phase));
    const raw = await readFile(filePath, "utf-8");
    const entry: CacheEntry<T> = JSON.parse(raw);
    const entryOptions = normalizeGenerationOptions(entry.generationOptions);

    if (
      entry.version !== CACHE_VERSION ||
      entry.phase !== phase ||
      entry.repoFullName !== repoFullName ||
      entry.commitSha !== commitSha ||
      serializeGenerationOptions(entryOptions) !== serializeGenerationOptions(expectedOptions)
    ) {
      return { hit: false };
    }

    return { hit: true, value: entry.value };
  } catch (err: unknown) {
    if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
    return { hit: false };
  }
}

/**
 * Write a specific analysis phase to cache.
 */
export async function writePhaseCache<T>(
  phase: CachePhase,
  repoFullName: string,
  commitSha: string,
  value: T,
  generationOptions?: CacheGenerationOptions
): Promise<void> {
  await ensureCacheDir();
  const normalizedOptions = normalizeGenerationOptions(generationOptions);

  const entry: CacheEntry<T> = {
    version: CACHE_VERSION,
    phase,
    repoFullName,
    commitSha,
    generationOptions: normalizedOptions,
    createdAt: new Date().toISOString(),
    value,
  };

  const filePath = join(CACHE_DIR, cacheKey(repoFullName, commitSha, generationOptions, phase));
  await writeFile(filePath, JSON.stringify(entry, null, 2), "utf-8");
}

/**
 * Legacy wrappers for full facts cache reads.
 */
export async function readCache(
  repoFullName: string,
  commitSha: string,
  generationOptions?: CacheGenerationOptions
): Promise<RepoFacts | null> {
  const result = await readPhaseCache<RepoFacts>("facts", repoFullName, commitSha, generationOptions);
  if (!result.hit) {
    return null;
  }
  return result.value;
}

/**
 * Legacy wrappers for full facts cache writes.
 */
export async function writeCache(
  repoFullName: string,
  commitSha: string,
  facts: RepoFacts,
  generationOptions?: CacheGenerationOptions
): Promise<void> {
  await writePhaseCache("facts", repoFullName, commitSha, facts, generationOptions);
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
