import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect } from "vitest";
import {
  STYLE_PACKS,
  getStyleConfig,
  generateExampleConfig,
  examplePlugin,
  loadConfig,
  runPlugins,
} from "../src/plugins.js";
import type { StylePack } from "../src/types.js";

describe("Template Packs + Plugin System", () => {
  describe("STYLE_PACKS", () => {
    it("should define all five style packs", () => {
      expect(STYLE_PACKS.corporate).toBeDefined();
      expect(STYLE_PACKS.startup).toBeDefined();
      expect(STYLE_PACKS.oss).toBeDefined();
      expect(STYLE_PACKS.academic).toBeDefined();
      expect(STYLE_PACKS.minimal).toBeDefined();
    });

    it("should have correct structure for each pack", () => {
      const styles: StylePack[] = ["corporate", "startup", "oss", "academic", "minimal"];

      for (const style of styles) {
        const pack = STYLE_PACKS[style];
        expect(pack.name).toBe(style);
        expect(pack.description).toBeTruthy();
        expect(["formal", "casual", "technical"]).toContain(pack.tone);
        expect(typeof pack.emoji).toBe("boolean");
        expect(pack.sections).toBeDefined();
        expect(pack.badges).toBeDefined();
        expect(typeof pack.firstTasksCount).toBe("number");
        expect(pack.introText).toBeTruthy();
      }
    });

    it("should have startup pack with casual tone and emoji", () => {
      expect(STYLE_PACKS.startup.tone).toBe("casual");
      expect(STYLE_PACKS.startup.emoji).toBe(true);
    });

    it("should have corporate pack with formal tone and no emoji", () => {
      expect(STYLE_PACKS.corporate.tone).toBe("formal");
      expect(STYLE_PACKS.corporate.emoji).toBe(false);
    });

    it("should have oss pack with casual tone", () => {
      expect(STYLE_PACKS.oss.tone).toBe("casual");
    });

    it("should have academic pack with technical tone", () => {
      expect(STYLE_PACKS.academic.tone).toBe("technical");
    });

    it("should have corporate pack with most sections enabled", () => {
      const sections = STYLE_PACKS.corporate.sections;
      expect(sections.showRunbook).toBe(true);
      expect(sections.showSecurityDetails).toBe(true);
      expect(sections.showDependencyGraph).toBe(true);
      expect(sections.showRadar).toBe(true);
      expect(sections.showImpact).toBe(true);
    });

    it("should have minimal pack with most sections disabled", () => {
      const sections = STYLE_PACKS.minimal.sections;
      expect(sections.showRunbook).toBe(false);
      expect(sections.showSecurityDetails).toBe(false);
      expect(sections.showDependencyGraph).toBe(false);
      expect(sections.showRadar).toBe(false);
      expect(sections.showImpact).toBe(false);
    });
  });

  describe("getStyleConfig", () => {
    it("should return oss style by default", () => {
      const config = getStyleConfig();
      expect(config.name).toBe("oss");
    });

    it("should return specified style", () => {
      const config = getStyleConfig("corporate");
      expect(config.name).toBe("corporate");
    });

    it("should merge custom overrides", () => {
      const config = getStyleConfig("startup", {
        emoji: false,
        firstTasksCount: 15,
      });

      expect(config.name).toBe("startup");
      expect(config.emoji).toBe(false);
      expect(config.firstTasksCount).toBe(15);
      // Other properties should remain from base
      expect(config.tone).toBe("casual");
    });

    it("should merge section overrides", () => {
      const config = getStyleConfig("startup", {
        sections: {
          showSecurityDetails: true,
        },
      } as any);

      expect(config.sections.showSecurityDetails).toBe(true);
      // Other sections should remain from base
      expect(config.sections.showRunbook).toBe(true);
    });

    it("should merge badge overrides", () => {
      const config = getStyleConfig("oss", {
        badges: {
          style: "none",
        },
      } as any);

      expect(config.badges.style).toBe("none");
    });
  });

  describe("generateExampleConfig", () => {
    it("should generate valid JSON", () => {
      const config = generateExampleConfig();
      expect(() => JSON.parse(config)).not.toThrow();
    });

    it("should include style field", () => {
      const config = JSON.parse(generateExampleConfig());
      expect(config.style).toBe("oss");
    });

    it("should include customStyle field", () => {
      const config = JSON.parse(generateExampleConfig());
      expect(config.customStyle).toBeDefined();
    });

    it("should include plugins array", () => {
      const config = JSON.parse(generateExampleConfig());
      expect(config.plugins).toBeInstanceOf(Array);
    });

    it("should include prompts field", () => {
      const config = JSON.parse(generateExampleConfig());
      expect(config.prompts).toBeDefined();
      expect(config.prompts.system).toBeTruthy();
    });

    it("should include output field", () => {
      const config = JSON.parse(generateExampleConfig());
      expect(config.output).toBeDefined();
    });
  });

  describe("loadConfig", () => {
    it("loads extensionless .bootcamprc files", async () => {
      const dir = await mkdtemp(join(tmpdir(), "bootcamp-config-"));
      const configPath = join(dir, ".bootcamprc");
      try {
        await writeFile(
          configPath,
          JSON.stringify({
            defaults: {
              audience: "sre",
              focus: "architecture",
              maxFiles: 180,
            },
          }),
          "utf-8"
        );
        const config = await loadConfig(configPath);
        expect(config?.defaults?.audience).toBe("sre");
        expect(config?.defaults?.focus).toBe("architecture");
        expect(config?.defaults?.maxFiles).toBe(180);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("loads bootcamp.config.ts files", async () => {
      const dir = await mkdtemp(join(tmpdir(), "bootcamp-config-ts-"));
      const configPath = join(dir, "bootcamp.config.ts");
      try {
        await writeFile(
          configPath,
          `export default {
  defaults: {
    model: "test-model",
    style: "minimal",
    maxFiles: 42
  }
};`,
          "utf-8"
        );
        const config = await loadConfig(configPath);
        expect(config?.defaults?.model).toBe("test-model");
        expect(config?.defaults?.style).toBe("minimal");
        expect(config?.defaults?.maxFiles).toBe(42);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("examplePlugin", () => {
    it("should have correct structure", () => {
      expect(examplePlugin.name).toBe("example-plugin");
      expect(examplePlugin.version).toBe("1.0.0");
      expect(typeof examplePlugin.analyze).toBe("function");
    });

    it("should return docs array", async () => {
      const mockFacts = {
        repoName: "test-repo",
      } as any;

      const mockScanResult = {
        stack: {
          languages: ["TypeScript", "JavaScript"],
        },
      } as any;

      const output = await examplePlugin.analyze("/tmp/repo", mockScanResult, mockFacts, {} as any);

      expect(output.docs).toBeInstanceOf(Array);
      expect(output.docs.length).toBeGreaterThan(0);
      expect(output.docs[0].name).toBe("CUSTOM.md");
    });

    it("should include languages in output", async () => {
      const mockFacts = {
        repoName: "test-repo",
      } as any;

      const mockScanResult = {
        stack: {
          languages: ["TypeScript", "JavaScript"],
        },
      } as any;

      const output = await examplePlugin.analyze("/tmp/repo", mockScanResult, mockFacts, {} as any);

      expect(output.docs[0].content).toContain("TypeScript");
      expect(output.docs[0].content).toContain("JavaScript");
    });

    it("should include extra data", async () => {
      const output = await examplePlugin.analyze(
        "/tmp/repo",
        { stack: { languages: [] } } as any,
        { repoName: "test" } as any,
        {} as any
      );

      expect(output.extraData).toBeDefined();
      expect(output.extraData?.customMetric).toBe(42);
    });
  });

  describe("runPlugins", () => {
    it("supports analyzer, formatter, and output-target plugin shapes", async () => {
      const formatterPlugin = {
        name: "formatter-plugin",
        type: "formatter",
        formatDocuments: async (documents: { name: string; content: string }[]) => documents,
      };
      const outputTargetPlugin = {
        name: "target-plugin",
        type: "output-target",
        writeOutput: async () => {},
      };

      const result = await runPlugins(
        [examplePlugin as any, formatterPlugin as any, outputTargetPlugin as any],
        "/tmp/repo",
        { stack: { languages: [] } } as any,
        { repoName: "test-repo" } as any,
        {} as any
      );

      expect(result.docs.length).toBeGreaterThan(0);
      expect(result.formatters).toHaveLength(1);
      expect(result.outputTargets).toHaveLength(1);
    });
  });
});

describe("plugins extra branch coverage", () => {
  it("loadConfig returns null on error", async () => {
    const { loadConfig } = await import("../src/plugins.js");
    // Loading from a nonexistent explicit path should return null
    const result = await loadConfig("/nonexistent/path/config.json");
    expect(result).toBeNull();
  });

  it("loadPlugins handles failed plugin load", async () => {
    const { loadPlugins } = await import("../src/plugins.js");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugins = await loadPlugins(["/nonexistent/plugin.js"]);
    expect(plugins).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("runPlugins handles plugin with extraData", async () => {
    const { runPlugins } = await import("../src/plugins.js");
    const mockPlugin = {
      name: "test-extra",
      version: "1.0.0",
      analyze: vi.fn().mockResolvedValue({
        docs: [],
        extraData: { key: "value" },
      }),
    };
    const result = await runPlugins([mockPlugin] as any, "/repo", {} as any, {} as any);
    expect(result.extraData["test-extra"]).toEqual({ key: "value" });
  });

  it("runPlugins handles plugin failure", async () => {
    const { runPlugins } = await import("../src/plugins.js");
    const mockPlugin = {
      name: "failing-plugin",
      analyze: vi.fn().mockRejectedValue(new Error("plugin crash")),
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runPlugins([mockPlugin] as any, "/repo", {} as any, {} as any);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
