/**
 * Tests for JSON schema validation
 */

import { describe, it, expect } from "vitest";
import { validateRepoFacts, getMissingFieldsSummary } from "../src/schema.js";

describe("validateRepoFacts", () => {
  const minimalValidFacts = {
    repoName: "owner/repo",
    purpose: "A test repo",
    description: "This is a test repository for testing",
    stack: {
      languages: ["TypeScript"],
      frameworks: [],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: true,
    },
    quickstart: {
      prerequisites: ["Node.js"],
      steps: ["npm install"],
      commands: [{ name: "install", command: "npm install", source: "package.json" }],
    },
    structure: {
      keyDirs: [{ path: "src/", purpose: "Source code" }],
      entrypoints: [{ path: "src/index.ts", type: "library" as const }],
      testDirs: ["test/"],
      docsDirs: [],
    },
    ci: {
      workflows: [],
      mainChecks: ["test"],
    },
    contrib: {
      howToAddFeature: ["Add code"],
      howToAddTest: ["Add test"],
    },
    architecture: {
      overview: "Simple architecture",
      components: [{ name: "Core", description: "Main logic", directory: "src/" }],
    },
    firstTasks: [
      {
        title: "Fix a typo",
        description: "Find and fix typos in README",
        difficulty: "beginner" as const,
        category: "docs" as const,
        files: ["README.md"],
        why: "Easy first contribution",
      },
    ],
  };

  it("validates minimal valid facts", () => {
    const result = validateRepoFacts(minimalValidFacts);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.repoName).toBe("owner/repo");
  });

  it("fails on missing required fields", () => {
    const invalid = { repoName: "test" }; // missing most fields
    const result = validateRepoFacts(invalid);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("provides defaults for optional arrays", () => {
    const withDefaults = {
      ...minimalValidFacts,
      stack: {
        ...minimalValidFacts.stack,
        frameworks: undefined, // should default to []
      },
    };
    const result = validateRepoFacts(withDefaults);
    expect(result.success).toBe(true);
    expect(result.data?.stack.frameworks).toEqual([]);
  });

  it("validates confidence levels", () => {
    const withConfidence = {
      ...minimalValidFacts,
      confidence: "high" as const,
    };
    const result = validateRepoFacts(withConfidence);
    expect(result.success).toBe(true);
    expect(result.data?.confidence).toBe("high");
  });

  it("rejects invalid confidence level", () => {
    const invalidConfidence = {
      ...minimalValidFacts,
      confidence: "very-high", // invalid
    };
    const result = validateRepoFacts(invalidConfidence);
    expect(result.success).toBe(false);
  });

  it("warns about low task count", () => {
    const result = validateRepoFacts(minimalValidFacts);
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings?.some(w => w.includes("first tasks"))).toBe(true);
  });

  it("validates entrypoint types", () => {
    const validTypes = ["main", "binary", "server", "cli", "web", "library"];
    for (const type of validTypes) {
      const facts = {
        ...minimalValidFacts,
        structure: {
          ...minimalValidFacts.structure,
          entrypoints: [{ path: "index.ts", type: type as any }],
        },
      };
      const result = validateRepoFacts(facts);
      expect(result.success).toBe(true);
    }
  });

  it("validates task difficulty levels", () => {
    const validDifficulties = ["beginner", "intermediate", "advanced"];
    for (const difficulty of validDifficulties) {
      const facts = {
        ...minimalValidFacts,
        firstTasks: [
          {
            ...minimalValidFacts.firstTasks[0],
            difficulty: difficulty as any,
          },
        ],
      };
      const result = validateRepoFacts(facts);
      expect(result.success).toBe(true);
    }
  });
});

describe("getMissingFieldsSummary", () => {
  it("summarises real validator output for missing fields (integration)", () => {
    // Feed the ACTUAL zod-v4 errors (not hand-written strings) through the
    // summary so this pins real production behaviour. Under zod 4.x the
    // missing-field message is "expected <type>, received undefined", which the
    // pre-fix filter (`includes("Required")`) never matched — so this asserts
    // the clean "Missing required fields:" format rather than merely that field
    // names appear (the slice fallback already contains those).
    const result = validateRepoFacts({ repoName: "only-name" });
    expect(result.success).toBe(false);
    const summary = getMissingFieldsSummary(result.errors!);
    expect(summary.startsWith("Missing required fields:")).toBe(true);
    expect(summary).toContain("purpose");
    expect(summary).toContain("description");
    // Must NOT fall through to the raw slice(0,3) fallback of formatted errors.
    expect(summary).not.toContain("Invalid input");
  });

  it("recognises the zod v4 'received undefined' phrasing", () => {
    const errors = [
      "purpose: Invalid input: expected string, received undefined",
      "stack: Invalid input: expected object, received undefined",
    ];
    const summary = getMissingFieldsSummary(errors);
    expect(summary).toBe("Missing required fields: purpose, stack");
  });

  it("still recognises the legacy 'Required' phrasing", () => {
    const errors = ["purpose: Required", "description: Required"];
    const summary = getMissingFieldsSummary(errors);
    expect(summary).toBe("Missing required fields: purpose, description");
  });

  it("falls back to the first few errors for non-missing-field problems", () => {
    const errors = ["stack.languages: Expected array, got string"];
    const summary = getMissingFieldsSummary(errors);
    expect(summary).toContain("Expected array");
  });

  it("limits the fallback error count", () => {
    const errors = Array(10).fill("field: some other problem");
    const summary = getMissingFieldsSummary(errors);
    // Should not include all 10
    expect(summary.split(";").length).toBeLessThanOrEqual(3);
  });
});

import { validateRepoFacts as validateExtra } from "../src/schema.js";

describe("validateRepoFacts additional branches", () => {
  it("warns on few key dirs", () => {
    // This needs a full valid object with only 1 keyDir
    const data = {
      repoName: "test/repo",
      purpose: "Test",
      description: "Test repo",
      confidence: "high",
      sources: ["README"],
      stack: { languages: ["TS"], frameworks: [], buildSystem: "npm", packageManager: "npm", hasDocker: false, hasCi: false },
      quickstart: { prerequisites: ["Node"], steps: ["npm i"], commands: [{ name: "i", command: "npm i", source: "pkg" }], commonErrors: [], sources: ["R"] },
      structure: { keyDirs: [{ path: "src/", purpose: "Source", keyFiles: ["a.ts"] }], entrypoints: [{ path: "a", type: "main", description: "d" }], testDirs: ["t/"], docsDirs: [], sources: ["s"] },
      ci: { workflows: [], mainChecks: [], sources: [] },
      contrib: { howToAddFeature: ["PR"], howToAddTest: ["test"], codeStyle: "TS", sources: ["R"] },
      architecture: {
        overview: "Simple",
        components: [{ name: "A", description: "a", directory: "src/" }],
        dataFlow: "a->b",
        keyAbstractions: [{ name: "a", description: "d" }],
        codeExamples: [{ title: "t", file: "f", code: "c", explanation: "e" }],
        sources: ["s"],
      },
      firstTasks: [
        { title: "T1", description: "D1", difficulty: "beginner", category: "test", files: ["a"], why: "w" },
        { title: "T2", description: "D2", difficulty: "beginner", category: "test", files: ["b"], why: "w" },
        { title: "T3", description: "D3", difficulty: "beginner", category: "test", files: ["c"], why: "w" },
        { title: "T4", description: "D4", difficulty: "beginner", category: "test", files: ["d"], why: "w" },
        { title: "T5", description: "D5", difficulty: "beginner", category: "test", files: ["e"], why: "w" },
        { title: "T6", description: "D6", difficulty: "beginner", category: "test", files: ["f"], why: "w" },
        { title: "T7", description: "D7", difficulty: "beginner", category: "test", files: ["g"], why: "w" },
        { title: "T8", description: "D8", difficulty: "beginner", category: "test", files: ["h"], why: "w" },
      ],
      runbook: { applicable: false, deploySteps: [], observability: [], incidents: [], sources: [] },
    };
    const result = validateExtra(data);
    expect(result.success).toBe(true);
    expect(result.warnings).toContain("Few key directories documented");
    expect(result.warnings).toContain("Few architecture components documented");
  });

  it("warns on no commands", () => {
    const data = {
      repoName: "test/repo",
      purpose: "Test",
      description: "Test repo",
      confidence: "high",
      sources: ["README"],
      stack: { languages: ["TS"], frameworks: [], buildSystem: "npm", packageManager: "npm", hasDocker: false, hasCi: false },
      quickstart: { prerequisites: ["Node"], steps: ["npm i"], commands: [], commonErrors: [], sources: ["R"] },
      structure: { keyDirs: [{ path: "src/", purpose: "S", keyFiles: ["a"] }, { path: "test/", purpose: "T", keyFiles: ["b"] }], entrypoints: [{ path: "a", type: "main", description: "d" }], testDirs: ["t/"], docsDirs: [], sources: ["s"] },
      ci: { workflows: [], mainChecks: [], sources: [] },
      contrib: { howToAddFeature: ["PR"], howToAddTest: ["test"], codeStyle: "TS", sources: ["R"] },
      architecture: {
        overview: "Simple",
        components: [{ name: "A", description: "a", directory: "src/" }, { name: "B", description: "b", directory: "test/" }],
        dataFlow: "a->b",
        keyAbstractions: [{ name: "a", description: "d" }],
        codeExamples: [{ title: "t", file: "f", code: "c", explanation: "e" }],
        sources: ["s"],
      },
      firstTasks: Array.from({ length: 8 }, (_, i) => ({ title: `T${i}`, description: "D", difficulty: "beginner", category: "test", files: ["f"], why: "w" })),
      runbook: { applicable: false, deploySteps: [], observability: [], incidents: [], sources: [] },
    };
    const result = validateExtra(data);
    expect(result.success).toBe(true);
    expect(result.warnings).toContain("No commands documented");
  });
});
