import { describe, it, expect } from "vitest";
import { generateTechRadar, generateRadarDocs, getRiskEmoji } from "../src/radar.js";
import type { StackInfo, FileInfo } from "../src/types.js";
import type { DependencyAnalysis } from "../src/deps.js";
import type { SecurityAnalysis } from "../src/security.js";

describe("Tech Radar", () => {
  const mockStack: StackInfo = {
    languages: ["TypeScript", "JavaScript"],
    frameworks: ["React", "Express"],
    buildSystem: "npm",
    packageManager: "npm",
    hasDocker: true,
    hasCi: true,
  };

  const mockFiles: FileInfo[] = [
    { path: "src/index.ts", size: 1000, isDirectory: false },
    { path: "src/app.test.ts", size: 500, isDirectory: false },
    { path: "README.md", size: 2000, isDirectory: false },
  ];

  const mockDeps: DependencyAnalysis = {
    runtime: [
      { name: "react", version: "^18.0.0" },
      { name: "express", version: "^4.0.0" },
      { name: "zod", version: "^3.0.0" },
    ],
    dev: [
      { name: "typescript", version: "^5.0.0" },
      { name: "vitest", version: "^1.0.0" },
      { name: "eslint", version: "^8.0.0" },
    ],
    optional: [],
    peer: [],
    totalCount: 6,
  };

  const mockSecurity: SecurityAnalysis = {
    score: 85,
    patterns: [],
    findings: [],
  };

  describe("generateTechRadar", () => {
    it("should identify modern technologies", () => {
      const radar = generateTechRadar(
        mockStack,
        mockFiles,
        mockDeps,
        mockSecurity,
        true,
        true
      );

      // vitest and zod should be detected as modern
      expect(radar.modern.some(s => s.name === "vitest")).toBe(true);
      expect(radar.modern.some(s => s.name === "zod")).toBe(true);
    });

    it("should identify stable technologies", () => {
      const radar = generateTechRadar(
        mockStack,
        mockFiles,
        mockDeps,
        mockSecurity,
        true,
        true
      );

      // TypeScript, eslint should be stable
      expect(radar.stable.some(s => s.name === "typescript")).toBe(true);
      expect(radar.stable.some(s => s.name === "eslint")).toBe(true);
    });

    it("should identify legacy technologies", () => {
      const depsWithLegacy: DependencyAnalysis = {
        ...mockDeps,
        runtime: [
          ...mockDeps.runtime,
          { name: "moment", version: "^2.0.0" },
          { name: "lodash", version: "^4.0.0" },
        ],
      };

      const radar = generateTechRadar(
        mockStack,
        mockFiles,
        depsWithLegacy,
        mockSecurity,
        true,
        true
      );

      expect(radar.legacy.some(s => s.name === "moment")).toBe(true);
      expect(radar.legacy.some(s => s.name === "lodash")).toBe(true);
    });

    it("should identify risky technologies", () => {
      const depsWithRisky: DependencyAnalysis = {
        ...mockDeps,
        dev: [
          ...mockDeps.dev,
          { name: "node-sass", version: "^7.0.0" },
          { name: "tslint", version: "^6.0.0" },
        ],
      };

      const radar = generateTechRadar(
        mockStack,
        mockFiles,
        depsWithRisky,
        mockSecurity,
        true,
        true
      );

      expect(radar.risky.some(s => s.name === "node-sass")).toBe(true);
      expect(radar.risky.some(s => s.name === "tslint")).toBe(true);
    });

    it("should calculate onboarding risk", () => {
      const radar = generateTechRadar(
        mockStack,
        mockFiles,
        mockDeps,
        mockSecurity,
        true,
        true
      );

      expect(radar.onboardingRisk).toBeDefined();
      expect(radar.onboardingRisk.score).toBeGreaterThanOrEqual(0);
      expect(radar.onboardingRisk.score).toBeLessThanOrEqual(100);
      expect(["A", "B", "C", "D", "F"]).toContain(radar.onboardingRisk.grade);
    });

    it("should increase risk when missing README", () => {
      const withReadme = generateTechRadar(
        mockStack,
        mockFiles,
        mockDeps,
        mockSecurity,
        true,
        true
      );

      const withoutReadme = generateTechRadar(
        mockStack,
        mockFiles,
        mockDeps,
        mockSecurity,
        false,
        true
      );

      expect(withoutReadme.onboardingRisk.score).toBeGreaterThan(withReadme.onboardingRisk.score);
      expect(withoutReadme.onboardingRisk.factors).toContain("Missing README");
    });

    it("should increase risk when no CI", () => {
      const withCi = generateTechRadar(
        mockStack,
        mockFiles,
        mockDeps,
        mockSecurity,
        true,
        true
      );

      const stackWithoutCi: StackInfo = { ...mockStack, hasCi: false };
      const withoutCi = generateTechRadar(
        stackWithoutCi,
        mockFiles,
        mockDeps,
        mockSecurity,
        true,
        true
      );

      expect(withoutCi.onboardingRisk.score).toBeGreaterThan(withCi.onboardingRisk.score);
    });

    it("should handle null dependencies", () => {
      const radar = generateTechRadar(
        mockStack,
        mockFiles,
        null,
        mockSecurity,
        true,
        true
      );

      expect(radar).toBeDefined();
      expect(radar.modern).toBeInstanceOf(Array);
    });
  });

  describe("generateRadarDocs", () => {
    it("should generate valid markdown", () => {
      const radar = generateTechRadar(
        mockStack,
        mockFiles,
        mockDeps,
        mockSecurity,
        true,
        true
      );

      const docs = generateRadarDocs(radar, "test-repo");

      expect(docs).toContain("# Tech Radar");
      expect(docs).toContain("test-repo");
      expect(docs).toContain("## Onboarding Risk");
    });

    it("should include modern technologies section", () => {
      const radar = generateTechRadar(
        mockStack,
        mockFiles,
        mockDeps,
        mockSecurity,
        true,
        true
      );

      const docs = generateRadarDocs(radar, "test-repo");

      if (radar.modern.length > 0) {
        expect(docs).toContain("Modern (Adopt)");
      }
    });
  });

  describe("getRiskEmoji", () => {
    it("should return correct emojis", () => {
      expect(getRiskEmoji("A")).toBe("\u{1F7E2}"); // green circle
      expect(getRiskEmoji("B")).toBe("\u{1F7E2}");
      expect(getRiskEmoji("C")).toBe("\u{1F7E1}"); // yellow circle
      expect(getRiskEmoji("D")).toBe("\u{1F7E0}"); // orange circle
      expect(getRiskEmoji("F")).toBe("\u{1F534}"); // red circle
    });
  });
});
