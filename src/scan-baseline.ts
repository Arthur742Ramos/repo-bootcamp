/** Portable, bounded comparisons of deterministic repository scan reports. */
import { open } from "node:fs/promises";
import { constants } from "node:fs";

export const SCAN_SCHEMA_VERSION = 1;
export const MAX_BASELINE_BYTES = 8 * 1024 * 1024;
export const SCAN_MEASURES = ["health", "metrics", "security", "onboardingRisk"] as const;
export type ScanMeasure = (typeof SCAN_MEASURES)[number];
type HealthStatus = "pass" | "warn" | "fail";
export interface ScanMetadata {
  schemaVersion: number;
  analyzerVersion: string;
  maxFiles: number;
}
export interface ScanSnapshot {
  metadata: ScanMetadata;
  repo: string;
  filesScanned: number;
  scores: Record<ScanMeasure, { score: number }>;
  health: { checks: { id: string; label: string; status: HealthStatus }[] };
}
export interface ScanComparison {
  baseline: { repo: string; filesScanned: number };
  maxRegression: number;
  scores: {
    measure: ScanMeasure;
    direction: "higher" | "lower";
    before: number;
    after: number;
    delta: number;
    regression: number;
    exceedsTolerance: boolean;
  }[];
  healthChanges: { id: string; label: string; before: HealthStatus; after: HealthStatus }[];
  regressed: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function score(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}
function status(value: unknown): value is HealthStatus {
  return value === "pass" || value === "warn" || value === "fail";
}

/** Retain only the comparison contract; never trust an arbitrary parsed object. */
export function parseScanSnapshot(value: unknown, expected: ScanMetadata): ScanSnapshot {
  if (!record(value) || !record(value.metadata)) {
    throw new Error("Baseline is missing scan metadata. Generate it with bootcamp scan --json.");
  }
  const metadata = value.metadata;
  if (
    metadata.schemaVersion !== expected.schemaVersion ||
    metadata.analyzerVersion !== expected.analyzerVersion ||
    metadata.maxFiles !== expected.maxFiles
  ) {
    throw new Error(
      "Baseline is incompatible: schema version, analyzer version and max-files must match. Regenerate the baseline with this analyzer and scan limit."
    );
  }
  if (
    typeof value.repo !== "string" ||
    !value.repo ||
    !Number.isSafeInteger(value.filesScanned) ||
    (value.filesScanned as number) < 0 ||
    !record(value.scores) ||
    !record(value.health) ||
    !Array.isArray(value.health.checks)
  ) {
    throw new Error("Invalid baseline scan report.");
  }
  const scores = {} as ScanSnapshot["scores"];
  for (const measure of SCAN_MEASURES) {
    const entry = value.scores[measure];
    if (!record(entry) || !score(entry.score))
      throw new Error("Invalid baseline score: " + measure + ".");
    scores[measure] = { score: entry.score };
  }
  const ids = new Set<string>();
  const checks = value.health.checks.map((check: unknown) => {
    if (
      !record(check) ||
      typeof check.id !== "string" ||
      !check.id ||
      typeof check.label !== "string" ||
      !status(check.status) ||
      ids.has(check.id)
    ) {
      throw new Error("Invalid or duplicate baseline health check.");
    }
    ids.add(check.id);
    return { id: check.id, label: check.label, status: check.status };
  });
  return {
    metadata: { ...expected },
    repo: value.repo,
    filesScanned: value.filesScanned as number,
    scores,
    health: { checks },
  };
}

/** Read at most the limit plus one byte, including when the file grows during reading. */
export async function readScanBaseline(
  path: string,
  expected: ScanMetadata
): Promise<ScanSnapshot> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("Baseline must be a regular JSON file.");
    if (info.size > MAX_BASELINE_BYTES) throw new Error("Baseline exceeds the 8 MiB size limit.");
    const buffer = Buffer.alloc(MAX_BASELINE_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const result = await file.read(buffer, bytes, buffer.length - bytes, null);
      if (result.bytesRead === 0) break;
      bytes += result.bytesRead;
    }
    if (bytes > MAX_BASELINE_BYTES) throw new Error("Baseline exceeds the 8 MiB size limit.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes))
      );
    } catch {
      throw new Error("Baseline is not valid JSON. Generate it with bootcamp scan --json.");
    }
    return parseScanSnapshot(parsed, expected);
  } finally {
    await file.close();
  }
}

export function compareScanSnapshots(
  base: ScanSnapshot,
  current: ScanSnapshot,
  maxRegression = 0
): ScanComparison {
  if (!score(maxRegression))
    throw new Error("--max-regression must be a finite number from 0 to 100.");
  const before = parseScanSnapshot(base, current.metadata);
  const after = parseScanSnapshot(current, current.metadata);
  const baseChecks = new Map(before.health.checks.map((check) => [check.id, check]));
  if (
    baseChecks.size !== after.health.checks.length ||
    after.health.checks.some((check) => !baseChecks.has(check.id))
  ) {
    throw new Error(
      "Baseline health checks differ from this scan. Regenerate the baseline with this analyzer."
    );
  }
  const scores = SCAN_MEASURES.map((measure) => {
    const direction = measure === "onboardingRisk" ? ("lower" as const) : ("higher" as const);
    const delta = after.scores[measure].score - before.scores[measure].score;
    const regression = Math.max(0, direction === "lower" ? delta : -delta);
    return {
      measure,
      direction,
      before: before.scores[measure].score,
      after: after.scores[measure].score,
      delta,
      regression,
      exceedsTolerance: regression > maxRegression,
    };
  });
  const healthChanges = after.health.checks.flatMap((check) => {
    const previous = baseChecks.get(check.id)!;
    return previous.status === check.status
      ? []
      : [{ id: check.id, label: check.label, before: previous.status, after: check.status }];
  });
  return {
    baseline: { repo: before.repo, filesScanned: before.filesScanned },
    maxRegression,
    scores,
    healthChanges,
    regressed: scores.some((entry) => entry.exceedsTolerance),
  };
}

/** Baseline labels are external data; prevent terminal control-sequence injection. */
function terminalText(value: string): string {
  // Intentional control-character removal for untrusted terminal output.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
}
export function formatScanComparison(comparison: ScanComparison): string {
  const lines = [
    "Baseline comparison",
    "Baseline: " +
      terminalText(comparison.baseline.repo) +
      " (" +
      comparison.baseline.filesScanned +
      " files)",
    "Allowed regression: " + comparison.maxRegression + " points per score",
  ];
  for (const item of comparison.scores) {
    lines.push(
      "  " +
        item.measure +
        ": " +
        item.before +
        " -> " +
        item.after +
        " (" +
        (item.delta > 0 ? "+" : "") +
        item.delta +
        "; " +
        item.direction +
        " is better)" +
        (item.exceedsTolerance ? " REGRESSION" : "")
    );
  }
  lines.push("Changed readiness checks:");
  if (!comparison.healthChanges.length) lines.push("  No readiness check statuses changed.");
  for (const check of comparison.healthChanges)
    lines.push("  " + terminalText(check.label) + ": " + check.before + " -> " + check.after);
  lines.push(
    "Scores are deterministic heuristics, not a security audit. File-limit sampling can affect comparisons."
  );
  return lines.join("\n");
}
