/**
 * Tests for api.ts exports
 */

import { describe, it, expect } from "vitest";
import * as api from "../src/api.js";

describe("api.ts exports", () => {
  it("exports analyzeRepo as a function", () => {
    expect(typeof api.analyzeRepo).toBe("function");
  });

  it("exports createSessionWithFallback as a function", () => {
    expect(typeof api.createSessionWithFallback).toBe("function");
  });

  it("exports readCustomPrompt as a function", () => {
    expect(typeof api.readCustomPrompt).toBe("function");
  });

  it("exports PREFERRED_MODELS as an array", () => {
    expect(Array.isArray(api.PREFERRED_MODELS)).toBe(true);
  });

  it("exports runParallelAnalysis as a function", () => {
    expect(typeof api.runParallelAnalysis).toBe("function");
  });

  it("exports generator functions", () => {
    expect(typeof api.generateBootcamp).toBe("function");
    expect(typeof api.generateOnboarding).toBe("function");
    expect(typeof api.generateArchitecture).toBe("function");
    expect(typeof api.generateCodemap).toBe("function");
    expect(typeof api.generateFirstTasks).toBe("function");
    expect(typeof api.generateRunbook).toBe("function");
    expect(typeof api.generateDiagrams).toBe("function");
  });

  it("exports repo-resolver functions", () => {
    expect(typeof api.isLocalPath).toBe("function");
    expect(typeof api.resolveRepo).toBe("function");
  });

  it("does not export unexpected runtime values beyond the known set", () => {
    const expectedExports = [
      "analyzeRepo",
      "createSessionWithFallback",
      "readCustomPrompt",
      "PREFERRED_MODELS",
      "runParallelAnalysis",
      "generateBootcamp",
      "generateOnboarding",
      "generateArchitecture",
      "generateCodemap",
      "generateFirstTasks",
      "generateRunbook",
      "generateDiagrams",
      "isLocalPath",
      "resolveRepo",
      "evaluateDoctor",
      "formatDoctorReport",
      "gatherEnvironment",
      "parseNodeMajor",
      "MIN_NODE_MAJOR",
      "TOKEN_ENV_VARS",
      "computeCodebaseMetrics",
      "generateMetricsDocs",
      "getApproachabilityGrade",
      "formatBytes",
      "computeRepoHealth",
      "generateHealthDocs",
      "getHealthGrade",
      "discoverTasks",
      "categorizeTask",
      "suggestGettingStarted",
      "toCommands",
      "CATEGORY_ORDER",
    ];
    const runtimeExports = Object.keys(api);
    for (const key of runtimeExports) {
      expect(expectedExports).toContain(key);
    }
  });
});
