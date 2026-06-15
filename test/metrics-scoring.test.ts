import { describe, it, expect } from "vitest";

import { computeCodebaseMetrics } from "../src/metrics.js";
import type { FileInfo, ScanResult } from "../src/types.js";

function scan(files: Array<{ path: string; size: number; isDirectory?: boolean }>): ScanResult {
  const full: FileInfo[] = files.map((f) => ({ isDirectory: false, ...f })) as FileInfo[];
  return { files: full } as unknown as ScanResult;
}

describe("metrics approachability scoring", () => {
  it("does not report a sparsely-tested large repo as having no tests", () => {
    const files = Array.from({ length: 250 }, (_, i) => ({ path: `src/f${i}.ts`, size: 100 }));
    files.push({ path: "src/app.test.ts", size: 100 });
    const m = computeCodebaseMetrics(scan(files));

    expect(m.testFiles).toBe(1);
    expect(m.sourceFiles).toBe(250);
    const factors = m.approachability.factors.join(" ");
    expect(factors).not.toContain("No test files detected");
    expect(factors).toContain("Low test-to-source ratio");
  });

  it("does not give a large unrecognized-language repo a perfect 100/A score", () => {
    const files = Array.from({ length: 300 }, (_, i) => ({ path: `infra/mod${i}.tf`, size: 500 }));
    const m = computeCodebaseMetrics(scan(files));

    expect(m.sourceFiles).toBe(0);
    expect(m.approachability.score).toBeLessThan(100);
    expect(m.approachability.grade).not.toBe("A");
    expect(m.approachability.factors.join(" ")).toContain("no recognized source language");
  });

  it("excludes generated/vendored files (e.g. *.min.js) from source counts and language bytes", () => {
    const m = computeCodebaseMetrics(
      scan([
        { path: "src/a.ts", size: 1000 },
        { path: "src/b.ts", size: 1000 },
        { path: "public/vendor.min.js", size: 800_000 },
      ])
    );

    expect(m.sourceFiles).toBe(2);
    expect(m.languages.some((l) => l.language === "JavaScript")).toBe(false);
    expect(m.otherFiles).toBeGreaterThanOrEqual(1);
    // Source bytes and the approachability size penalty are over the two real
    // source files, not inflated by the 800 KB vendored bundle.
    expect(m.sourceBytes).toBe(2000);
    expect(m.approachability.factors.join(" ")).not.toContain("Large average file size");
  });
});
