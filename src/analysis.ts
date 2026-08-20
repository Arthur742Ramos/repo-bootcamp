import { readFile } from "fs/promises";
import { join } from "path";

import {
  pruneCache,
  readPhaseCache,
  writePhaseCache,
  type AnalysisPhase,
  type CacheGenerationOptions,
} from "./cache.js";
import { mergeFrameworksFromDeps } from "./ingest.js";
import { extractDependencies, type DependencyAnalysis } from "./deps.js";
import { analyzeSecurityPatterns, type SecurityAnalysis } from "./security.js";
import { generateTechRadar } from "./radar.js";
import { buildImportGraph, analyzeChangeImpact, getKeyFilesForImpact } from "./impact.js";
import { detectCyclesInImportGraph, type CyclesSummary } from "./cycles.js";
import { ProgressTracker } from "./progress.js";
import type { ScanResult, TechRadar, ChangeImpact } from "./types.js";

export interface ParallelAnalysisResult {
  deps: DependencyAnalysis | null;
  security: SecurityAnalysis;
  radar: TechRadar;
  impacts: ChangeImpact[];
  cycles: CyclesSummary;
}

export interface ParallelAnalysisCacheOptions {
  repoFullName: string;
  commitSha?: string;
  generationOptions?: CacheGenerationOptions;
  noCache?: boolean;
}

/**
 * Run security, radar, impact, and deps analyzers concurrently.
 * Each analyzer starts as early as its dependencies allow; independent
 * branches (deps, security, impacts) execute in parallel via Promise.all.
 */
export async function runParallelAnalysis(
  repoPath: string,
  scanResult: ScanResult,
  progress?: ProgressTracker,
  cacheOptions?: ParallelAnalysisCacheOptions
): Promise<ParallelAnalysisResult> {
  progress?.update("Running analyzers in parallel…");
  const useCache = Boolean(
    cacheOptions?.repoFullName && cacheOptions?.commitSha && cacheOptions?.noCache !== true
  );
  const cacheRepo = cacheOptions?.repoFullName || "";
  const cacheSha = cacheOptions?.commitSha || "";
  const generationOptions = cacheOptions?.generationOptions;

  if (useCache) {
    pruneCache(7 * 24 * 60 * 60 * 1000).catch(() => {});
  }

  const runCachedPhase = async <T>(
    phase: AnalysisPhase,
    label: string,
    compute: () => Promise<T>
  ): Promise<T> => {
    if (useCache) {
      const cached = await readPhaseCache<T>(phase, cacheRepo, cacheSha, generationOptions);
      if (cached.hit) {
        progress?.update(`${label} ✓ (cache)`);
        return cached.value;
      }
    }

    const value = await compute();

    if (useCache) {
      try {
        await writePhaseCache(phase, cacheRepo, cacheSha, value, generationOptions);
      } catch {
        // Cache write failures are non-fatal.
      }
    }

    progress?.update(`${label} ✓`);
    return value;
  };

  // --- independent branches, kicked off immediately ---
  const depsPromise = runCachedPhase<DependencyAnalysis | null>("deps", "deps", async () => {
    return await extractDependencies(repoPath);
  }).then((deps) => {
    if (deps) {
      const allDepNames = [...deps.runtime.map((d) => d.name), ...deps.dev.map((d) => d.name)];
      mergeFrameworksFromDeps(scanResult.stack, allDepNames);
    }
    return deps;
  });

  const packageJsonPromise: Promise<Record<string, unknown> | undefined> = readFile(
    join(repoPath, "package.json"),
    "utf-8"
  )
    .then((pkgContent) => JSON.parse(pkgContent) as Record<string, unknown>)
    .catch(() => undefined);

  const securityPromise = runCachedPhase<SecurityAnalysis>("security", "security", async () => {
    const packageJson = await packageJsonPromise;
    return await analyzeSecurityPatterns(repoPath, scanResult.files, packageJson);
  });

  const MAX_KEY_FILES_FOR_IMPACT = 10;

  // Lazily build the import graph at most once, and only if a consumer actually
  // needs it. Both the impact and cycles phases are cached independently, so on
  // a warm run where BOTH hit the cache the graph is never built — restoring the
  // pre-cycles behavior where a cache hit skipped graph construction entirely.
  let importGraphPromise: ReturnType<typeof buildImportGraph> | undefined;
  const getImportGraph = (): ReturnType<typeof buildImportGraph> => {
    if (!importGraphPromise) {
      importGraphPromise = buildImportGraph(repoPath, scanResult.files);
    }
    return importGraphPromise;
  };

  const impactsPromise = runCachedPhase<ChangeImpact[]>("impact", "impact", async () => {
    const importGraph = await getImportGraph();
    const keyFiles = getKeyFilesForImpact(scanResult.files);
    return await Promise.all(
      keyFiles
        .slice(0, MAX_KEY_FILES_FOR_IMPACT)
        .map((file) => analyzeChangeImpact(repoPath, scanResult.files, file, importGraph))
    );
  });

  // Cached as its own phase so a warm run skips both the Tarjan pass and the
  // graph build. The compute closure shares getImportGraph(), so when the impact
  // phase misses too, the graph is still built only once.
  const cyclesPromise = runCachedPhase<CyclesSummary>("cycles", "cycles", async () =>
    detectCyclesInImportGraph(await getImportGraph())
  );

  // radar depends on deps + security, but runs as soon as both resolve
  const radarPromise = Promise.all([depsPromise, securityPromise]).then(([deps, security]) => {
    const radar = generateTechRadar(
      scanResult.stack,
      scanResult.files,
      deps,
      security,
      !!scanResult.readme,
      !!scanResult.contributing
    );
    progress?.update("radar ✓");
    return radar;
  });

  // wait for all analyzers concurrently
  const [deps, security, radar, impacts, cycles] = await Promise.all([
    depsPromise,
    securityPromise,
    radarPromise,
    impactsPromise,
    cyclesPromise,
  ]);

  return { deps, security, radar, impacts, cycles };
}
