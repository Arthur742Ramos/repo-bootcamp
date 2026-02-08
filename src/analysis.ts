import { readFile } from "fs/promises";
import { join } from "path";

import { mergeFrameworksFromDeps } from "./ingest.js";
import { extractDependencies, type DependencyAnalysis } from "./deps.js";
import { analyzeSecurityPatterns, type SecurityAnalysis } from "./security.js";
import { generateTechRadar } from "./radar.js";
import { buildImportGraph, analyzeChangeImpact, getKeyFilesForImpact } from "./impact.js";
import { ProgressTracker } from "./progress.js";
import type { ScanResult, TechRadar, ChangeImpact } from "./types.js";

export interface ParallelAnalysisResult {
  deps: DependencyAnalysis | null;
  security: SecurityAnalysis;
  radar: TechRadar;
  impacts: ChangeImpact[];
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
): Promise<ParallelAnalysisResult> {
  progress?.update("Running analyzers in parallel…");

  // --- independent branches, kicked off immediately ---
  const depsPromise = extractDependencies(repoPath).then((deps) => {
    if (deps) {
      const allDepNames = [
        ...deps.runtime.map(d => d.name),
        ...deps.dev.map(d => d.name),
      ];
      mergeFrameworksFromDeps(scanResult.stack, allDepNames);
    }
    progress?.update("deps ✓");
    return deps;
  });

  const packageJsonPromise: Promise<Record<string, unknown> | undefined> = readFile(
    join(repoPath, "package.json"),
    "utf-8"
  )
    .then((pkgContent) => JSON.parse(pkgContent) as Record<string, unknown>)
    .catch(() => undefined);

  const securityPromise = packageJsonPromise.then((packageJson) =>
    analyzeSecurityPatterns(repoPath, scanResult.files, packageJson)
  ).then((security) => {
    progress?.update("security ✓");
    return security;
  });

  const MAX_KEY_FILES_FOR_IMPACT = 10;

  const impactsPromise = buildImportGraph(repoPath, scanResult.files).then((importGraph) => {
    const keyFiles = getKeyFilesForImpact(scanResult.files);
    return Promise.all(
      keyFiles.slice(0, MAX_KEY_FILES_FOR_IMPACT).map(file =>
        analyzeChangeImpact(repoPath, scanResult.files, file, importGraph)
      )
    );
  }).then((impacts) => {
    progress?.update("impact ✓");
    return impacts;
  });

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

  // wait for all four analyzers concurrently
  const [deps, security, radar, impacts] = await Promise.all([
    depsPromise,
    securityPromise,
    radarPromise,
    impactsPromise,
  ]);

  return { deps, security, radar, impacts };
}
