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
  it("extracts missing field names", () => {
    const errors = [
      "purpose: Required",
      "description: Required",
      "stack.languages: Required",
    ];
    const summary = getMissingFieldsSummary(errors);
    expect(summary).toContain("purpose");
    expect(summary).toContain("description");
  });

  it("handles non-required errors", () => {
    const errors = ["stack.languages: Expected array, got string"];
    const summary = getMissingFieldsSummary(errors);
    expect(summary).toContain("Expected array");
  });

  it("limits error count", () => {
    const errors = Array(10).fill("field: Error message");
    const summary = getMissingFieldsSummary(errors);
    // Should not include all 10
    expect(summary.split(";").length).toBeLessThanOrEqual(3);
  });
});
