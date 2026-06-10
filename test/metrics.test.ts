import { describe, it, expect } from "vitest";
import {
  computeCodebaseMetrics,
  generateMetricsDocs,
  getApproachabilityGrade,
  formatBytes,
  type CodebaseMetrics,
} from "../src/metrics.js";
import type { FileInfo, ScanResult } from "../src/types.js";

function scan(files: Array<Partial<FileInfo> & { path: string; size: number }>): ScanResult {
  const full: FileInfo[] = files.map((f) => ({
    isDirectory: false,
    ...f,
  })) as FileInfo[];
  return { files: full } as unknown as ScanResult;
}

const SAMPLE = scan([
  { path: "src", size: 0, isDirectory: true },
  { path: "src/index.ts", size: 500 },
  { path: "src/app.ts", size: 2000 },
  { path: "src/utils.ts", size: 1000 },
  { path: "src/big.ts", size: 120 * 1024 },
  { path: "test/app.test.ts", size: 800 },
  { path: "README.md", size: 1500 },
  { path: "docs/guide.md", size: 600 },
  { path: "package.json", size: 400 },
  { path: "package-lock.json", size: 50000 },
]);

describe("computeCodebaseMetrics", () => {
  it("classifies files into source/test/doc/config buckets", () => {
    const m = computeCodebaseMetrics(SAMPLE);
    expect(m.totalFiles).toBe(9); // directory excluded
    expect(m.sourceFiles).toBe(4); // index, app, utils, big
    expect(m.testFiles).toBe(1); // app.test.ts
    expect(m.docFiles).toBe(2); // README.md, guide.md
    expect(m.configFiles).toBe(2); // package.json, package-lock.json
    expect(m.otherFiles).toBe(0);
  });

  it("computes test-to-source ratio and size class", () => {
    const m = computeCodebaseMetrics(SAMPLE);
    expect(m.testToSourceRatio).toBeCloseTo(0.25, 5);
    expect(m.sizeClass).toBe("tiny");
  });

  it("computes byte totals, average and median", () => {
    const m = computeCodebaseMetrics(SAMPLE);
    const total = 500 + 2000 + 1000 + 120 * 1024 + 800 + 1500 + 600 + 400 + 50000;
    expect(m.totalBytes).toBe(total);
    expect(m.averageFileBytes).toBe(Math.round(total / 9));
    expect(m.medianFileBytes).toBe(1000);
  });

  it("builds a language breakdown sorted by size", () => {
    const m = computeCodebaseMetrics(SAMPLE);
    expect(m.languages).toHaveLength(1);
    expect(m.languages[0].language).toBe("TypeScript");
    expect(m.languages[0].files).toBe(5); // includes the test file
    expect(m.languages[0].percentage).toBe(100);
  });

  it("flags largest code files as hotspots and excludes generated files", () => {
    const m = computeCodebaseMetrics(SAMPLE);
    const paths = m.hotspots.map((h) => h.path);
    expect(paths[0]).toBe("src/big.ts"); // largest first
    expect(paths).not.toContain("package-lock.json"); // generated/vendored excluded
    // sorted strictly descending by bytes
    for (let i = 1; i < m.hotspots.length; i++) {
      expect(m.hotspots[i - 1].bytes).toBeGreaterThanOrEqual(m.hotspots[i].bytes);
    }
  });

  it("aggregates top-level directory distribution", () => {
    const m = computeCodebaseMetrics(SAMPLE);
    const src = m.directories.find((d) => d.path === "src");
    expect(src).toBeDefined();
    expect(src?.files).toBe(4);
    const root = m.directories.find((d) => d.path === "(root)");
    expect(root).toBeDefined(); // README.md, package.json, package-lock.json
    expect(root?.files).toBe(3);
  });

  it("derives a deterministic approachability score", () => {
    const m = computeCodebaseMetrics(SAMPLE);
    // tiny(0) - moderate ratio(6) - large avg file(18) - very large file(14) = 62
    expect(m.approachability.score).toBe(62);
    expect(m.approachability.grade).toBe("D");
    expect(m.approachability.factors.length).toBeGreaterThan(0);
  });

  it("penalizes a codebase with no tests", () => {
    const m = computeCodebaseMetrics(
      scan([
        { path: "src/a.ts", size: 1000 },
        { path: "src/b.ts", size: 1200 },
      ])
    );
    expect(m.testFiles).toBe(0);
    expect(m.testToSourceRatio).toBe(0);
    expect(m.approachability.factors.some((f) => /No test files/i.test(f))).toBe(true);
  });

  it("handles an empty scan without throwing", () => {
    const m = computeCodebaseMetrics(scan([]));
    expect(m.totalFiles).toBe(0);
    expect(m.totalBytes).toBe(0);
    expect(m.averageFileBytes).toBe(0);
    expect(m.medianFileBytes).toBe(0);
    expect(m.testToSourceRatio).toBe(0);
    expect(m.sizeClass).toBe("tiny");
    expect(m.languages).toEqual([]);
    expect(m.hotspots).toEqual([]);
    expect(m.approachability.score).toBeGreaterThanOrEqual(0);
    expect(m.approachability.score).toBeLessThanOrEqual(100);
  });

  it("treats Python and Go test naming conventions as tests", () => {
    const m = computeCodebaseMetrics(
      scan([
        { path: "pkg/server.go", size: 1000 },
        { path: "pkg/server_test.go", size: 800 },
        { path: "app/main.py", size: 900 },
        { path: "app/test_main.py", size: 700 },
      ])
    );
    expect(m.sourceFiles).toBe(2);
    expect(m.testFiles).toBe(2);
  });
});

describe("getApproachabilityGrade", () => {
  it("maps scores to letter grades", () => {
    expect(getApproachabilityGrade(95)).toBe("A");
    expect(getApproachabilityGrade(90)).toBe("A");
    expect(getApproachabilityGrade(85)).toBe("B");
    expect(getApproachabilityGrade(80)).toBe("B");
    expect(getApproachabilityGrade(75)).toBe("C");
    expect(getApproachabilityGrade(70)).toBe("C");
    expect(getApproachabilityGrade(65)).toBe("D");
    expect(getApproachabilityGrade(60)).toBe("D");
    expect(getApproachabilityGrade(59)).toBe("F");
    expect(getApproachabilityGrade(0)).toBe("F");
  });
});

describe("formatBytes", () => {
  it("formats bytes, kilobytes and megabytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("generateMetricsDocs", () => {
  it("renders the core sections with the project name", () => {
    const doc = generateMetricsDocs(computeCodebaseMetrics(SAMPLE), "my-project");
    expect(doc).toContain("# Codebase Metrics");
    expect(doc).toContain("my-project");
    expect(doc).toContain("## Approachability");
    expect(doc).toContain("## Overview");
    expect(doc).toContain("## Language Breakdown");
    expect(doc).toContain("## Largest Files (Hotspots)");
    expect(doc).toContain("## Directory Distribution");
    expect(doc).toContain("| Total files | 9 |");
    expect(doc).toContain("TypeScript");
    expect(doc).toContain("`src/big.ts`");
  });

  it("omits optional tables when there is no data", () => {
    const doc = generateMetricsDocs(computeCodebaseMetrics(scan([])), "empty");
    expect(doc).toContain("# Codebase Metrics");
    expect(doc).toContain("## Overview");
    expect(doc).not.toContain("## Language Breakdown");
    expect(doc).not.toContain("## Largest Files (Hotspots)");
  });

  it("includes the deterministic provenance footer", () => {
    const metrics: CodebaseMetrics = computeCodebaseMetrics(SAMPLE);
    const doc = generateMetricsDocs(metrics, "proj");
    expect(doc).toContain("computed deterministically");
  });
});
