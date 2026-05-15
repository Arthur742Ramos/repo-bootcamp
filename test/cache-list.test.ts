/**
 * Tests for the `cache list` renderer.
 *
 * These hit the pure formatting helpers directly so they don't depend on the
 * real cache directory or process spawning.
 */

import { describe, expect, it } from "vitest";

import {
  buildHumanOutput,
  buildJsonOutput,
  formatAge,
  formatBytes,
} from "../src/commands/cache-list.js";
import { getCacheDir, getCacheVersion, type CacheEntrySummary } from "../src/cache.js";

function validSummary(
  overrides: Partial<CacheEntrySummary> & Partial<NonNullable<CacheEntrySummary["entry"]>> = {}
): CacheEntrySummary {
  return {
    file: overrides.file ?? "owner-repo-abc1234567890abc.json",
    path: overrides.path ?? "/tmp/owner-repo-abc1234567890abc.json",
    sizeBytes: overrides.sizeBytes ?? 4096,
    mtimeMs: overrides.mtimeMs ?? Date.UTC(2024, 5, 1),
    entry: {
      version: overrides.version ?? getCacheVersion(),
      phase: overrides.phase ?? "facts",
      repoFullName: overrides.repoFullName ?? "owner/repo",
      commitSha: overrides.commitSha ?? "abc1234deadbeef5678",
      generationOptions: overrides.generationOptions ?? {
        focus: "all",
        style: "oss",
        model: "claude-opus-4-5",
        audience: "backend",
      },
      createdAt: overrides.createdAt ?? "2024-06-01T00:00:00.000Z",
    },
  };
}

function problemSummary(
  problem: NonNullable<CacheEntrySummary["problem"]>,
  file = "stray.json"
): CacheEntrySummary {
  return {
    file,
    path: `/tmp/${file}`,
    sizeBytes: 128,
    mtimeMs: Date.UTC(2024, 5, 1),
    entry: null,
    problem,
  };
}

describe("formatBytes", () => {
  it("renders sub-kB sizes in bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("renders kB with appropriate precision", () => {
    expect(formatBytes(2048)).toBe("2.0 kB");
    expect(formatBytes(10 * 1024)).toBe("10 kB");
    expect(formatBytes(150 * 1024)).toBe("150 kB");
  });

  it("renders MB for sizes >= 1 MB", () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
  });
});

describe("formatAge", () => {
  const now = Date.UTC(2024, 5, 10, 12, 0, 0);

  it("renders 'just now' for sub-second ages", () => {
    expect(formatAge(now - 500, now)).toBe("just now");
  });

  it("renders seconds, minutes, hours, days", () => {
    expect(formatAge(now - 30 * 1000, now)).toBe("30s");
    expect(formatAge(now - 5 * 60 * 1000, now)).toBe("5m");
    expect(formatAge(now - 2 * 60 * 60 * 1000, now)).toBe("2h");
    expect(formatAge(now - 3 * 24 * 60 * 60 * 1000, now)).toBe("3d");
  });

  it("clamps future timestamps to 'just now' rather than negative ages", () => {
    expect(formatAge(now + 5000, now)).toBe("just now");
  });
});

describe("buildJsonOutput", () => {
  it("returns an empty payload when no entries exist", () => {
    const json = buildJsonOutput([]);
    expect(json).toEqual({
      dir: getCacheDir(),
      version: getCacheVersion(),
      entries: [],
      totalEntries: 0,
      totalBytes: 0,
    });
  });

  it("includes per-entry totals and absolute mtime/age fields", () => {
    const now = Date.UTC(2024, 5, 10, 12, 0, 0);
    const summary = validSummary({
      sizeBytes: 2048,
      mtimeMs: now - 2 * 60 * 60 * 1000,
    });
    const json = buildJsonOutput([summary], now);

    expect(json.totalEntries).toBe(1);
    expect(json.totalBytes).toBe(2048);
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].ageSeconds).toBe(2 * 60 * 60);
    expect(json.entries[0].mtimeMs).toBe(summary.mtimeMs);
    expect(json.entries[0].entry).toEqual(summary.entry);
    expect(json.entries[0].problem).toBeNull();
  });

  it("surfaces problem entries with problem set and entry null", () => {
    const json = buildJsonOutput([problemSummary("legacy", "old.json")]);
    expect(json.entries[0].problem).toBe("legacy");
    expect(json.entries[0].entry).toBeNull();
  });
});

describe("buildHumanOutput", () => {
  it("returns the empty-cache message when there are no entries", () => {
    const out = buildHumanOutput([]);
    expect(out).toContain("Cache is empty");
    expect(out).toContain(getCacheDir());
  });

  it("includes repo, phase, truncated SHA, age, size, model, and style for valid entries", () => {
    const now = Date.UTC(2024, 5, 10, 12, 0, 0);
    const summary = validSummary({
      mtimeMs: now - 5 * 60 * 60 * 1000,
      sizeBytes: 24 * 1024,
    });

    const out = buildHumanOutput([summary], now);

    expect(out).toContain("owner/repo");
    expect(out).toContain("facts");
    // SHA truncated to 7 chars
    expect(out).toContain("abc1234");
    expect(out).not.toContain("abc1234deadbeef5678");
    expect(out).toContain("5h");
    expect(out).toContain("24 kB");
    expect(out).toContain("claude-opus-4-5");
    expect(out).toContain("oss");
    expect(out).toContain("Total: 1 entries");
  });

  it("labels problem rows with the reason and the filename", () => {
    const summary = problemSummary("legacy", "old-entry.json");
    const out = buildHumanOutput([summary]);
    expect(out).toContain("(legacy) old-entry.json");
  });

  it("includes the cache directory and version in the header", () => {
    const out = buildHumanOutput([validSummary()]);
    expect(out).toContain(`Cache directory: ${getCacheDir()}`);
    expect(out).toContain(`Cache version:   ${getCacheVersion()}`);
  });
});
