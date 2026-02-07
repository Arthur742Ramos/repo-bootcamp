/**
 * Runtime smoke tests for types with meaningful behavior.
 * Compile-only type checks (assign-and-read-back) are left to tsc.
 */

import { describe, it, expect } from "vitest";
import type {
  StackInfo,
  ScanResult,
  RepoFacts,
} from "../src/types.js";

describe("types", () => {
  it("ScanResult keySourceFiles is a real Map", () => {
    const scan: ScanResult = {
      files: [{ path: "src/index.ts", size: 100, isDirectory: false }],
      stack: {
        languages: ["TypeScript"],
        frameworks: [],
        buildSystem: "npm",
        packageManager: "npm",
        hasDocker: false,
        hasCi: false,
      },
      commands: [],
      ciWorkflows: [],
      readme: "# Hello",
      contributing: null,
      keySourceFiles: new Map([["src/index.ts", "console.log('hello')"]]),
    };

    expect(scan.keySourceFiles).toBeInstanceOf(Map);
    expect(scan.keySourceFiles.get("src/index.ts")).toBeDefined();
    expect(scan.contributing).toBeNull();
  });

  it("RepoFacts optional fields are absent when omitted", () => {
    const facts: RepoFacts = {
      repoName: "test/repo",
      purpose: "A test repo",
      description: "For testing",
      stack: {
        languages: [],
        frameworks: [],
        buildSystem: "",
        packageManager: null,
        hasDocker: false,
        hasCi: false,
      },
      quickstart: { prerequisites: [], steps: [], commands: [] },
      structure: {
        keyDirs: [],
        entrypoints: [],
        testDirs: [],
        docsDirs: [],
      },
      ci: { workflows: [], mainChecks: [] },
      contrib: { howToAddFeature: [], howToAddTest: [] },
      architecture: { overview: "", components: [] },
      firstTasks: [],
    };

    expect(facts.runbook).toBeUndefined();
    expect(facts.confidence).toBeUndefined();
    expect(facts.sources).toBeUndefined();
  });

  it("StackInfo packageManager can be null", () => {
    const stack: StackInfo = {
      languages: ["Rust"],
      frameworks: [],
      buildSystem: "cargo",
      packageManager: null,
      hasDocker: false,
      hasCi: false,
    };

    expect(stack.packageManager).toBeNull();
  });
});
