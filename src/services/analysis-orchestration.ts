import { createHash, randomUUID } from "crypto";
import { analyzeRepo, type AnalysisStats } from "../agent.js";
import { runParallelAnalysis } from "../analysis.js";
import { readCache, writeCache, type CacheGenerationOptions } from "../cache.js";
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
import { formatDocName, markdownToHtml } from "../formatter.js";
import { computeCodebaseMetrics, generateMetricsDocs, type CodebaseMetrics } from "../metrics.js";
import { computeRepoHealth, generateHealthDocs, type RepoHealth } from "../health.js";
import { loadPlugins, runPlugins, type BootcampConfig, type StyleConfig } from "../plugins.js";
import type { FormatterPlugin, OutputTargetPlugin } from "../plugin-api.js";
import { ProgressTracker } from "../progress.js";
import { generateRadarDocs } from "../radar.js";
import { generateSecurityDocs, type SecurityAnalysis } from "../security.js";
import type {
  BootcampOptions,
  DiffSummary,
  RepoFacts,
  RepoInfo,
  ScanResult,
  TechRadar,
} from "../types.js";
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

// Absolute exclusions and bounded walks may select different files across
// checkouts. Fingerprint the actual scan, including already-loaded evidence,
// without depending on a temporary clone directory or rereading source files.
function fingerprintScan(scanResult: ScanResult): string {
  const snapshot = {
    ...scanResult,
    files: [...scanResult.files].sort((a, b) => a.path.localeCompare(b.path)),
    keySourceFiles: [...scanResult.keySourceFiles].sort(([a], [b]) => a.localeCompare(b)),
  };
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function withDetectedCommands(facts: RepoFacts, scanResult: ScanResult): RepoFacts {
  if (!scanResult.commands?.length || !facts.quickstart || facts.quickstart.commands.length)
    return facts;
  return {
    ...facts,
    quickstart: {
      ...facts.quickstart,
      commands: scanResult.commands.map((command) => ({ ...command })),
    },
  };
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
  // The LLM "facts" phase is by far the most expensive step (a Copilot call
  // against a ~10-minute budget). Cache it by repo + commit + generation
  // options so a same-commit re-run — e.g. changing --format/--style, adding
  // --stats, or regenerating after a delete — can reuse the previous result
  // instead of re-paying the model. A cache key needs a commit SHA; local
  // --no-clone runs without one simply skip the cache.
  const generationOptions: CacheGenerationOptions = {
    focus: options.focus,
    style: options.style,
    model: options.model,
    audience: options.audience,
    maxFiles: options.maxFiles,
    subdir: options.subdir,
    exclude: options.exclude,
    scanFingerprint: fingerprintScan(scanResult),
  };
  const cacheEligible = !options.noCache && Boolean(repoInfo.commitSha);

  if (cacheEligible) {
    const cachedFacts = await readCache(repoInfo.fullName, repoInfo.commitSha!, generationOptions);
    if (cachedFacts) {
      progress.succeed("Analysis complete (cached)");
      // A cache hit skips the live model call, so there are no fresh tool
      // calls or model name to report; synthesize a stats object marked
      // "cache" so --stats stays well-defined and downstream code that reads
      // stats.model/toolCalls does not break.
      const cachedStats: AnalysisStats = {
        model: "cache",
        toolCalls: [],
        totalEvents: 0,
        responseLength: 0,
        startTime: analysisStart,
        endTime: Date.now(),
      };
      return {
        facts: withDetectedCommands(cachedFacts, scanResult),
        analysisStats: cachedStats,
        durationMs: Date.now() - analysisStart,
        toolCalls: 0,
        model: "cache",
      };
    }
  }

  const result = await analyzeRepo(
    repoPath,
    repoInfo,
    scanResult,
    options,
    (msg) => {
      if (msg.startsWith("Tool:")) {
        const toolName = msg.replace("Tool:", "").trim();
        progress.recordToolCall(toolName);
      }
      progress.update(msg);
    },
    styleConfig
  );

  const durationMs = Date.now() - analysisStart;
  progress.succeed("Analysis complete");

  if (cacheEligible) {
    // Persist on a miss so the next same-commit run is a hit. Failures are
    // swallowed by writeCache's own error handling — caching is best-effort.
    await writeCache(repoInfo.fullName, repoInfo.commitSha!, result.facts, generationOptions);
  }

  return {
    facts: withDetectedCommands(result.facts, scanResult),
    analysisStats: result.stats,
    durationMs,
    toolCalls: result.stats.toolCalls.length,
    model: result.stats.model,
  };
}

interface PrepareOutputDocumentsParams {
  repoPath: string;
  /** Outer checkout for Git operations whose paths are repository-relative. */
  repositoryRoot?: string;
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
  metrics: CodebaseMetrics;
  health: RepoHealth;
  outputTargets: OutputTargetPlugin[];
}

export async function prepareOutputDocuments({
  repoPath,
  repositoryRoot,
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
  const { deps, security, radar, impacts, cycles } = await runParallelAnalysis(
    repoPath,
    scanResult,
    progress,
    {
      repoFullName: repoInfo.fullName,
      commitSha: repoInfo.commitSha,
      noCache: options.noCache,
      generationOptions: {
        focus: options.focus,
        style: options.style,
        model: options.model,
        audience: options.audience,
        maxFiles: options.maxFiles,
        subdir: options.subdir,
        exclude: options.exclude,
        scanFingerprint: fingerprintScan(scanResult),
      },
    }
  );

  let diffSummary: DiffSummary | null = null;
  if (options.compare) {
    try {
      progress.update("Analyzing diff...");
      diffSummary = await analyzeDiff(repositoryRoot ?? repoPath, options.compare, "HEAD");
    } catch (error: unknown) {
      console.log(chalk.yellow(`  Warning: Could not generate diff: ${(error as Error).message}`));
    }
  }

  let finalFacts = baseFacts;
  let pluginDocs: GeneratedDoc[] = [];
  let pluginExtraData: Record<string, unknown> = {};
  let pluginFormatters: FormatterPlugin[] = [];
  let pluginOutputTargets: OutputTargetPlugin[] = [];
  if (config?.plugins && config.plugins.length > 0) {
    progress.update("Running plugins...");
    const plugins = await loadPlugins(config.plugins);
    const pluginOutput = await runPlugins(plugins, repoPath, scanResult, finalFacts, options);

    if (Object.keys(pluginOutput.factsPatch).length > 0) {
      finalFacts = mergeDeep(finalFacts, pluginOutput.factsPatch) as RepoFacts;
    }

    pluginDocs = pluginOutput.docs;
    pluginExtraData = pluginOutput.extraData;
    pluginFormatters = pluginOutput.formatters ?? [];
    pluginOutputTargets = pluginOutput.outputTargets ?? [];
  }

  const metrics = computeCodebaseMetrics(scanResult);
  const health = computeRepoHealth(scanResult);

  const overview: GeneratedDoc = { name: "BOOTCAMP.md", content: "" };
  const documents: GeneratedDoc[] = [
    overview,
    {
      name: "ONBOARDING.md",
      content: generateOnboarding(finalFacts, options, {
        repoInfo,
        localPath: repoInfo.url.startsWith("file://") ? repoPath : undefined,
        ...(!repoInfo.url.startsWith("file://") && options.branch ? { ref: options.branch } : {}),
      }),
    },
    { name: "ARCHITECTURE.md", content: generateArchitecture(finalFacts, options, repoInfo) },
    { name: "CODEMAP.md", content: generateCodemap(finalFacts, repoInfo) },
    {
      name: "FIRST_TASKS.md",
      content: generateFirstTasks(finalFacts, options, styleConfig, repoInfo),
    },
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
      content: generateImpactDocs(impacts, repoInfo.repo, cycles),
    });
  }

  if (styleConfig.sections.showMetrics) {
    documents.push({
      name: "METRICS.md",
      content: generateMetricsDocs(metrics, repoInfo.repo),
    });
  }

  if (styleConfig.sections.showHealth) {
    documents.push({
      name: "HEALTH.md",
      content: generateHealthDocs(health, repoInfo.repo),
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
    (config?.output?.excludeDocs || []).map((doc) => doc.trim()).filter((doc) => doc.length > 0)
  );
  let includedDocuments =
    excludedDocs.size > 0 ? documents.filter((doc) => !excludedDocs.has(doc.name)) : documents;

  // A formatter may drop or rename documents, but it may also explicitly edit
  // the overview. Mark only our generated navigation while it runs, then refresh
  // that region if untouched. Facts/plugin prose is never searched for links.
  const navigationId = randomUUID();
  const navigationMarkers = [
    `<!-- bootcamp-navigation:${navigationId}:start -->`,
    `<!-- bootcamp-navigation:${navigationId}:end -->`,
  ] as const;
  const renderOverview = (docs: GeneratedDoc[]) =>
    generateBootcamp(finalFacts, options, styleConfig, {
      availableDocuments: new Set(
        docs.flatMap((doc) =>
          doc.name.endsWith(".html") ? [doc.name, doc.name.slice(0, -5) + ".md"] : [doc.name]
        )
      ),
      navigationMarkers,
    });
  overview.content = renderOverview(includedDocuments);
  const escapedMarkers = navigationMarkers.map((marker) =>
    marker.replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  );
  const region = (content: string, markers: readonly string[] = navigationMarkers) => {
    const start = content.indexOf(markers[0]);
    const end = content.indexOf(markers[1], start + markers[0].length);
    return start < 0 || end < 0
      ? null
      : {
          start,
          end: end + markers[1].length,
          body: content.slice(start + markers[0].length, end),
        };
  };
  const originalNavigation = region(overview.content);
  // Only these generated links are rewritten. An arbitrary formatter rename
  // cannot establish a new target; the canonical HTML name can, because our
  // own output formatter uses it for both HTML and PDF-ready exports.
  const destination = (name: string, docs: GeneratedDoc[]) => {
    const actual = docs.some((doc) => doc.name === name)
      ? name
      : docs.some((doc) => doc.name === name.replace(/\.md$/, ".html"))
        ? name.replace(/\.md$/, ".html")
        : name;
    return formatDocName(actual, options.format ?? "markdown");
  };
  const markdownNavigation = (body: string, docs: GeneratedDoc[]) =>
    body.replace(
      /\]\(\.\/([A-Z_]+\.md)\)/g,
      (_, name: string) => `](./${destination(name, docs)})`
    );
  const htmlBody = (body: string) => {
    const rendered = markdownToHtml(body.trim());
    return rendered ? `\n${rendered}\n` : "\n";
  };
  const htmlNavigation = (body: string, docs: GeneratedDoc[]) =>
    htmlBody(markdownNavigation(body, docs));
  const originalHtmlNavigation = originalNavigation ? htmlBody(originalNavigation.body) : null;
  const canonicalHtmlNavigation = (body: string) =>
    body.replace(/href="\.\/([A-Z_]+)\.html"/g, 'href="./$1.md"');

  for (const formatter of pluginFormatters) {
    try {
      includedDocuments = await formatter.formatDocuments(includedDocuments, {
        repoPath,
        repoInfo,
        scanResult,
        facts: finalFacts,
        options,
      });
    } catch (error: unknown) {
      console.warn(`Formatter plugin ${formatter.name} failed: ${(error as Error).message}`);
    }
  }

  const finalNavigation = originalNavigation ? region(renderOverview(includedDocuments)) : null;
  includedDocuments = includedDocuments.map((doc) => {
    const rawRegion = region(doc.content);
    const htmlRegion = region(doc.content, escapedMarkers);
    const current = rawRegion ?? htmlRegion;
    let content = doc.content;
    if (
      current &&
      originalNavigation &&
      finalNavigation &&
      (rawRegion ? current.body : canonicalHtmlNavigation(current.body)) ===
        (rawRegion ? originalNavigation.body : originalHtmlNavigation)
    ) {
      content =
        content.slice(0, current.start) +
        (rawRegion
          ? markdownNavigation(finalNavigation.body, includedDocuments).slice(1, -1)
          : htmlNavigation(finalNavigation.body, includedDocuments).slice(1, -1)) +
        content.slice(current.end);
    }
    // Markers never reach written documents, including formatter-owned regions.
    for (const marker of [...navigationMarkers, ...escapedMarkers])
      content = content.replaceAll(marker, "");
    return content === doc.content ? doc : { ...doc, content };
  });

  return {
    documents: includedDocuments,
    facts: finalFacts,
    security,
    radar,
    deps,
    metrics,
    health,
    outputTargets: pluginOutputTargets,
  };
}
