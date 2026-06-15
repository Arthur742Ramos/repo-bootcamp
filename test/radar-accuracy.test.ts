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
});
