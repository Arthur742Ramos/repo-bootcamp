import { describe, it, expect } from "vitest";
import { generateDiffDocs } from "../src/diff.js";
import type { DiffSummary } from "../src/types.js";

describe("Diff/Compare Mode", () => {
  describe("generateDiffDocs", () => {
    const mockDiff: DiffSummary = {
      baseRef: "v1.0.0",
      headRef: "HEAD",
      filesChanged: 15,
      filesAdded: ["src/newFeature.ts", "src/utils/helper.ts"],
      filesRemoved: ["src/deprecated.ts"],
      filesModified: ["src/index.ts", "src/app.ts", "package.json"],
      onboardingDeltas: {
        newDependencies: ["express", "zod"],
        removedDependencies: ["moment"],
        newEnvVars: ["API_KEY", "DATABASE_URL"],
        newCommands: ["npm run migrate"],
        breakingChanges: ["Major version bump: 1.0.0 → 2.0.0"],
      },
    };

    it("should generate valid markdown", () => {
      const docs = generateDiffDocs(mockDiff, "test-repo");

      expect(docs).toContain("# Change Summary");
      expect(docs).toContain("test-repo");
      expect(docs).toContain("`v1.0.0`");
      expect(docs).toContain("`HEAD`");
    });

    it("should include overview statistics", () => {
      const docs = generateDiffDocs(mockDiff, "test-repo");

      expect(docs).toContain("## Overview");
      expect(docs).toContain("Files Changed");
      expect(docs).toContain("15");
      expect(docs).toContain("Files Added");
      expect(docs).toContain("2");
    });

    it("should show onboarding impact section", () => {
      const docs = generateDiffDocs(mockDiff, "test-repo");

      expect(docs).toContain("## Onboarding Impact");
    });

    it("should show new dependencies", () => {
      const docs = generateDiffDocs(mockDiff, "test-repo");

      expect(docs).toContain("### New Dependencies");
      expect(docs).toContain("`express`");
      expect(docs).toContain("`zod`");
    });

    it("should show removed dependencies", () => {
      const docs = generateDiffDocs(mockDiff, "test-repo");

      expect(docs).toContain("### Removed Dependencies");
      expect(docs).toContain("`moment`");
    });

    it("should show new environment variables", () => {
      const docs = generateDiffDocs(mockDiff, "test-repo");

      expect(docs).toContain("### New Environment Variables");
      expect(docs).toContain("`API_KEY`");
      expect(docs).toContain("`DATABASE_URL`");
    });

    it("should show new commands", () => {
      const docs = generateDiffDocs(mockDiff, "test-repo");

      expect(docs).toContain("### New Commands");
      expect(docs).toContain("`npm run migrate`");
    });

    it("should show breaking changes with warning", () => {
      const docs = generateDiffDocs(mockDiff, "test-repo");

      expect(docs).toContain("### ⚠️ Breaking Changes");
      expect(docs).toContain("Major version bump");
    });

    it("should show added files", () => {
      const docs = generateDiffDocs(mockDiff, "test-repo");

      expect(docs).toContain("## Files Added");
      expect(docs).toContain("`src/newFeature.ts`");
    });

    it("should show removed files", () => {
      const docs = generateDiffDocs(mockDiff, "test-repo");

      expect(docs).toContain("## Files Removed");
      expect(docs).toContain("`src/deprecated.ts`");
    });

    it("should show modified files", () => {
      const docs = generateDiffDocs(mockDiff, "test-repo");

      expect(docs).toContain("## Files Modified");
      expect(docs).toContain("`src/index.ts`");
    });

    it("should handle empty onboarding deltas", () => {
      const emptyDiff: DiffSummary = {
        baseRef: "v1.0.0",
        headRef: "v1.0.1",
        filesChanged: 2,
        filesAdded: [],
        filesRemoved: [],
        filesModified: ["src/index.ts"],
        onboardingDeltas: {
          newDependencies: [],
          removedDependencies: [],
          newEnvVars: [],
          newCommands: [],
          breakingChanges: [],
        },
      };

      const docs = generateDiffDocs(emptyDiff, "test-repo");

      expect(docs).toContain("No significant onboarding changes detected");
    });

    it("should truncate long file lists", () => {
      const manyFilesDiff: DiffSummary = {
        ...mockDiff,
        filesAdded: Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`),
      };

      const docs = generateDiffDocs(manyFilesDiff, "test-repo");

      expect(docs).toContain("... and 20 more");
    });
  });
});
