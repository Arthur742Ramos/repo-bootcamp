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
const CACHE_VERSION = 3;

/** Current cache entry schema version. Exposed so the CLI and tests can
 *  display it without duplicating the constant. */
export function getCacheVersion(): number {
  return CACHE_VERSION;
}

export type CachePhase = "facts" | "deps" | "security" | "impact" | "cycles";
export type AnalysisPhase = Exclude<CachePhase, "facts">;

interface CacheEntry<T = unknown> {
  version: number;
  phase: CachePhase;
  repoFullName: string;
  commitSha: string;
  generationOptions: NormalizedCacheGenerationOptions;
  createdAt: string;
  value: T;
}

export type CacheReadResult<T> = { hit: true; value: T } | { hit: false };

export interface CacheGenerationOptions {
  focus?: string;
  style?: string;
  model?: string;
  audience?: string;
  maxFiles?: number;
  subdir?: string;
  exclude?: readonly string[];
  /** Fingerprint of the actual scanned files and loaded evidence. */
  scanFingerprint?: string;
}

interface NormalizedCacheGenerationOptions {
  focus: string;
  style: string;
  model: string;
  audience: string;
  maxFiles: number | null;
  subdir: string;
  exclude: string[];
  scanFingerprint: string;
}

function normalizeGenerationOptions(
  options?: CacheGenerationOptions
): NormalizedCacheGenerationOptions {
  if (
    options?.maxFiles !== undefined &&
    (!Number.isSafeInteger(options.maxFiles) || options.maxFiles <= 0)
  ) {
    throw new RangeError("Cache maxFiles must be a positive safe integer");
  }
  return {
    focus: options?.focus || "",
    style: options?.style || "",
    model: options?.model || "",
    audience: options?.audience || "",
    maxFiles: options?.maxFiles ?? null,
    subdir: options?.subdir || "",
    // Exclusions are a union: ordering and duplicate patterns do not change
    // the scan. Preserve each pattern verbatim (including glob escapes).
    exclude: [...new Set(options?.exclude ?? [])].sort(),
    scanFingerprint: options?.scanFingerprint || "",
  };
}

function serializeGenerationOptions(options: NormalizedCacheGenerationOptions): string {
  // Structured encoding prevents user-controlled delimiters from colliding.
  return JSON.stringify([
    options.focus,
    options.style,
    options.model,
    options.audience,
    options.maxFiles,
    options.subdir,
    [...new Set(options.exclude)].sort(),
    options.scanFingerprint,
  ]);
}

function hasGenerationOptions(raw: unknown): raw is NormalizedCacheGenerationOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const options = raw as Record<string, unknown>;
  return (
    ["focus", "style", "model", "audience", "subdir", "scanFingerprint"].every(
      (field) => typeof options[field] === "string"
    ) &&
    (options.maxFiles === null ||
      (typeof options.maxFiles === "number" &&
        Number.isSafeInteger(options.maxFiles) &&
        options.maxFiles > 0)) &&
    Array.isArray(options.exclude) &&
    options.exclude.every((pattern) => typeof pattern === "string")
  );
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
  const baseSeed =
    optionsFingerprint === serializeGenerationOptions(normalizeGenerationOptions())
      ? `${repoFullName}@${commitSha}`
      : `${repoFullName}@${commitSha}|${optionsFingerprint}`;
  // Only dependency projection changed: old first-manifest results must miss,
  // while facts and every other phase retain their existing cache identity.
  const phaseSeed = phase === "facts" ? baseSeed : `${baseSeed}|phase=${phase}`;
  const hashSeed = phase === "deps" ? `${phaseSeed}|projection=mixed-ecosystems-v1` : phaseSeed;

  const hash = createHash("sha256").update(hashSeed).digest("hex").substring(0, 16);
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
    if (!hasGenerationOptions(entry.generationOptions)) return { hit: false };
    const entryOptions = entry.generationOptions;

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
  const result = await readPhaseCache<RepoFacts>(
    "facts",
    repoFullName,
    commitSha,
    generationOptions
  );
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
    await Promise.all(jsonFiles.map((f) => rm(join(CACHE_DIR, f), { force: true })));
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

/**
 * Reason a cache file could not be surfaced as a fully-typed entry.
 *
 * - `"legacy"`: file parsed cleanly but is from an older schema version
 *   (`version !== CACHE_VERSION`). Pruning is the right remediation.
 * - `"malformed"`: file exists but does not match the expected shape (e.g.
 *   missing required fields, invalid JSON, or a non-cache `.json` blob that
 *   happens to live in the cache dir).
 * - `"unreadable"`: stat or read failed for this file (e.g. permission denied
 *   or it disappeared between readdir and read).
 */
export type CacheEntryProblem = "legacy" | "malformed" | "unreadable";

/**
 * A single cache file as surfaced by `listCacheEntries`.
 *
 * `entry` is populated for valid current-schema files. Otherwise `entry` is
 * null and `problem` describes why. Even problematic entries are returned so
 * users can see — and remediate — disk usage from stale or stray files.
 */
export interface CacheEntrySummary {
  file: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  entry: {
    version: number;
    phase: CachePhase;
    repoFullName: string;
    commitSha: string;
    generationOptions: NormalizedCacheGenerationOptions;
    createdAt: string;
  } | null;
  problem?: CacheEntryProblem;
}

interface RawCacheEntryShape {
  version?: unknown;
  phase?: unknown;
  repoFullName?: unknown;
  commitSha?: unknown;
  createdAt?: unknown;
  generationOptions?: unknown;
}

const VALID_PHASES: ReadonlySet<CachePhase> = new Set<CachePhase>([
  "facts",
  "deps",
  "security",
  "impact",
  "cycles",
]);

function hasRequiredShape(
  raw: unknown
): raw is Required<
  Pick<RawCacheEntryShape, "version" | "phase" | "repoFullName" | "commitSha" | "createdAt">
> &
  RawCacheEntryShape {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as RawCacheEntryShape;
  return (
    typeof r.version === "number" &&
    typeof r.phase === "string" &&
    VALID_PHASES.has(r.phase as CachePhase) &&
    typeof r.repoFullName === "string" &&
    typeof r.commitSha === "string" &&
    typeof r.createdAt === "string"
  );
}

async function summarizeCacheFile(file: string): Promise<CacheEntrySummary | null> {
  const path = join(CACHE_DIR, file);
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
    return {
      file,
      path,
      sizeBytes: 0,
      mtimeMs: 0,
      entry: null,
      problem: "unreadable",
    };
  }

  if (!fileStat.isFile()) return null;

  const base: Pick<CacheEntrySummary, "file" | "path" | "sizeBytes" | "mtimeMs"> = {
    file,
    path,
    sizeBytes: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
  };

  let raw: unknown;
  try {
    const content = await readFile(path, "utf-8");
    raw = JSON.parse(content);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
    // Unreadable vs. malformed: distinguish IO failure from successful read
    // of garbage JSON so the user can tell stale-schema files apart from
    // permission problems.
    const isParseError = err instanceof SyntaxError;
    return { ...base, entry: null, problem: isParseError ? "malformed" : "unreadable" };
  }

  if (!hasRequiredShape(raw)) {
    return { ...base, entry: null, problem: "malformed" };
  }

  const entryVersion = raw.version as number;
  if (entryVersion !== CACHE_VERSION) {
    return { ...base, entry: null, problem: "legacy" };
  }

  if (!hasGenerationOptions(raw.generationOptions)) {
    return { ...base, entry: null, problem: "malformed" };
  }

  return {
    ...base,
    entry: {
      version: entryVersion,
      phase: raw.phase as CachePhase,
      repoFullName: raw.repoFullName as string,
      commitSha: raw.commitSha as string,
      generationOptions: raw.generationOptions,
      createdAt: raw.createdAt as string,
    },
  };
}

/**
 * List every file currently in the cache directory, including legacy and
 * malformed ones. Sorted by mtime descending so the most recently touched
 * entries appear first; ties broken alphabetically by filename for
 * deterministic ordering.
 *
 * Returns an empty array if the cache dir does not exist yet.
 */
export async function listCacheEntries(): Promise<CacheEntrySummary[]> {
  let files: string[];
  try {
    files = await readdir(CACHE_DIR);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
    return [];
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const settled = await Promise.all(jsonFiles.map((f) => summarizeCacheFile(f)));
  const summaries = settled.filter((s): s is CacheEntrySummary => s !== null);

  summaries.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return a.file.localeCompare(b.file);
  });

  return summaries;
}
