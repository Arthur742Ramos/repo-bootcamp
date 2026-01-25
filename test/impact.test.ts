import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getKeyFilesForImpact, generateImpactDocs } from "../src/impact.js";
import type { FileInfo, ChangeImpact } from "../src/types.js";

describe("Change Impact Map", () => {
  const mockFiles: FileInfo[] = [
    { path: "src/index.ts", size: 1000, isDirectory: false },
    { path: "src/utils.ts", size: 500, isDirectory: false },
    { path: "src/app.ts", size: 800, isDirectory: false },
    { path: "src/server.ts", size: 600, isDirectory: false },
    { path: "src/cli.ts", size: 400, isDirectory: false },
    { path: "src/components/Button.tsx", size: 300, isDirectory: false },
    { path: "lib/helper.ts", size: 200, isDirectory: false },
    { path: "test/app.test.ts", size: 500, isDirectory: false },
    { path: "docs/README.md", size: 1000, isDirectory: false },
  ];

  describe("getKeyFilesForImpact", () => {
    it("should identify key entry points", () => {
      const keyFiles = getKeyFilesForImpact(mockFiles);

      expect(keyFiles).toContain("src/index.ts");
      expect(keyFiles.length).toBeGreaterThan(0);
    });

    it("should find common entry point patterns", () => {
      const keyFiles = getKeyFilesForImpact(mockFiles);

      // Should include various entry points
      const entryPoints = ["src/index.ts", "src/app.ts", "src/server.ts", "src/cli.ts"];
      const found = entryPoints.filter(ep => keyFiles.includes(ep));
      expect(found.length).toBeGreaterThan(0);
    });

    it("should limit to 10 files", () => {
      const manyFiles: FileInfo[] = [];
      for (let i = 0; i < 20; i++) {
        manyFiles.push({ path: `src/file${i}.ts`, size: 100, isDirectory: false });
      }

      const keyFiles = getKeyFilesForImpact(manyFiles);
      expect(keyFiles.length).toBeLessThanOrEqual(10);
    });

    it("should skip directories", () => {
      const filesWithDirs: FileInfo[] = [
        { path: "src", size: 0, isDirectory: true },
        { path: "src/index.ts", size: 1000, isDirectory: false },
      ];

      const keyFiles = getKeyFilesForImpact(filesWithDirs);
      expect(keyFiles).not.toContain("src");
    });
  });

  describe("generateImpactDocs", () => {
    const mockImpacts: ChangeImpact[] = [
      {
        file: "src/index.ts",
        affectedFiles: ["src/app.ts", "src/server.ts"],
        affectedTests: ["test/index.test.ts"],
        affectedDocs: ["docs/README.md"],
        importedBy: ["src/app.ts"],
        imports: ["src/utils.ts", "src/config.ts"],
      },
      {
        file: "src/utils.ts",
        affectedFiles: ["src/index.ts", "src/app.ts"],
        affectedTests: ["test/utils.test.ts"],
        affectedDocs: [],
        importedBy: ["src/index.ts", "src/app.ts"],
        imports: [],
      },
    ];

    it("should generate valid markdown", () => {
      const docs = generateImpactDocs(mockImpacts, "test-repo");

      expect(docs).toContain("# Change Impact Analysis");
      expect(docs).toContain("test-repo");
    });

    it("should include file sections", () => {
      const docs = generateImpactDocs(mockImpacts, "test-repo");

      expect(docs).toContain("`src/index.ts`");
      expect(docs).toContain("`src/utils.ts`");
    });

    it("should show imports", () => {
      const docs = generateImpactDocs(mockImpacts, "test-repo");

      expect(docs).toContain("**Imports:**");
      expect(docs).toContain("`src/utils.ts`");
    });

    it("should show importedBy", () => {
      const docs = generateImpactDocs(mockImpacts, "test-repo");

      expect(docs).toContain("**Imported by:**");
    });

    it("should show affected tests", () => {
      const docs = generateImpactDocs(mockImpacts, "test-repo");

      expect(docs).toContain("**Tests to run:**");
      expect(docs).toContain("`test/index.test.ts`");
    });

    it("should show affected docs", () => {
      const docs = generateImpactDocs(mockImpacts, "test-repo");

      expect(docs).toContain("**Related documentation:**");
    });

    it("should handle empty impacts", () => {
      const docs = generateImpactDocs([], "test-repo");

      expect(docs).toContain("# Change Impact Analysis");
    });

    it("should truncate long lists", () => {
      const manyImports: ChangeImpact = {
        file: "src/big.ts",
        affectedFiles: [],
        affectedTests: [],
        affectedDocs: [],
        importedBy: [],
        imports: Array.from({ length: 20 }, (_, i) => `src/file${i}.ts`),
      };

      const docs = generateImpactDocs([manyImports], "test-repo");

      expect(docs).toContain("... and 10 more");
    });
  });
});
