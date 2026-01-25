import { describe, it, expect } from "vitest";
import { 
  STYLE_PACKS, 
  getStyleConfig, 
  generateExampleConfig,
  examplePlugin 
} from "../src/plugins.js";
import type { StylePack } from "../src/types.js";

describe("Template Packs + Plugin System", () => {
  describe("STYLE_PACKS", () => {
    it("should define all four style packs", () => {
      expect(STYLE_PACKS.startup).toBeDefined();
      expect(STYLE_PACKS.enterprise).toBeDefined();
      expect(STYLE_PACKS.oss).toBeDefined();
      expect(STYLE_PACKS.devops).toBeDefined();
    });

    it("should have correct structure for each pack", () => {
      const styles: StylePack[] = ["startup", "enterprise", "oss", "devops"];

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

    it("should have enterprise pack with formal tone and no emoji", () => {
      expect(STYLE_PACKS.enterprise.tone).toBe("formal");
      expect(STYLE_PACKS.enterprise.emoji).toBe(false);
    });

    it("should have oss pack with casual tone", () => {
      expect(STYLE_PACKS.oss.tone).toBe("casual");
    });

    it("should have devops pack with technical tone", () => {
      expect(STYLE_PACKS.devops.tone).toBe("technical");
    });

    it("should have enterprise pack with most sections enabled", () => {
      const sections = STYLE_PACKS.enterprise.sections;
      expect(sections.showRunbook).toBe(true);
      expect(sections.showSecurityDetails).toBe(true);
      expect(sections.showDependencyGraph).toBe(true);
      expect(sections.showRadar).toBe(true);
      expect(sections.showImpact).toBe(true);
    });

    it("should have startup pack with limited sections", () => {
      const sections = STYLE_PACKS.startup.sections;
      expect(sections.showSecurityDetails).toBe(false);
      expect(sections.showDependencyGraph).toBe(false);
    });
  });

  describe("getStyleConfig", () => {
    it("should return oss style by default", () => {
      const config = getStyleConfig();
      expect(config.name).toBe("oss");
    });

    it("should return specified style", () => {
      const config = getStyleConfig("enterprise");
      expect(config.name).toBe("enterprise");
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

      const output = await examplePlugin.analyze(
        "/tmp/repo",
        mockScanResult,
        mockFacts,
        {} as any
      );

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

      const output = await examplePlugin.analyze(
        "/tmp/repo",
        mockScanResult,
        mockFacts,
        {} as any
      );

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
});
