import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareScanSnapshots,
  parseScanSnapshot,
  readScanBaseline,
  formatScanComparison,
  MAX_BASELINE_BYTES,
  type ScanSnapshot,
} from "../src/scan-baseline.js";

const metadata = { schemaVersion: 1, analyzerVersion: "2.0.0", maxFiles: 500 };
function snapshot(): ScanSnapshot {
  return {
    metadata: { ...metadata },
    repo: "owner/repo",
    filesScanned: 42,
    scores: {
      health: { score: 70 },
      metrics: { score: 80 },
      security: { score: 90 },
      onboardingRisk: { score: 20 },
    },
    health: {
      checks: [
        { id: "readme", label: "README", status: "pass" },
        { id: "tests", label: "Tests", status: "warn" },
      ],
    },
  };
}
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});
async function fixture(content: string | Buffer): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bootcamp-baseline-"));
  directories.push(directory);
  const path = join(directory, "baseline.json");
  await writeFile(path, content);
  return path;
}

describe("scan baseline validation", () => {
  it("projects only comparison fields without mutating the input", () => {
    const input = { ...snapshot(), unexpected: "ignored" };
    expect(parseScanSnapshot(input, metadata)).toEqual(snapshot());
    expect(input.unexpected).toBe("ignored");
  });
  it.each([null, [], {}, { metadata: null }])("rejects missing metadata: %j", (input) => {
    expect(() => parseScanSnapshot(input, metadata)).toThrow("missing scan metadata");
  });
  it.each([
    { schemaVersion: 2 },
    { analyzerVersion: "2.0.1" },
    { maxFiles: 100 },
    { maxFiles: "500" },
  ])("rejects incompatible metadata: %j", (change) => {
    expect(() =>
      parseScanSnapshot({ ...snapshot(), metadata: { ...metadata, ...change } }, metadata)
    ).toThrow("incompatible");
  });
  it.each([NaN, Infinity, -1, 101, "70", null])("rejects invalid scores: %j", (value) => {
    const input = snapshot();
    expect(() =>
      parseScanSnapshot(
        { ...input, scores: { ...input.scores, health: { score: value } } },
        metadata
      )
    ).toThrow("Invalid baseline score");
  });
  it.each([-1, 1.5, null, "42"])("rejects invalid counts: %j", (filesScanned) => {
    expect(() => parseScanSnapshot({ ...snapshot(), filesScanned }, metadata)).toThrow(
      "Invalid baseline scan report"
    );
  });
  it("rejects duplicated or unknown readiness statuses", () => {
    const input = snapshot();
    input.health.checks.push(input.health.checks[0]);
    expect(() => parseScanSnapshot(input, metadata)).toThrow("duplicate");
    expect(() =>
      parseScanSnapshot(
        { ...snapshot(), health: { checks: [{ id: "x", label: "X", status: "ok" }] } },
        metadata
      )
    ).toThrow("Invalid");
  });
  it("reads UTF-8 JSON including a BOM", async () => {
    expect(
      await readScanBaseline(await fixture("\uFEFF" + JSON.stringify(snapshot())), metadata)
    ).toEqual(snapshot());
  });
  it("rejects invalid UTF-8 even inside an otherwise valid JSON string", async () => {
    const bytes = Buffer.from(JSON.stringify(snapshot()));
    bytes[bytes.indexOf("owner")] = 0xff;
    await expect(readScanBaseline(await fixture(bytes), metadata)).rejects.toThrow(
      "not valid JSON"
    );
  });
  it("rejects malformed and oversized JSON", async () => {
    await expect(readScanBaseline(await fixture("{"), metadata)).rejects.toThrow("not valid JSON");
    await expect(
      readScanBaseline(await fixture(Buffer.alloc(MAX_BASELINE_BYTES + 1, 32)), metadata)
    ).rejects.toThrow("8 MiB");
  });
  it.skipIf(process.platform === "win32")(
    "rejects FIFOs without waiting for a writer",
    async () => {
      const path = await fixture("{}");
      const fifo = path + ".fifo";
      execFileSync("mkfifo", [fifo]);
      await expect(readScanBaseline(fifo, metadata)).rejects.toThrow("regular JSON file");
    }
  );
  it("rejects directories and reports missing files", async () => {
    const path = await fixture("{}");
    await expect(readScanBaseline(path + ".missing", metadata)).rejects.toThrow();
    await mkdir(path + ".directory");
    await expect(readScanBaseline(path + ".directory", metadata)).rejects.toThrow();
  });
});

describe("direction-aware scan comparisons", () => {
  it.each(["health", "metrics", "security", "onboardingRisk"] as const)(
    "gates %s independently in its proper direction",
    (measure) => {
      const current = snapshot();
      current.scores[measure].score += measure === "onboardingRisk" ? 1 : -1;
      const result = compareScanSnapshots(snapshot(), current);
      expect(result.regressed).toBe(true);
      expect(
        result.scores.filter((item) => item.exceedsTolerance).map((item) => item.measure)
      ).toEqual([measure]);
      expect(compareScanSnapshots(snapshot(), current, 1).regressed).toBe(false);
    }
  );
  it("reports unchanged scores and stable JSON data", () => {
    const result = compareScanSnapshots(snapshot(), snapshot());
    expect(result.regressed).toBe(false);
    expect(result.healthChanges).toEqual([]);
    expect(result.scores.map((item) => item.delta)).toEqual([0, 0, 0, 0]);
    expect(formatScanComparison(result)).toContain("No readiness check statuses changed");
  });
  it("gates higher-is-better declines and lower-is-better increases", () => {
    const current = snapshot();
    current.scores.health.score = 65;
    current.scores.metrics.score = 85;
    current.scores.security.score = 89;
    current.scores.onboardingRisk.score = 25;
    const result = compareScanSnapshots(snapshot(), current, 4);
    expect(result.scores.map((item) => item.regression)).toEqual([5, 0, 1, 5]);
    expect(result.scores.map((item) => item.exceedsTolerance)).toEqual([true, false, false, true]);
    expect(result.regressed).toBe(true);
    expect(compareScanSnapshots(snapshot(), current, 5).regressed).toBe(false);
  });
  it("does not gate improvements or warn-to-pass changes", () => {
    const current = snapshot();
    current.scores.onboardingRisk.score = 0;
    current.health.checks[1].status = "pass";
    const result = compareScanSnapshots(snapshot(), current);
    expect(result.regressed).toBe(false);
    expect(result.healthChanges).toEqual([
      { id: "tests", label: "Tests", before: "warn", after: "pass" },
    ]);
  });
  it("reports status deterioration even without a numeric score change", () => {
    const current = snapshot();
    current.health.checks[0].status = "fail";
    const result = compareScanSnapshots(snapshot(), current);
    expect(result.healthChanges[0]).toEqual({
      id: "readme",
      label: "README",
      before: "pass",
      after: "fail",
    });
    expect(result.regressed).toBe(false);
  });
  it("matches checks by id, not order", () => {
    const current = snapshot();
    current.health.checks.reverse();
    expect(compareScanSnapshots(snapshot(), current).healthChanges).toEqual([]);
  });
  it("refuses different check catalogs rather than inventing changes", () => {
    const current = snapshot();
    current.health.checks.pop();
    expect(() => compareScanSnapshots(snapshot(), current)).toThrow("health checks differ");
  });
  it.each([-1, 101, NaN, Infinity])("rejects invalid tolerances: %j", (tolerance) => {
    expect(() => compareScanSnapshots(snapshot(), snapshot(), tolerance)).toThrow(
      "--max-regression"
    );
  });
  it("neutralizes terminal control characters in untrusted baseline metadata", () => {
    const base = snapshot();
    base.repo = "repo\u001b[2J\nFAKE";
    const current = snapshot();
    current.health.checks[0] = {
      ...current.health.checks[0],
      label: "README\u001b[2J",
      status: "fail",
    };
    const text = formatScanComparison(compareScanSnapshots(base, current));
    expect(text).not.toContain("\u001b");
    expect(text).toContain("repo [2J FAKE");
  });
});
