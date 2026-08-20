import { describe, it, expect } from "vitest";
import { isAnalyzerPlugin, isFormatterPlugin, isOutputTargetPlugin } from "../src/plugin-api.js";
import type {
  PluginDocument,
  PluginOutput,
  AnalyzerPlugin,
  FormatterContext,
  FormatterPlugin,
  OutputTargetContext,
  OutputTargetPlugin,
  BootcampPlugin,
} from "../src/plugin-api.js";

describe("plugin-api type guards", () => {
  describe("isAnalyzerPlugin", () => {
    it("returns true for a valid analyzer plugin", () => {
      const plugin: AnalyzerPlugin = {
        name: "test-analyzer",
        analyze: async () => ({ docs: [] }),
      };
      expect(isAnalyzerPlugin(plugin)).toBe(true);
    });

    it("returns true when optional fields are present", () => {
      const plugin: AnalyzerPlugin = {
        type: "analyzer",
        name: "full-analyzer",
        version: "2.0.0",
        analyze: async () => ({ docs: [] }),
      };
      expect(isAnalyzerPlugin(plugin)).toBe(true);
    });

    it("returns false for null", () => {
      expect(isAnalyzerPlugin(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isAnalyzerPlugin(undefined)).toBe(false);
    });

    it("returns false for a string", () => {
      expect(isAnalyzerPlugin("not a plugin")).toBe(false);
    });

    it("returns false when name is missing", () => {
      expect(isAnalyzerPlugin({ analyze: async () => ({ docs: [] }) })).toBe(false);
    });

    it("returns false when analyze is missing", () => {
      expect(isAnalyzerPlugin({ name: "no-analyze" })).toBe(false);
    });

    it("returns false when analyze is not a function", () => {
      expect(isAnalyzerPlugin({ name: "bad", analyze: "not-fn" })).toBe(false);
    });

    it("returns false for an empty object", () => {
      expect(isAnalyzerPlugin({})).toBe(false);
    });
  });

  describe("isFormatterPlugin", () => {
    it("returns true for a valid formatter plugin", () => {
      const plugin: FormatterPlugin = {
        type: "formatter",
        name: "test-formatter",
        formatDocuments: async (docs) => docs,
      };
      expect(isFormatterPlugin(plugin)).toBe(true);
    });

    it("returns false for null", () => {
      expect(isFormatterPlugin(null)).toBe(false);
    });

    it("returns false for a primitive", () => {
      expect(isFormatterPlugin(42)).toBe(false);
    });

    it("returns false when name is missing", () => {
      expect(isFormatterPlugin({ formatDocuments: async () => [] })).toBe(false);
    });

    it("returns false when formatDocuments is missing", () => {
      expect(isFormatterPlugin({ name: "no-format" })).toBe(false);
    });

    it("returns false when formatDocuments is not a function", () => {
      expect(isFormatterPlugin({ name: "bad", formatDocuments: 123 })).toBe(false);
    });
  });

  describe("isOutputTargetPlugin", () => {
    it("returns true for a valid output target plugin", () => {
      const plugin: OutputTargetPlugin = {
        type: "output-target",
        name: "test-target",
        writeOutput: async () => {},
      };
      expect(isOutputTargetPlugin(plugin)).toBe(true);
    });

    it("returns false for null", () => {
      expect(isOutputTargetPlugin(null)).toBe(false);
    });

    it("returns false for a boolean", () => {
      expect(isOutputTargetPlugin(true)).toBe(false);
    });

    it("returns false when name is missing", () => {
      expect(isOutputTargetPlugin({ writeOutput: async () => {} })).toBe(false);
    });

    it("returns false when writeOutput is missing", () => {
      expect(isOutputTargetPlugin({ name: "no-write" })).toBe(false);
    });

    it("returns false when writeOutput is not a function", () => {
      expect(isOutputTargetPlugin({ name: "bad", writeOutput: null })).toBe(false);
    });
  });
});

describe("plugin-api interfaces", () => {
  it("AnalyzerPlugin conforms to BootcampPlugin union", () => {
    const plugin: BootcampPlugin = {
      name: "analyzer",
      analyze: async (_path, _scan, _facts, _opts) => ({
        docs: [{ name: "README.md", content: "# Hello" }],
        factsPatch: { repoName: "patched" },
        extraData: { key: "value" },
      }),
    };
    expect(isAnalyzerPlugin(plugin)).toBe(true);
    expect(isFormatterPlugin(plugin)).toBe(false);
    expect(isOutputTargetPlugin(plugin)).toBe(false);
  });

  it("FormatterPlugin conforms to BootcampPlugin union", () => {
    const plugin: BootcampPlugin = {
      type: "formatter",
      name: "fmt",
      formatDocuments: async (docs) => docs,
    };
    expect(isFormatterPlugin(plugin)).toBe(true);
    expect(isAnalyzerPlugin(plugin)).toBe(false);
    expect(isOutputTargetPlugin(plugin)).toBe(false);
  });

  it("OutputTargetPlugin conforms to BootcampPlugin union", () => {
    const plugin: BootcampPlugin = {
      type: "output-target",
      name: "target",
      writeOutput: async () => {},
    };
    expect(isOutputTargetPlugin(plugin)).toBe(true);
    expect(isAnalyzerPlugin(plugin)).toBe(false);
    expect(isFormatterPlugin(plugin)).toBe(false);
  });

  it("PluginDocument has name and content", () => {
    const doc: PluginDocument = { name: "GUIDE.md", content: "guide content" };
    expect(doc.name).toBe("GUIDE.md");
    expect(doc.content).toBe("guide content");
  });

  it("PluginOutput supports optional factsPatch and extraData", () => {
    const minimal: PluginOutput = { docs: [] };
    expect(minimal.factsPatch).toBeUndefined();
    expect(minimal.extraData).toBeUndefined();

    const full: PluginOutput = {
      docs: [{ name: "A.md", content: "" }],
      factsPatch: { repoName: "r" },
      extraData: { metric: 1 },
    };
    expect(full.factsPatch?.repoName).toBe("r");
    expect(full.extraData?.metric).toBe(1);
  });

  it("FormatterContext holds all expected fields", () => {
    const ctx: FormatterContext = {
      repoPath: "/repo",
      repoInfo: {} as any,
      scanResult: {} as any,
      facts: {} as any,
      options: {} as any,
    };
    expect(ctx.repoPath).toBe("/repo");
  });

  it("OutputTargetContext holds all expected fields", () => {
    const ctx: OutputTargetContext = {
      documents: [{ name: "X.md", content: "x" }],
      outputDir: "/out",
      repoInfo: {} as any,
      facts: {} as any,
      options: {} as any,
    };
    expect(ctx.outputDir).toBe("/out");
    expect(ctx.documents).toHaveLength(1);
  });

  it("custom analyzer produces valid PluginOutput", async () => {
    const analyzer: AnalyzerPlugin = {
      name: "custom-analyzer",
      version: "1.0.0",
      analyze: async (repoPath, scanResult, facts) => ({
        docs: [{ name: "ANALYSIS.md", content: `Analyzed ${facts.repoName ?? "unknown"}` }],
        factsPatch: { repoName: "overridden" },
      }),
    };
    const output = await analyzer.analyze(
      "/repo",
      {} as any,
      { repoName: "my-repo" } as any,
      {} as any
    );
    expect(output.docs[0].content).toContain("my-repo");
    expect(output.factsPatch?.repoName).toBe("overridden");
  });

  it("custom formatter transforms documents", async () => {
    const formatter: FormatterPlugin = {
      type: "formatter",
      name: "uppercase-formatter",
      formatDocuments: async (docs) =>
        docs.map((d) => ({ ...d, content: d.content.toUpperCase() })),
    };
    const result = await formatter.formatDocuments([{ name: "a.md", content: "hello" }], {
      repoPath: "/repo",
      repoInfo: {} as any,
      scanResult: {} as any,
      facts: {} as any,
      options: {} as any,
    });
    expect(result[0].content).toBe("HELLO");
  });

  it("custom output target receives context", async () => {
    let captured: OutputTargetContext | undefined;
    const target: OutputTargetPlugin = {
      type: "output-target",
      name: "capture-target",
      writeOutput: async (ctx) => {
        captured = ctx;
      },
    };
    const ctx: OutputTargetContext = {
      documents: [{ name: "B.md", content: "b" }],
      outputDir: "/output",
      repoInfo: {} as any,
      facts: {} as any,
      options: {} as any,
    };
    await target.writeOutput(ctx);
    expect(captured).toBeDefined();
    expect(captured!.outputDir).toBe("/output");
    expect(captured!.documents).toHaveLength(1);
  });
});
