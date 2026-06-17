/**
 * Tests for parallel analysis orchestration (src/analysis.ts)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanResult, TechRadar, ChangeImpact, FileInfo } from "../src/types.js";
import type { SecurityAnalysis } from "../src/security.js";
import type { DependencyAnalysis } from "../src/deps.js";

const {
  extractDependenciesMock,
  analyzeSecurityPatternsMock,
  generateTechRadarMock,
  buildImportGraphMock,
  analyzeChangeImpactMock,
  getKeyFilesForImpactMock,
  mergeFrameworksFromDepsMock,
  readPhaseCacheMock,
  writePhaseCacheMock,
  pruneCacheMock,
  readFileMock,
} = vi.hoisted(() => ({
  extractDependenciesMock: vi.fn(),
  analyzeSecurityPatternsMock: vi.fn(),
  generateTechRadarMock: vi.fn(),
  buildImportGraphMock: vi.fn(),
  analyzeChangeImpactMock: vi.fn(),
  getKeyFilesForImpactMock: vi.fn(),
  mergeFrameworksFromDepsMock: vi.fn(),
  readPhaseCacheMock: vi.fn(),
  writePhaseCacheMock: vi.fn(),
  pruneCacheMock: vi.fn(),
  readFileMock: vi.fn(),
}));

vi.mock("../src/deps.js", () => ({
  extractDependencies: extractDependenciesMock,
}));

vi.mock("../src/security.js", () => ({
  analyzeSecurityPatterns: analyzeSecurityPatternsMock,
}));

vi.mock("../src/radar.js", () => ({
  generateTechRadar: generateTechRadarMock,
}));

vi.mock("../src/impact.js", () => ({
  buildImportGraph: buildImportGraphMock,
  analyzeChangeImpact: analyzeChangeImpactMock,
  getKeyFilesForImpact: getKeyFilesForImpactMock,
}));

vi.mock("../src/ingest.js", () => ({
  mergeFrameworksFromDeps: mergeFrameworksFromDepsMock,
}));

vi.mock("../src/cache.js", () => ({
  readPhaseCache: readPhaseCacheMock,
  writePhaseCache: writePhaseCacheMock,
  pruneCache: pruneCacheMock,
}));

vi.mock("fs/promises", () => ({
  readFile: readFileMock,
}));

import { runParallelAnalysis } from "../src/analysis.js";

const mockFiles: FileInfo[] = [
  { path: "src/index.ts", size: 500, isDirectory: false },
];

const mockScanResult: ScanResult = {
  files: mockFiles,
  stack: {
    languages: [{ name: "TypeScript", percentage: 100 }],
    frameworks: [],
    buildTools: [],
    testFrameworks: [],
    linters: [],
  },
  monorepo: null,
  commands: [],
  ciWorkflows: [],
  readme: "# Test",
  contributing: null,
  keySourceFiles: new Map(),
};

const mockDeps: DependencyAnalysis = {
  packageManager: "npm",
  totalCount: 2,
  runtime: [{ name: "express", version: "4.0.0", type: "runtime" }],
  dev: [{ name: "vitest", version: "1.0.0", type: "dev" }],
  peer: [],
  categories: [],
};

const mockSecurity: SecurityAnalysis = {
  score: 85,
  authPatterns: [],
  securityDeps: [],
  findings: [],
  secretsHandling: {
    envFiles: [],
    configFiles: [],
    gitignoreSecrets: true,
    hasEnvExample: false,
  },
  headers: { hasHelmet: false, hasCors: false, hasCSP: false },
  hasRateLimiting: false,
  hasInputValidation: false,
  hasSqlInjectionPrevention: false,
};

const mockRadar: TechRadar = {
  modern: [],
  stable: [],
  legacy: [],
  risky: [],
  onboardingRisk: { score: 20, grade: "A", factors: [] },
};

const mockImpact: ChangeImpact = {
  file: "src/index.ts",
  affectedFiles: ["src/app.ts"],
  affectedTests: [],
  affectedDocs: [],
  importedBy: [],
  imports: [],
};

beforeEach(() => {
  vi.clearAllMocks();

  extractDependenciesMock.mockResolvedValue(mockDeps);
  analyzeSecurityPatternsMock.mockResolvedValue(mockSecurity);
  generateTechRadarMock.mockReturnValue(mockRadar);
  buildImportGraphMock.mockResolvedValue(new Map());
  analyzeChangeImpactMock.mockResolvedValue(mockImpact);
  getKeyFilesForImpactMock.mockReturnValue(["src/index.ts"]);
  mergeFrameworksFromDepsMock.mockReturnValue(undefined);
  readPhaseCacheMock.mockResolvedValue({ hit: false });
  writePhaseCacheMock.mockResolvedValue(undefined);
  pruneCacheMock.mockResolvedValue(undefined);
  readFileMock.mockRejectedValue(new Error("not found"));
});

describe("runParallelAnalysis", () => {
  it("returns aggregated results from all analyzers", async () => {
    const result = await runParallelAnalysis("/repo", mockScanResult);

    expect(result.deps).toEqual(mockDeps);
    expect(result.security).toEqual(mockSecurity);
    expect(result.radar).toEqual(mockRadar);
    expect(result.impacts).toEqual([mockImpact]);
    expect(result.cycles).toEqual({ moduleCount: 0, cycles: [], rings: [] });
  });

  it("calls all analyzers with correct arguments", async () => {
    await runParallelAnalysis("/repo", mockScanResult);

    expect(extractDependenciesMock).toHaveBeenCalledWith("/repo");
    expect(analyzeSecurityPatternsMock).toHaveBeenCalledWith(
      "/repo",
      mockScanResult.files,
      undefined
    );
    expect(buildImportGraphMock).toHaveBeenCalledWith("/repo", mockScanResult.files);
    expect(getKeyFilesForImpactMock).toHaveBeenCalledWith(mockScanResult.files);
  });

  it("passes deps and security to generateTechRadar", async () => {
    await runParallelAnalysis("/repo", mockScanResult);

    expect(generateTechRadarMock).toHaveBeenCalledWith(
      mockScanResult.stack,
      mockScanResult.files,
      mockDeps,
      mockSecurity,
      true,  // !!scanResult.readme
      false  // !!scanResult.contributing
    );
  });

  it("merges frameworks from deps when deps are available", async () => {
    await runParallelAnalysis("/repo", mockScanResult);

    expect(mergeFrameworksFromDepsMock).toHaveBeenCalledWith(
      mockScanResult.stack,
      ["express", "vitest"]
    );
  });

  it("does not merge frameworks when deps is null", async () => {
    extractDependenciesMock.mockResolvedValue(null);

    await runParallelAnalysis("/repo", mockScanResult);

    expect(mergeFrameworksFromDepsMock).not.toHaveBeenCalled();
  });

  it("limits impact analysis to MAX_KEY_FILES_FOR_IMPACT (10)", async () => {
    const manyFiles = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`);
    getKeyFilesForImpactMock.mockReturnValue(manyFiles);

    await runParallelAnalysis("/repo", mockScanResult);

    expect(analyzeChangeImpactMock).toHaveBeenCalledTimes(10);
  });

  it("handles empty key files list", async () => {
    getKeyFilesForImpactMock.mockReturnValue([]);

    const result = await runParallelAnalysis("/repo", mockScanResult);

    expect(result.impacts).toEqual([]);
    expect(analyzeChangeImpactMock).not.toHaveBeenCalled();
  });

  describe("error handling", () => {
    it("propagates error when deps analyzer fails", async () => {
      extractDependenciesMock.mockRejectedValue(new Error("deps failed"));

      await expect(runParallelAnalysis("/repo", mockScanResult)).rejects.toThrow("deps failed");
    });

    it("propagates error when security analyzer fails", async () => {
      analyzeSecurityPatternsMock.mockRejectedValue(new Error("security failed"));

      await expect(runParallelAnalysis("/repo", mockScanResult)).rejects.toThrow("security failed");
    });

    it("propagates error when impact analyzer fails", async () => {
      buildImportGraphMock.mockRejectedValue(new Error("impact failed"));

      await expect(runParallelAnalysis("/repo", mockScanResult)).rejects.toThrow("impact failed");
    });

    it("propagates error when radar generator fails", async () => {
      generateTechRadarMock.mockImplementation(() => {
        throw new Error("radar failed");
      });

      await expect(runParallelAnalysis("/repo", mockScanResult)).rejects.toThrow("radar failed");
    });
  });

  describe("progress tracking", () => {
    it("calls progress.update when progress tracker is provided", async () => {
      const progress = { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() };

      await runParallelAnalysis("/repo", mockScanResult, progress as any);

      expect(progress.update).toHaveBeenCalledWith("Running analyzers in parallel…");
      expect(progress.update).toHaveBeenCalledWith("radar ✓");
    });

    it("works without progress tracker", async () => {
      const result = await runParallelAnalysis("/repo", mockScanResult);

      expect(result.deps).toEqual(mockDeps);
    });
  });

  describe("caching", () => {
    const cacheOptions = {
      repoFullName: "owner/repo",
      commitSha: "abc123",
    };

    it("reads from cache when cache options are provided", async () => {
      readPhaseCacheMock.mockResolvedValue({ hit: true, value: mockDeps });

      await runParallelAnalysis("/repo", mockScanResult, undefined, cacheOptions);

      expect(readPhaseCacheMock).toHaveBeenCalled();
    });

    it("writes to cache after computing", async () => {
      readPhaseCacheMock.mockResolvedValue({ hit: false });

      await runParallelAnalysis("/repo", mockScanResult, undefined, cacheOptions);

      expect(writePhaseCacheMock).toHaveBeenCalled();
    });

    it("skips cache when noCache is true", async () => {
      await runParallelAnalysis("/repo", mockScanResult, undefined, {
        ...cacheOptions,
        noCache: true,
      });

      expect(readPhaseCacheMock).not.toHaveBeenCalled();
      expect(writePhaseCacheMock).not.toHaveBeenCalled();
    });

    it("skips cache when repoFullName is missing", async () => {
      await runParallelAnalysis("/repo", mockScanResult, undefined, {
        repoFullName: "",
        commitSha: "abc123",
      });

      expect(readPhaseCacheMock).not.toHaveBeenCalled();
    });

    it("skips cache when commitSha is missing", async () => {
      await runParallelAnalysis("/repo", mockScanResult, undefined, {
        repoFullName: "owner/repo",
      });

      expect(readPhaseCacheMock).not.toHaveBeenCalled();
    });

    it("returns cached value and skips compute when cache hits", async () => {
      const cachedSecurity: SecurityAnalysis = { ...mockSecurity, score: 99 };
      let callCount = 0;
      readPhaseCacheMock.mockImplementation(async (phase: string) => {
        if (phase === "security") return { hit: true, value: cachedSecurity };
        return { hit: false };
      });

      const result = await runParallelAnalysis("/repo", mockScanResult, undefined, cacheOptions);

      expect(result.security).toEqual(cachedSecurity);
    });

    it("does not build the import graph when impact and cycles both cache-hit", async () => {
      // Restores the pre-cycles behavior: a warm run skips graph construction.
      readPhaseCacheMock.mockImplementation(async (phase: string) => {
        if (phase === "impact") return { hit: true, value: [mockImpact] };
        if (phase === "cycles") {
          return { hit: true, value: { moduleCount: 0, cycles: [], rings: [] } };
        }
        return { hit: false };
      });

      const result = await runParallelAnalysis("/repo", mockScanResult, undefined, cacheOptions);

      expect(buildImportGraphMock).not.toHaveBeenCalled();
      expect(result.impacts).toEqual([mockImpact]);
      expect(result.cycles).toEqual({ moduleCount: 0, cycles: [], rings: [] });
    });

    it("builds the import graph only once when a graph consumer misses", async () => {
      readPhaseCacheMock.mockImplementation(async (phase: string) => {
        // impact misses (needs graph); cycles hits (does not).
        if (phase === "cycles") {
          return { hit: true, value: { moduleCount: 0, cycles: [], rings: [] } };
        }
        return { hit: false };
      });

      await runParallelAnalysis("/repo", mockScanResult, undefined, cacheOptions);

      expect(buildImportGraphMock).toHaveBeenCalledTimes(1);
    });

    it("tolerates cache write failures", async () => {
      writePhaseCacheMock.mockRejectedValue(new Error("disk full"));

      const result = await runParallelAnalysis("/repo", mockScanResult, undefined, cacheOptions);

      expect(result.deps).toEqual(mockDeps);
    });

    it("prunes cache on startup when caching is enabled", async () => {
      await runParallelAnalysis("/repo", mockScanResult, undefined, cacheOptions);

      expect(pruneCacheMock).toHaveBeenCalledWith(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe("package.json reading", () => {
    it("passes parsed package.json to security analyzer", async () => {
      const pkgJson = { name: "test", dependencies: { express: "4.0.0" } };
      readFileMock.mockResolvedValue(JSON.stringify(pkgJson));

      await runParallelAnalysis("/repo", mockScanResult);

      expect(analyzeSecurityPatternsMock).toHaveBeenCalledWith(
        "/repo",
        mockScanResult.files,
        pkgJson
      );
    });

    it("passes undefined to security analyzer when package.json is missing", async () => {
      readFileMock.mockRejectedValue(new Error("ENOENT"));

      await runParallelAnalysis("/repo", mockScanResult);

      expect(analyzeSecurityPatternsMock).toHaveBeenCalledWith(
        "/repo",
        mockScanResult.files,
        undefined
      );
    });
  });
});
