import { describe, it, expect } from "vitest";
import { generateDiffDocs, parsePullRequestTarget } from "../src/diff.js";
import type { DiffSummary } from "../src/types.js";

describe("generateDiffDocs - extended coverage", () => {
  const baseDiff: DiffSummary = {
    baseRef: "v1.0.0",
    headRef: "v2.0.0",
    filesChanged: 5,
    filesAdded: [],
    filesModified: [],
    filesRemoved: [],
    onboardingDeltas: {
      newDependencies: [],
      removedDependencies: [],
      newEnvVars: [],
      newCommands: [],
      breakingChanges: [],
    },
  };

  it("should include PR info with title and url", () => {
    const diff: DiffSummary = {
      ...baseDiff,
      prNumber: 42,
      prTitle: "Add feature X",
      prUrl: "https://github.com/owner/repo/pull/42",
    };
    const docs = generateDiffDocs(diff, "my-project");
    expect(docs).toContain("[PR #42]");
    expect(docs).toContain("Add feature X");
  });

  it("should include PR number without url", () => {
    const diff: DiffSummary = {
      ...baseDiff,
      prNumber: 99,
    };
    const docs = generateDiffDocs(diff, "my-project");
    expect(docs).toContain("PR #99");
    expect(docs).not.toContain("[PR #99]");
  });

  it("should include PR number with url but no title", () => {
    const diff: DiffSummary = {
      ...baseDiff,
      prNumber: 55,
      prUrl: "https://github.com/owner/repo/pull/55",
    };
    const docs = generateDiffDocs(diff, "my-project");
    expect(docs).toContain("[PR #55]");
  });

  it("should show new dependencies", () => {
    const diff: DiffSummary = {
      ...baseDiff,
      onboardingDeltas: {
        ...baseDiff.onboardingDeltas,
        newDependencies: ["lodash", "axios"],
      },
    };
    const docs = generateDiffDocs(diff, "test");
    expect(docs).toContain("### New Dependencies");
    expect(docs).toContain("`lodash`");
    expect(docs).toContain("`axios`");
  });

  it("should show removed dependencies", () => {
    const diff: DiffSummary = {
      ...baseDiff,
      onboardingDeltas: {
        ...baseDiff.onboardingDeltas,
        removedDependencies: ["moment"],
      },
    };
    const docs = generateDiffDocs(diff, "test");
    expect(docs).toContain("### Removed Dependencies");
    expect(docs).toContain("`moment`");
  });

  it("should show new env vars", () => {
    const diff: DiffSummary = {
      ...baseDiff,
      onboardingDeltas: {
        ...baseDiff.onboardingDeltas,
        newEnvVars: ["API_KEY", "DB_URL"],
      },
    };
    const docs = generateDiffDocs(diff, "test");
    expect(docs).toContain("### New Environment Variables");
    expect(docs).toContain("`API_KEY`");
  });

  it("should show new commands", () => {
    const diff: DiffSummary = {
      ...baseDiff,
      onboardingDeltas: {
        ...baseDiff.onboardingDeltas,
        newCommands: ["npm run migrate"],
      },
    };
    const docs = generateDiffDocs(diff, "test");
    expect(docs).toContain("### New Commands");
  });

  it("should show breaking changes", () => {
    const diff: DiffSummary = {
      ...baseDiff,
      onboardingDeltas: {
        ...baseDiff.onboardingDeltas,
        breakingChanges: ["Removed deprecated API endpoint"],
      },
    };
    const docs = generateDiffDocs(diff, "test");
    expect(docs).toContain("### ⚠️ Breaking Changes");
  });

  it("should show no impact message when no deltas", () => {
    const docs = generateDiffDocs(baseDiff, "test");
    expect(docs).toContain("No significant onboarding changes detected");
  });

  it("should list added files", () => {
    const diff: DiffSummary = {
      ...baseDiff,
      filesAdded: ["src/new.ts", "src/other.ts"],
    };
    const docs = generateDiffDocs(diff, "test");
    expect(docs).toContain("## Files Added");
    expect(docs).toContain("`src/new.ts`");
  });

  it("should list removed files", () => {
    const diff: DiffSummary = {
      ...baseDiff,
      filesRemoved: ["src/old.ts"],
    };
    const docs = generateDiffDocs(diff, "test");
    expect(docs).toContain("## Files Removed");
  });

  it("should truncate long file lists", () => {
    const manyFiles = Array.from({ length: 35 }, (_, i) => `src/file${i}.ts`);
    const diff: DiffSummary = {
      ...baseDiff,
      filesAdded: manyFiles,
    };
    const docs = generateDiffDocs(diff, "test");
    expect(docs).toContain("... and 5 more");
  });

  it("should truncate long modified file lists", () => {
    const manyFiles = Array.from({ length: 55 }, (_, i) => `src/mod${i}.ts`);
    const diff: DiffSummary = {
      ...baseDiff,
      filesModified: manyFiles,
    };
    const docs = generateDiffDocs(diff, "test");
    expect(docs).toContain("## Files Modified");
    expect(docs).toContain("... and 5 more");
  });
});

describe("parsePullRequestTarget - additional", () => {
  it("should parse repo.git#number format", () => {
    const result = parsePullRequestTarget("owner/repo.git#5");
    expect(result.prNumber).toBe(5);
  });
});
