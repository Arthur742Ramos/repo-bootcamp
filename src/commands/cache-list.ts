/**
 * `bootcamp cache list` command.
 *
 * Renders the contents of the analysis cache directory in either a
 * human-readable table or a stable JSON payload (`--json`). All formatting
 * helpers are exported so unit tests can pin the output without spawning a
 * real CLI process.
 */

import chalk from "chalk";

import {
  type CacheEntrySummary,
  getCacheDir,
  getCacheVersion,
  listCacheEntries,
} from "../cache.js";

export interface CacheListOptions {
  json?: boolean;
}

interface PlainRow {
  repo: string;
  phase: string;
  sha: string;
  age: string;
  size: string;
  model: string;
  style: string;
}

interface JsonEntry {
  file: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  ageSeconds: number;
  problem: CacheEntrySummary["problem"] | null;
  entry: CacheEntrySummary["entry"];
}

interface CacheListJson {
  dir: string;
  version: number;
  entries: JsonEntry[];
  totalEntries: number;
  totalBytes: number;
}

const SHA_DISPLAY_LENGTH = 7;

/** Format a byte count as a compact human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} kB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

/**
 * Format an mtime as a relative age relative to `now`.
 *
 * Examples: `"just now"`, `"3m"`, `"2h"`, `"5d"`. `now` defaults to
 * `Date.now()`; tests inject a fixed clock for stable output.
 */
export function formatAge(mtimeMs: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - mtimeMs);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return seconds === 0 ? "just now" : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function rowForEntry(summary: CacheEntrySummary, now: number): PlainRow {
  const age = formatAge(summary.mtimeMs, now);
  const size = formatBytes(summary.sizeBytes);

  if (summary.entry) {
    return {
      repo: summary.entry.repoFullName,
      phase: summary.entry.phase,
      sha: summary.entry.commitSha.slice(0, SHA_DISPLAY_LENGTH) || "-",
      age,
      size,
      model: summary.entry.generationOptions.model || "-",
      style: summary.entry.generationOptions.style || "-",
    };
  }

  // Surface legacy/malformed/unreadable entries so users can see — and
  // remediate — disk usage from stray files. Their structured fields are
  // unavailable, so the row shows the filename and the reason instead.
  const label = summary.problem ?? "unknown";
  return {
    repo: `(${label}) ${summary.file}`,
    phase: "-",
    sha: "-",
    age,
    size,
    model: "-",
    style: "-",
  };
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function renderTable(rows: PlainRow[]): string {
  const headers: PlainRow = {
    repo: "REPOSITORY",
    phase: "PHASE",
    sha: "SHA",
    age: "AGE",
    size: "SIZE",
    model: "MODEL",
    style: "STYLE",
  };
  const all = [headers, ...rows];
  const widths = {
    repo: Math.max(...all.map((r) => r.repo.length)),
    phase: Math.max(...all.map((r) => r.phase.length)),
    sha: Math.max(...all.map((r) => r.sha.length)),
    age: Math.max(...all.map((r) => r.age.length)),
    size: Math.max(...all.map((r) => r.size.length)),
    model: Math.max(...all.map((r) => r.model.length)),
    style: Math.max(...all.map((r) => r.style.length)),
  } as const;

  const formatLine = (row: PlainRow, isHeader: boolean): string => {
    const line = [
      padRight(row.repo, widths.repo),
      padRight(row.phase, widths.phase),
      padRight(row.sha, widths.sha),
      padRight(row.age, widths.age),
      padRight(row.size, widths.size),
      padRight(row.model, widths.model),
      padRight(row.style, widths.style),
    ].join("  ");
    return isHeader ? chalk.bold(line) : line;
  };

  return [formatLine(headers, true), ...rows.map((r) => formatLine(r, false))].join("\n");
}

/**
 * Render `summaries` as a JSON object suitable for machine consumption.
 *
 * `entries` preserves the mtime-descending order from `listCacheEntries`.
 */
export function buildJsonOutput(
  summaries: CacheEntrySummary[],
  now: number = Date.now()
): CacheListJson {
  const entries: JsonEntry[] = summaries.map((s) => ({
    file: s.file,
    path: s.path,
    sizeBytes: s.sizeBytes,
    mtimeMs: s.mtimeMs,
    ageSeconds: Math.max(0, Math.floor((now - s.mtimeMs) / 1000)),
    problem: s.problem ?? null,
    entry: s.entry,
  }));

  return {
    dir: getCacheDir(),
    version: getCacheVersion(),
    entries,
    totalEntries: entries.length,
    totalBytes: entries.reduce((acc, e) => acc + e.sizeBytes, 0),
  };
}

/**
 * Render `summaries` as a human-readable report. Returns a single string
 * suitable for `console.log`.
 */
export function buildHumanOutput(summaries: CacheEntrySummary[], now: number = Date.now()): string {
  const dir = getCacheDir();
  if (summaries.length === 0) {
    return `Cache is empty (no entries in ${dir}).`;
  }

  const rows = summaries.map((s) => rowForEntry(s, now));
  const totalBytes = summaries.reduce((acc, s) => acc + s.sizeBytes, 0);

  const lines: string[] = [];
  lines.push(chalk.dim(`Cache directory: ${dir}`));
  lines.push(chalk.dim(`Cache version:   ${getCacheVersion()}`));
  lines.push("");
  lines.push(renderTable(rows));
  lines.push("");
  lines.push(chalk.dim(`Total: ${summaries.length} entries, ${formatBytes(totalBytes)}`));
  return lines.join("\n");
}

/** Entry point used by the CLI. */
export async function runCacheList(options: CacheListOptions = {}): Promise<void> {
  const summaries = await listCacheEntries();

  if (options.json) {
    // Always emit valid JSON, even when empty, so machine consumers can
    // unconditionally parse stdout.
    console.log(JSON.stringify(buildJsonOutput(summaries), null, 2));
    return;
  }

  console.log(buildHumanOutput(summaries));
}
