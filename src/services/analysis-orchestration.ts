import { analyzeRepo, type AnalysisStats } from "../agent.js";
import { runParallelAnalysis } from "../analysis.js";
import { pruneCache, readCache, writeCache } from "../cache.js";
import { analyzeDiff, generateDiffDocs } from "../diff.js";
import { generateDependencyDocs, type DependencyAnalysis } from "../deps.js";
import {
  generateArchitecture,
  generateBootcamp,
  generateCodemap,
  generateDiagrams,
  generateFirstTasks,
  generateOnboarding,
  generateRunbook,
} from "../generator.js";
import { generateImpactDocs } from "../impact.js";
import { loadPlugins, runPlugins, type BootcampConfig, type StyleConfig } from "../plugins.js";
import { ProgressTracker } from "../progress.js";
import { generateRadarDocs } from "../radar.js";
import { generateSecurityDocs, type SecurityAnalysis } from "../security.js";
import type { BootcampOptions, DiffSummary, RepoFacts, RepoInfo, ScanResult, TechRadar } from "../types.js";
import chalk from "chalk";

export interface GeneratedDoc {
  name: string;
  content: string;
}

interface OrchestrateAnalysisParams {
  repoPath: string;
  repoInfo: RepoInfo;
  scanResult: ScanResult;
  options: BootcampOptions;
  styleConfig: StyleConfig;
  progress: ProgressTracker;
  analysisStart: number;
}

export interface OrchestratedAnalysisResult {
  facts: RepoFacts;
  analysisStats: AnalysisStats;
  durationMs: number;
  toolCalls: number;
  model: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeDeep(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch === undefined ? base : patch;
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) {
      continue;
    }

    const baseValue = merged[key];
    merged[key] =
      isPlainObject(baseValue) && isPlainObject(patchValue)
        ? mergeDeep(baseValue, patchValue)
        : patchValue;
  }

  return merged;
}

export async function orchestrateAnalysis({
  repoPath,
  repoInfo,
  scanResult,
  options,
  styleConfig,
  progress,
  analysisStart,
}: OrchestrateAnalysisParams): Promise<OrchestratedAnalysisResult> {
  const useCache = !options.noCache && !!repoInfo.commitSha;
  const cacheOptions = {
    focus: options.focus,
    style: options.style,
    model: options.model,
    audience: options.audience,
  };

  if (useCache) {
    pruneCache(7 * 24 * 60 * 60 * 1000).catch(() => {});

    const cached = await readCache(repoInfo.fullName, repoInfo.commitSha!, cacheOptions);
    if (cached) {
      const durationMs = Date.now() - analysisStart;
      const analysisStats: AnalysisStats = {
        model: "cached",
        toolCalls: [],
        totalEvents: 0,
        responseLength: 0,
        startTime: analysisStart,
        endTime: Date.now(),
      };
      progress.succeed(`Analysis loaded from cache (${repoInfo.commitSha!.substring(0, 7)})`);
      return {
        facts: cached,
        analysisStats,
        durationMs,
        toolCalls: 0,
        model: "cached",
      };
    }
  }

  const result = await analyzeRepo(repoPath, repoInfo, scanResult, options, (msg) => {
    if (msg.startsWith("Tool:")) {
      const toolName = msg.replace("Tool:", "").trim();
      progress.recordToolCall(toolName);
    }
    progress.update(msg);
  }, styleConfig);

  const durationMs = Date.now() - analysisStart;
  progress.succeed("Analysis complete");

  if (useCache) {
    try {
      await writeCache(repoInfo.fullName, repoInfo.commitSha!, result.facts, cacheOptions);
    } catch {
      // Cache write failure is non-fatal
    }
  }

  return {
    facts: result.facts,
    analysisStats: result.stats,
    durationMs,
    toolCalls: result.stats.toolCalls.length,
    model: result.stats.model,
  };
}

interface PrepareOutputDocumentsParams {
  repoPath: string;
  repoInfo: RepoInfo;
  scanResult: ScanResult;
  facts: RepoFacts;
  options: BootcampOptions;
  config: BootcampConfig | null;
  styleConfig: StyleConfig;
  progress: ProgressTracker;
}

export interface PrepareOutputDocumentsResult {
  documents: GeneratedDoc[];
  facts: RepoFacts;
  security: SecurityAnalysis;
  radar: TechRadar;
  deps: DependencyAnalysis | null;
}

export async function prepareOutputDocuments({
  repoPath,
  repoInfo,
  scanResult,
  facts,
  options,
  config,
  styleConfig,
  progress,
}: PrepareOutputDocumentsParams): Promise<PrepareOutputDocumentsResult> {
  const baseFacts: RepoFacts = {
    ...facts,
    firstTasks: facts.firstTasks.slice(0, styleConfig.firstTasksCount),
  };
  const { deps, security, radar, impacts } = await runParallelAnalysis(
    repoPath,
    scanResult,
    progress,
  );

  let diffSummary: DiffSummary | null = null;
  if (options.compare) {
    try {
      progress.update("Analyzing diff...");
      diffSummary = await analyzeDiff(repoPath, options.compare, "HEAD");
    } catch (error: unknown) {
      console.log(chalk.yellow(`  Warning: Could not generate diff: ${(error as Error).message}`));
    }
  }

  let finalFacts = baseFacts;
  let pluginDocs: GeneratedDoc[] = [];
  let pluginExtraData: Record<string, unknown> = {};
  if (config?.plugins && config.plugins.length > 0) {
    progress.update("Running plugins...");
    const plugins = await loadPlugins(config.plugins);
    const pluginOutput = await runPlugins(plugins, repoPath, scanResult, finalFacts, options);

    if (Object.keys(pluginOutput.factsPatch).length > 0) {
      finalFacts = mergeDeep(finalFacts, pluginOutput.factsPatch) as RepoFacts;
    }

    pluginDocs = pluginOutput.docs;
    pluginExtraData = pluginOutput.extraData;
  }

  const documents: GeneratedDoc[] = [
    { name: "BOOTCAMP.md", content: generateBootcamp(finalFacts, options, styleConfig) },
    { name: "ONBOARDING.md", content: generateOnboarding(finalFacts, options) },
    { name: "ARCHITECTURE.md", content: generateArchitecture(finalFacts, options) },
    { name: "CODEMAP.md", content: generateCodemap(finalFacts) },
    { name: "FIRST_TASKS.md", content: generateFirstTasks(finalFacts, options, styleConfig) },
    { name: "diagrams.mmd", content: generateDiagrams(finalFacts) },
    { name: "repo_facts.json", content: JSON.stringify(finalFacts, null, 2) },
  ];

  if (styleConfig.sections.showRunbook) {
    documents.push({ name: "RUNBOOK.md", content: generateRunbook(finalFacts) });
  }

  if (styleConfig.sections.showSecurityDetails) {
    documents.push({ name: "SECURITY.md", content: generateSecurityDocs(security, repoInfo.repo) });
  }

  if (styleConfig.sections.showRadar) {
    documents.push({ name: "RADAR.md", content: generateRadarDocs(radar, repoInfo.repo) });
  }

  if (deps && styleConfig.sections.showDependencyGraph) {
    documents.push({
      name: "DEPENDENCIES.md",
      content: generateDependencyDocs(deps, repoInfo.repo),
    });
  }

  if (impacts.length > 0 && styleConfig.sections.showImpact) {
    documents.push({
      name: "IMPACT.md",
      content: generateImpactDocs(impacts, repoInfo.repo),
    });
  }

  if (diffSummary) {
    documents.push({
      name: "DIFF.md",
      content: generateDiffDocs(diffSummary, repoInfo.repo),
    });
  }

  for (const doc of pluginDocs) {
    documents.push(doc);
  }

  if (Object.keys(pluginExtraData).length > 0) {
    const factsWithPlugins = {
      ...finalFacts,
      plugins: pluginExtraData,
    };
    const factsDoc = documents.find((d) => d.name === "repo_facts.json");
    if (factsDoc) {
      factsDoc.content = JSON.stringify(factsWithPlugins, null, 2);
    }
  }

  const excludedDocs = new Set(
    (config?.output?.excludeDocs || [])
      .map((doc) => doc.trim())
      .filter((doc) => doc.length > 0)
  );
  const includedDocuments = excludedDocs.size > 0
    ? documents.filter((doc) => !excludedDocs.has(doc.name))
    : documents;

  return {
    documents: includedDocuments,
    facts: finalFacts,
    security,
    radar,
    deps,
  };
}
