import { describe, it, expect } from "vitest";

import { generateTechRadar } from "../src/radar.js";
import type { DependencyAnalysis } from "../src/deps.js";
import type { FileInfo, StackInfo } from "../src/types.js";

function stack(over: Partial<StackInfo> = {}): StackInfo {
  return {
    languages: [],
    frameworks: [],
    buildSystem: "npm",
    packageManager: "npm",
    hasDocker: false,
    hasCi: true,
    ...over,
  } as StackInfo;
}

function deps(
  runtime: Array<{ name: string; version: string }> = [],
  dev: Array<{ name: string; version: string }> = []
): DependencyAnalysis {
  return {
    packageManager: "npm",
    totalCount: runtime.length + dev.length,
    runtime: runtime.map((d) => ({ ...d, type: "runtime" as const })),
    dev: dev.map((d) => ({ ...d, type: "dev" as const })),
    peer: [],
    categories: [],
  };
}

describe("radar accuracy", () => {
  it("matches scoped packages (@remix-run/react, @trpc/server) as modern", () => {
    const radar = generateTechRadar(
      stack({ languages: ["TypeScript"] }),
      [],
      deps([
        { name: "@remix-run/react", version: "^2" },
        { name: "@trpc/server", version: "^11" },
      ]),
      null,
      true,
      true
    );
    const modernNames = radar.modern.map((s) => s.name);
    expect(modernNames).toContain("@remix-run/react");
    expect(modernNames).toContain("@trpc/server");
  });

  it("lists TypeScript in exactly one ring (no modern/stable duplicate)", () => {
    const radar = generateTechRadar(
      stack({ languages: ["TypeScript"] }),
      [],
      deps([], [{ name: "typescript", version: "^5" }]),
      null,
      true,
      true
    );
    const tsCount = [...radar.modern, ...radar.stable, ...radar.legacy, ...radar.risky].filter(
      (s) => s.name.toLowerCase() === "typescript"
    ).length;
    expect(tsCount).toBe(1);
  });

  it("detects tests in tests/ (plural) and Go/Python conventions, but not latest/", () => {
    const factors = (files: FileInfo[]): string =>
      generateTechRadar(stack(), files, null, null, true, true).onboardingRisk.factors.join(" ");

    expect(factors([{ path: "tests/test_app.py", size: 1, isDirectory: false }])).not.toContain(
      "No test files detected"
    );
    expect(factors([{ path: "internal/foo_test.go", size: 1, isDirectory: false }])).not.toContain(
      "No test files detected"
    );
    expect(factors([{ path: "docs/latest/index.md", size: 1, isDirectory: false }])).toContain(
      "No test files detected"
    );
  });

  it.each([
    "ts",
    "js",
    "tsx",
    "jsx",
    "mts",
    "cts",
    "mjs",
    "cjs",
    "py",
    "go",
    "rs",
    "d.ts",
    "d.mts",
    "d.cts",
  ])("counts .%s files at the existing large-codebase boundary", (extension) => {
    const files: FileInfo[] = Array.from({ length: 500 }, (_, i) => ({
      path: `src/module${i}.${extension}`,
      size: 1,
      isDirectory: false,
    }));
    // A test path provides the independent test-presence signal without
    // being one of the extensions counted as source for this risk factor.
    files.push({ path: "tests/smoke.txt", size: 1, isDirectory: false });
    const risk = () => generateTechRadar(stack(), files, null, null, true, true).onboardingRisk;

    expect(risk()).toEqual({ score: 0, grade: "A", factors: [] });
    files.push({ path: `src/extra.${extension}`, size: 1, isDirectory: false });
    expect(risk()).toEqual({
      score: 10,
      grade: "A",
      factors: ["Large codebase (501 source files)"],
    });
  });

  it("keeps non-source extensions and node_modules out of the source-size factor", () => {
    const files: FileInfo[] = Array.from({ length: 501 }, (_, i) => ({
      path: `src/module${i}.${["md", "mtss", "ctsx", "mjsx", "cjsx"][i % 5]}`,
      size: 1,
      isDirectory: false,
    }));
    for (const extension of ["ts", "js", "mts", "cts", "mjs", "cjs"]) {
      files.push({ path: `node_modules/pkg/index.${extension}`, size: 1, isDirectory: false });
    }
    files.push({ path: "tests/smoke.txt", size: 1, isDirectory: false });

    expect(generateTechRadar(stack(), files, null, null, true, true).onboardingRisk).toEqual({
      score: 0,
      grade: "A",
      factors: [],
    });
  });
});
