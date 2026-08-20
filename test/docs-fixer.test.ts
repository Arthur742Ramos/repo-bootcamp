import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  updateVersionNumbers,
  addMissingFrameworks,
  updateCLIUsage,
  fixDocumentation,
} from "../src/docs-fixer.js";
import type {
  DocsAnalysisResult,
  VersionMismatch,
  FrameworkIssue,
  CLIDrift,
} from "../src/docs-analyzer.js";
import * as fs from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";

describe("docs-fixer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "docs-fixer-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("updateVersionNumbers", () => {
    it("should return no changes when no README exists", async () => {
      const result = await updateVersionNumbers(tempDir, [
        { type: "node", documented: "16", actual: "18" },
      ]);
      expect(result.changes).toHaveLength(0);
      expect(result.success).toBe(false);
    });

    it("should update node version in README", async () => {
      await writeFile(join(tempDir, "README.md"), "Requires Node.js 16\n", "utf-8");
      const result = await updateVersionNumbers(tempDir, [
        { type: "node", documented: "16", actual: "18" },
      ]);
      expect(result.success).toBe(true);
      expect(result.changes.length).toBeGreaterThan(0);
      const content = await readFile(join(tempDir, "README.md"), "utf-8");
      expect(content).toContain("18");
    });

    it("should update python version in README", async () => {
      await writeFile(join(tempDir, "README.md"), "Python 3.8 required\n", "utf-8");
      const result = await updateVersionNumbers(tempDir, [
        { type: "python", documented: "3.8", actual: "3.11" },
      ]);
      expect(result.success).toBe(true);
      const content = await readFile(join(tempDir, "README.md"), "utf-8");
      expect(content).toContain("3.11");
    });

    it("should update npm version in README", async () => {
      await writeFile(join(tempDir, "README.md"), "npm 8 or higher\n", "utf-8");
      const result = await updateVersionNumbers(tempDir, [
        { type: "npm", documented: "8", actual: "10" },
      ]);
      expect(result.success).toBe(true);
    });

    it("should handle no matching patterns gracefully", async () => {
      await writeFile(join(tempDir, "README.md"), "No versions here\n", "utf-8");
      const result = await updateVersionNumbers(tempDir, [
        { type: "node", documented: "16", actual: "18" },
      ]);
      expect(result.changes).toHaveLength(0);
    });

    it("should skip unknown version types", async () => {
      await writeFile(join(tempDir, "README.md"), "Some content\n", "utf-8");
      const result = await updateVersionNumbers(tempDir, [
        { type: "unknown" as any, documented: "1.0", actual: "2.0" },
      ]);
      expect(result.changes).toHaveLength(0);
    });
  });

  describe("addMissingFrameworks", () => {
    it("should return no changes for empty issues", async () => {
      const result = await addMissingFrameworks(tempDir, []);
      expect(result.changes).toHaveLength(0);
    });

    it("should return no changes when no README exists", async () => {
      const issues: FrameworkIssue[] = [{ framework: "react", status: "missing", version: "18.0" }];
      const result = await addMissingFrameworks(tempDir, issues);
      expect(result.changes).toHaveLength(0);
    });

    it("should add Tech Stack section when Installation section exists", async () => {
      await writeFile(
        join(tempDir, "README.md"),
        "# My Project\n\n## Installation\n\nnpm install\n",
        "utf-8"
      );
      const issues: FrameworkIssue[] = [{ framework: "react", status: "missing", version: "18.0" }];
      const result = await addMissingFrameworks(tempDir, issues);
      expect(result.success).toBe(true);
      const content = await readFile(join(tempDir, "README.md"), "utf-8");
      expect(content).toContain("## Tech Stack");
      expect(content).toContain("React");
    });

    it("should append Tech Stack at end if no suitable section", async () => {
      await writeFile(join(tempDir, "README.md"), "# My Project\n\nSome content\n", "utf-8");
      const issues: FrameworkIssue[] = [{ framework: "vue", status: "missing" }];
      const result = await addMissingFrameworks(tempDir, issues);
      expect(result.success).toBe(true);
      const content = await readFile(join(tempDir, "README.md"), "utf-8");
      expect(content).toContain("## Tech Stack");
    });

    it("should add to existing Tech Stack section", async () => {
      await writeFile(
        join(tempDir, "README.md"),
        "# My Project\n\n## Tech Stack\n\n- Node.js\n\n## Other\n\nStuff\n",
        "utf-8"
      );
      const issues: FrameworkIssue[] = [
        { framework: "express", status: "missing", version: "4.18" },
      ];
      const result = await addMissingFrameworks(tempDir, issues);
      expect(result.success).toBe(true);
    });

    it("should skip non-missing framework issues", async () => {
      await writeFile(
        join(tempDir, "README.md"),
        "# My Project\n\n## Installation\n\nnpm install\n",
        "utf-8"
      );
      const issues: FrameworkIssue[] = [
        { framework: "react", status: "outdated", version: "18.0" },
      ];
      const result = await addMissingFrameworks(tempDir, issues);
      expect(result.changes).toHaveLength(0);
    });

    it("should insert before Features section", async () => {
      await writeFile(
        join(tempDir, "README.md"),
        "# My Project\n\n## Features\n\n- Cool stuff\n",
        "utf-8"
      );
      const issues: FrameworkIssue[] = [{ framework: "angular", status: "missing" }];
      const result = await addMissingFrameworks(tempDir, issues);
      expect(result.success).toBe(true);
    });
  });

  describe("updateCLIUsage", () => {
    it("should return no changes for empty drift", async () => {
      const result = await updateCLIUsage(tempDir, []);
      expect(result.changes).toHaveLength(0);
    });

    it("should return no changes when no README exists", async () => {
      const drift: CLIDrift[] = [
        { command: "mycli", type: "missing", actual: "--verbose", documented: "" },
      ];
      const result = await updateCLIUsage(tempDir, drift);
      expect(result.changes).toHaveLength(0);
    });

    it("should return no changes when no Usage section", async () => {
      await writeFile(join(tempDir, "README.md"), "# My Project\n\nNo usage section\n", "utf-8");
      const drift: CLIDrift[] = [
        { command: "mycli", type: "missing", actual: "--verbose", documented: "" },
      ];
      const result = await updateCLIUsage(tempDir, drift);
      expect(result.changes).toHaveLength(0);
    });

    it("should add note about missing options", async () => {
      await writeFile(
        join(tempDir, "README.md"),
        "# My Project\n\n## Usage\n\nmycli run\n\n## Other\n\nStuff\n",
        "utf-8"
      );
      const drift: CLIDrift[] = [
        { command: "mycli", type: "missing", actual: "--verbose", documented: "" },
      ];
      const result = await updateCLIUsage(tempDir, drift);
      expect(result.success).toBe(true);
      const content = await readFile(join(tempDir, "README.md"), "utf-8");
      expect(content).toContain("Additional options available");
    });

    it("should warn about extra documented options", async () => {
      await writeFile(
        join(tempDir, "README.md"),
        "# My Project\n\n## Usage\n\nUse `--old-flag` for stuff\n",
        "utf-8"
      );
      const drift: CLIDrift[] = [
        { command: "mycli", type: "extra", actual: "", documented: "--old-flag" },
      ];
      const result = await updateCLIUsage(tempDir, drift);
      expect(result.success).toBe(true);
      expect(result.changes.some((c) => c.includes("Warning"))).toBe(true);
    });
  });

  describe("fixDocumentation", () => {
    it("should apply all fixes", async () => {
      await writeFile(
        join(tempDir, "README.md"),
        "# My Project\n\nRequires Node.js 16\n\n## Usage\n\nmycli run\n\n## Installation\n\nnpm install\n",
        "utf-8"
      );
      const analysis: DocsAnalysisResult = {
        versionMismatches: [{ type: "node", documented: "16", actual: "18" }],
        frameworkIssues: [{ framework: "react", status: "missing", version: "18" }],
        cliDrift: [{ command: "mycli", type: "missing", actual: "--verbose", documented: "" }],
        score: 50,
        suggestions: [],
      };
      const summary = await fixDocumentation(tempDir, analysis);
      expect(summary.filesModified).toBeGreaterThan(0);
      expect(summary.changesApplied).toBeGreaterThan(0);
    });

    it("should handle no fixes needed", async () => {
      const analysis: DocsAnalysisResult = {
        versionMismatches: [],
        frameworkIssues: [],
        cliDrift: [],
        score: 100,
        suggestions: [],
      };
      const summary = await fixDocumentation(tempDir, analysis);
      expect(summary.filesModified).toBe(0);
      expect(summary.changesApplied).toBe(0);
    });
  });
});
