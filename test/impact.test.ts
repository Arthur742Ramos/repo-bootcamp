import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getKeyFilesForImpact, generateImpactDocs, analyzeChangeImpact } from "../src/impact.js";
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

    it("should limit to 20 files", () => {
      const manyFiles: FileInfo[] = [];
      for (let i = 0; i < 30; i++) {
        manyFiles.push({ path: `src/file${i}.ts`, size: 100, isDirectory: false });
      }

      const keyFiles = getKeyFilesForImpact(manyFiles);
      expect(keyFiles.length).toBeLessThanOrEqual(20);
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

    it("appends a Circular Dependencies section when cycles are provided", () => {
      const docs = generateImpactDocs(mockImpacts, "test-repo", {
        moduleCount: 3,
        cycles: [{ size: 2, files: ["a", "b"] }],
        rings: ["a → b → a"],
      });
      expect(docs).toContain("## Circular Dependencies");
      expect(docs).toContain("a → b → a");
      expect(docs).toContain("(2 files)");
    });

    it("labels a self-import cycle", () => {
      const docs = generateImpactDocs(mockImpacts, "test-repo", {
        moduleCount: 1,
        cycles: [{ size: 1, files: ["x"] }],
        rings: ["x → x"],
      });
      expect(docs).toContain("(self-import)");
    });

    it("omits the Circular Dependencies section when there are no cycles", () => {
      const docs = generateImpactDocs(mockImpacts, "test-repo", {
        moduleCount: 5,
        cycles: [],
        rings: [],
      });
      expect(docs).not.toContain("Circular Dependencies");
    });

    it("is unchanged when the cycles argument is omitted (additive)", () => {
      const withArg = generateImpactDocs(mockImpacts, "test-repo", {
        moduleCount: 5,
        cycles: [],
        rings: [],
      });
      const withoutArg = generateImpactDocs(mockImpacts, "test-repo");
      expect(withoutArg).toBe(withArg);
      expect(withoutArg).not.toContain("Circular Dependencies");
    });
  });

  describe("analyzeChangeImpact related-test detection", () => {
    const files: FileInfo[] = [
      { path: "pkg/server.go", size: 1, isDirectory: false },
      { path: "pkg/server_test.go", size: 1, isDirectory: false },
      { path: "app/calc.py", size: 1, isDirectory: false },
      { path: "app/test_calc.py", size: 1, isDirectory: false },
      { path: "app/widget.py", size: 1, isDirectory: false },
      { path: "app/widget_test.py", size: 1, isDirectory: false },
      { path: "src/foo.ts", size: 1, isDirectory: false },
      { path: "src/foo.test.ts", size: 1, isDirectory: false },
    ];
    // Empty edges — isolate related-test detection from import-graph traversal.
    const graph = new Map(files.map((f) => [f.path, { imports: [], importedBy: [] }]));

    it("links a Go file to its *_test.go sibling", async () => {
      const impact = await analyzeChangeImpact("/repo", files, "pkg/server.go", graph);
      expect(impact.affectedTests).toEqual(["pkg/server_test.go"]);
    });

    it("links a Python file to its test_*.py sibling", async () => {
      const impact = await analyzeChangeImpact("/repo", files, "app/calc.py", graph);
      expect(impact.affectedTests).toEqual(["app/test_calc.py"]);
    });

    it("links a Python file to its *_test.py sibling", async () => {
      const impact = await analyzeChangeImpact("/repo", files, "app/widget.py", graph);
      expect(impact.affectedTests).toEqual(["app/widget_test.py"]);
    });

    it("still links a TS file to its .test.ts sibling", async () => {
      const impact = await analyzeChangeImpact("/repo", files, "src/foo.ts", graph);
      expect(impact.affectedTests).toEqual(["src/foo.test.ts"]);
    });
  });
});
