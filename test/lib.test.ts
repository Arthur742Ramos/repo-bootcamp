/**
 * Tests for lib.ts exports (superset of api.ts)
 */

import { describe, it, expect } from "vitest";
import * as lib from "../src/lib.js";

describe("lib.ts re-exports all of api.ts", () => {
  it("exports agent functions and constants", () => {
    expect(typeof lib.analyzeRepo).toBe("function");
    expect(typeof lib.createSessionWithFallback).toBe("function");
    expect(typeof lib.readCustomPrompt).toBe("function");
    expect(Array.isArray(lib.PREFERRED_MODELS)).toBe(true);
  });

  it("exports analysis functions", () => {
    expect(typeof lib.runParallelAnalysis).toBe("function");
  });

  it("exports generator functions", () => {
    expect(typeof lib.generateBootcamp).toBe("function");
    expect(typeof lib.generateOnboarding).toBe("function");
    expect(typeof lib.generateArchitecture).toBe("function");
    expect(typeof lib.generateCodemap).toBe("function");
    expect(typeof lib.generateFirstTasks).toBe("function");
    expect(typeof lib.generateRunbook).toBe("function");
    expect(typeof lib.generateDiagrams).toBe("function");
  });

  it("exports repo-resolver functions", () => {
    expect(typeof lib.isLocalPath).toBe("function");
    expect(typeof lib.resolveRepo).toBe("function");
  });
});

describe("lib.ts cache exports", () => {
  it("exports cache functions", () => {
    expect(typeof lib.clearCache).toBe("function");
    expect(typeof lib.getCacheDir).toBe("function");
    expect(typeof lib.pruneCache).toBe("function");
    expect(typeof lib.readCache).toBe("function");
    expect(typeof lib.writeCache).toBe("function");
  });
});

describe("lib.ts deps exports", () => {
  it("exports dependency functions", () => {
    expect(typeof lib.extractDependencies).toBe("function");
    expect(typeof lib.generateDependencyDiagram).toBe("function");
    expect(typeof lib.generateDependencyDocs).toBe("function");
  });
});

describe("lib.ts diff exports", () => {
  it("exports diff functions", () => {
    expect(typeof lib.analyzeDiff).toBe("function");
    expect(typeof lib.fetchPullRequestRefs).toBe("function");
    expect(typeof lib.generateDiffDocs).toBe("function");
    expect(typeof lib.parsePullRequestTarget).toBe("function");
  });
});

describe("lib.ts diagrams exports", () => {
  it("exports diagram functions", () => {
    expect(typeof lib.isMermaidCliAvailable).toBe("function");
    expect(typeof lib.parseMermaidFile).toBe("function");
    expect(typeof lib.renderDiagram).toBe("function");
    expect(typeof lib.renderMermaidFile).toBe("function");
    expect(typeof lib.renderOutputDiagrams).toBe("function");
  });
});

describe("lib.ts docs-analyzer exports", () => {
  it("exports docs analysis functions", () => {
    expect(typeof lib.analyzeBadges).toBe("function");
    expect(typeof lib.analyzeCLIDrift).toBe("function");
    expect(typeof lib.analyzeDocumentation).toBe("function");
    expect(typeof lib.analyzeFrameworkDocs).toBe("function");
    expect(typeof lib.analyzePrerequisites).toBe("function");
    expect(typeof lib.analyzeVersionMismatches).toBe("function");
  });
});

describe("lib.ts docs-fixer exports", () => {
  it("exports docs fixer functions", () => {
    expect(typeof lib.addMissingFrameworks).toBe("function");
    expect(typeof lib.fixDocumentation).toBe("function");
    expect(typeof lib.updateCLIUsage).toBe("function");
    expect(typeof lib.updateVersionNumbers).toBe("function");
  });
});

describe("lib.ts ingest exports", () => {
  it("exports ingest functions", () => {
    expect(typeof lib.cloneRepo).toBe("function");
    expect(typeof lib.detectFrameworksFromDeps).toBe("function");
    expect(typeof lib.listFilesByPattern).toBe("function");
    expect(typeof lib.mergeFrameworksFromDeps).toBe("function");
    expect(typeof lib.parseGitHubUrl).toBe("function");
    expect(typeof lib.readRepoFile).toBe("function");
    expect(typeof lib.scanRepo).toBe("function");
  });
});

describe("lib.ts plugin-api exports", () => {
  it("exports plugin type guards", () => {
    expect(typeof lib.isAnalyzerPlugin).toBe("function");
    expect(typeof lib.isFormatterPlugin).toBe("function");
    expect(typeof lib.isOutputTargetPlugin).toBe("function");
  });
});

describe("lib.ts plugins exports", () => {
  it("exports plugin functions and constants", () => {
    expect(Array.isArray(lib.STYLE_PACK_NAMES)).toBe(true);
    expect(typeof lib.STYLE_PACKS).toBe("object");
    expect(typeof lib.examplePlugin).toBe("object");
    expect(typeof lib.generateExampleConfig).toBe("function");
    expect(typeof lib.getStyleConfig).toBe("function");
    expect(typeof lib.loadConfig).toBe("function");
    expect(typeof lib.loadPlugins).toBe("function");
    expect(typeof lib.runPlugins).toBe("function");
  });
});

describe("lib.ts schema exports", () => {
  it("exports schema functions", () => {
    expect(typeof lib.getMissingFieldsSummary).toBe("function");
    expect(lib.RepoFactsSchema).toBeDefined();
    expect(typeof lib.validateRepoFacts).toBe("function");
  });
});

describe("lib.ts security exports", () => {
  it("exports security functions", () => {
    expect(typeof lib.analyzeSecurityPatterns).toBe("function");
    expect(typeof lib.generateSecurityDocs).toBe("function");
    expect(typeof lib.getSecurityGrade).toBe("function");
  });
});

describe("lib.ts tools exports", () => {
  it("exports tools functions", () => {
    expect(typeof lib.getRepoTools).toBe("function");
    expect(typeof lib.safePath).toBe("function");
  });
});

describe("lib.ts watch exports", () => {
  it("exports watch functions", () => {
    expect(typeof lib.fetchAndCheckUpdates).toBe("function");
    expect(typeof lib.getHeadCommit).toBe("function");
    expect(typeof lib.startWatch).toBe("function");
  });
});
