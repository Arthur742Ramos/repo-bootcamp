import chalk from "chalk";
import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";

import { analyzeRepo, type AnalysisStats } from "../agent.js";
import { formatDocName, type OutputFormat } from "../formatter.js";
import { parseGitHubUrl, isWorkingTreeDirty } from "../ingest.js";
import { runInteractiveMode } from "../interactive.js";
import type { BootcampConfig } from "../plugins.js";
import { ProgressTracker } from "../progress.js";
import { getRiskEmoji } from "../radar.js";
import { isLocalPath, resolveRepo, type RepoSource } from "../repo-resolver.js";
import { getSecurityGrade } from "../security.js";
import { createAnalysisManifest } from "../manifest.js";
import {
  cloneRepository,
  cleanupRepository,
  scanRepositoryFiles,
} from "../services/clone-service.js";
import { updateSourcePathPrefix } from "../services/scan-scope.js";
import { resolveRunConfiguration } from "../services/config-resolution.js";
import { orchestrateAnalysis, prepareOutputDocuments } from "../services/analysis-orchestration.js";
import { writeGeneratedOutputs } from "../services/output-writer.js";
import type { BootcampOptions, RepoFacts, RepoInfo, ScanResult } from "../types.js";
import type { StyleConfig } from "../plugins.js";
import { startWatch } from "../watch.js";

interface RunStats {
  cloneTime: number;
  scanTime: number;
  analysisTime: number;
  generateTime: number;
  totalTime: number;
  filesScanned: number;
  toolCalls: number;
  model: string;
}

interface GenerationResult {
  emittedFiles: string[];
  security: Awaited<ReturnType<typeof prepareOutputDocuments>>["security"];
  radar: Awaited<ReturnType<typeof prepareOutputDocuments>>["radar"];
  deps: Awaited<ReturnType<typeof prepareOutputDocuments>>["deps"];
  metrics: Awaited<ReturnType<typeof prepareOutputDocuments>>["metrics"];
  health: Awaited<ReturnType<typeof prepareOutputDocuments>>["health"];
}

interface GenerateOutputsParams {
  repoPath: string;
  repositoryRoot?: string;
  repoInfo: RepoInfo;
  scanResult: ScanResult;
  facts: RepoFacts;
  options: BootcampOptions;
  config: BootcampConfig | null;
  styleConfig: StyleConfig;
  outputDir: string;
  outputFormat: OutputFormat;
  progress: ProgressTracker;
  allowIssueCreation?: boolean;
}

interface WriteRunSummaryParams {
  outputDir: string;
  repoInfo: RepoInfo;
  emittedFiles: string[];
  security: GenerationResult["security"];
  radar: GenerationResult["radar"];
  deps: GenerationResult["deps"];
  metrics: GenerationResult["metrics"];
  health: GenerationResult["health"];
}

/**
 * Write a machine-readable summary.json alongside the markdown kit so CI/tools
 * can read the deterministic scores (security, onboarding risk, approachability,
 * health) and dependency counts without re-running the separate `scan` command.
 * Guarded per-field so a missing score object (e.g. metrics off) never throws.
 */
async function writeRunSummary({
  outputDir,
  repoInfo,
  emittedFiles,
  security,
  radar,
  deps,
  metrics,
  health,
}: WriteRunSummaryParams): Promise<void> {
  const summary = {
    repo: repoInfo.fullName,
    commitSha: repoInfo.commitSha ?? null,
    generatedAt: new Date().toISOString(),
    files: emittedFiles,
    scores: {
      security: security
        ? {
            score: security.score,
            grade: getSecurityGrade(security.score, security.sourceFilesScanned),
          }
        : null,
      onboardingRisk: radar?.onboardingRisk
        ? { score: radar.onboardingRisk.score, grade: radar.onboardingRisk.grade }
        : null,
      approachability: metrics?.approachability
        ? { score: metrics.approachability.score, grade: metrics.approachability.grade }
        : null,
      health: health
        ? {
            score: health.score,
            grade: health.grade,
            passCount: health.passCount,
            warnCount: health.warnCount,
            failCount: health.failCount,
          }
        : null,
    },
    deps: deps
      ? { total: deps.totalCount, runtime: deps.runtime.length, dev: deps.dev.length }
      : { total: 0, runtime: 0, dev: 0 },
  };

  await writeFile(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
}

async function generateOutputs({
  repoPath,
  repositoryRoot,
  repoInfo,
  scanResult,
  facts,
  options,
  config,
  styleConfig,
  outputDir,
  outputFormat,
  progress,
  allowIssueCreation = true,
}: GenerateOutputsParams): Promise<GenerationResult> {
  const {
    documents,
    facts: preparedFacts,
    security,
    radar,
    deps,
    metrics,
    health,
    outputTargets,
  } = await prepareOutputDocuments({
    repoPath,
    repositoryRoot,
    repoInfo,
    scanResult,
    facts,
    options,
    config,
    styleConfig,
    progress,
  });

  const { emittedFiles } = await writeGeneratedOutputs({
    documents,
    repoInfo,
    facts: preparedFacts,
    options,
    outputDir,
    outputFormat,
    progress,
    allowIssueCreation,
    outputTargets,
  });

  return {
    emittedFiles,
    security,
    radar,
    deps,
    metrics,
    health,
  };
}

/** Finalize run-owned metadata before reporting a successful completion. */
async function finalizeOutputs(
  generation: GenerationResult,
  outputDir: string,
  repoInfo: RepoInfo,
  manifest: ReturnType<typeof createAnalysisManifest>
): Promise<string[]> {
  await writeFile(
    join(outputDir, "ANALYSIS_MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
  const emittedFiles = [
    ...new Set([...generation.emittedFiles, "ANALYSIS_MANIFEST.json", "summary.json"]),
  ];
  await writeRunSummary({ outputDir, repoInfo, ...generation, emittedFiles });
  return emittedFiles;
}

const DOCUMENT_DESCRIPTIONS: [string, string][] = [
  ["BOOTCAMP.md", "1-page overview (start here!)"],
  ["ONBOARDING.md", "Full setup guide"],
  ["ARCHITECTURE.md", "System design & diagrams"],
  ["CODEMAP.md", "Directory tour"],
  ["FIRST_TASKS.md", "Starter issues"],
  ["RUNBOOK.md", "Operations guide"],
  ["DEPENDENCIES.md", "Dependency graph"],
  ["SECURITY.md", "Security findings"],
  ["RADAR.md", "Tech radar & risk score"],
  ["IMPACT.md", "Change impact analysis"],
  ["METRICS.md", "Codebase metrics & hotspots"],
  ["HEALTH.md", "Onboarding-readiness health check"],
  ["DIFF.md", "Version comparison"],
];
const ARTIFACT_DESCRIPTIONS: [string, string][] = [
  ["diagrams.mmd", "Mermaid diagrams"],
  ["repo_facts.json", "Structured data"],
  ["summary.json", "Scores & emitted files"],
  ["ANALYSIS_MANIFEST.json", "Run metadata & evidence"],
];

function printGeneratedFiles(emittedFiles: string[]): void {
  const known = (descriptions: [string, string][]) =>
    descriptions.flatMap(([name, description]) =>
      emittedFiles
        .filter(
          (file) => file === name || (name.endsWith(".md") && file === formatDocName(name, "html"))
        )
        .map((file) => [file, description] as const)
    );
  const documents = known(DOCUMENT_DESCRIPTIONS);
  const artifacts = known(ARTIFACT_DESCRIPTIONS);
  const named = new Set([...documents, ...artifacts].map(([name]) => name));
  const extraFiles = emittedFiles
    .filter((name) => !named.has(name))
    .map((name) => [name, ""] as const);
  const rows = [...documents, ...extraFiles, ...artifacts];
  console.log(chalk.dim("  Generated files:"));
  rows.forEach(([name, description], index) => {
    console.log(
      chalk.white(index === rows.length - 1 ? "  └── " : "  ├── ") +
        chalk.cyan(name) +
        (description ? chalk.dim(`  → ${description}`) : "")
    );
  });
  console.log();
}

function nextStepFile(emittedFiles: string[]): string | undefined {
  return (
    emittedFiles.find((name) => name === "BOOTCAMP.md" || name === "BOOTCAMP.html") ??
    emittedFiles.find((name) => /\.(md|html)$/.test(name)) ??
    emittedFiles.find((name) => name === "repo_facts.json") ??
    emittedFiles[0]
  );
}

export async function runMainCommand(repoUrl: string, options: BootcampOptions): Promise<void> {
  const quiet = options.quiet === true;
  const progress = new ProgressTracker(options.verbose, quiet);
  const runStats: Partial<RunStats> = {};
  const startTime = Date.now();

  const { config, styleConfig, outputFormat } = await resolveRunConfiguration(options);

  if (!quiet) {
    console.log(
      chalk.cyan(`
  ╦═╗╔═╗╔═╗╔═╗  ╔╗ ╔═╗╔═╗╔╦╗╔═╗╔═╗╔╦╗╔═╗
  ╠╦╝║╣ ╠═╝║ ║  ╠╩╗║ ║║ ║ ║ ║  ╠═╣║║║╠═╝
  ╩╚═╚═╝╩  ╚═╝  ╚═╝╚═╝╚═╝ ╩ ╚═╝╩ ╩╩ ╩╩
  `)
    );
    console.log(chalk.white.bold("  Turn any repo into a Day 1 onboarding kit\n"));

    console.log(chalk.dim("─".repeat(50)));
    console.log(chalk.white(`  Repository:  ${chalk.cyan(repoUrl)}`));
    console.log(chalk.white(`  Branch:      ${chalk.cyan(options.branch || "default")}`));
    console.log(chalk.white(`  Focus:       ${chalk.cyan(options.focus)}`));
    console.log(chalk.white(`  Audience:    ${chalk.cyan(options.audience)}`));
    console.log(chalk.white(`  Style:       ${chalk.cyan(styleConfig.name)}`));
    console.log(chalk.white(`  Format:      ${chalk.cyan(outputFormat)}`));
    if (options.model) {
      console.log(chalk.white(`  Model:       ${chalk.cyan(options.model)}`));
    }
    if (options.compare) {
      console.log(chalk.white(`  Compare:     ${chalk.cyan(options.compare)}`));
    }
    console.log(chalk.dim("─".repeat(50)));
    console.log();

    ProgressTracker.printPhaseOverview();
  }

  let repoInfo: RepoInfo;
  let repoSource: RepoSource | null = null;
  try {
    if (options.noClone) {
      if (!isLocalPath(repoUrl)) {
        throw new Error("--no-clone requires a local directory path (for example: ./my-repo)");
      }
      repoSource = await resolveRepo(repoUrl, process.cwd(), options.branch || undefined);
      repoInfo = repoSource.repoInfo;
    } else {
      repoInfo = parseGitHubUrl(repoUrl);
    }
    const targetLabel = repoSource?.isLocal ? repoSource.path : repoInfo.fullName;
    if (!quiet) {
      console.log(chalk.white(`Target: ${chalk.bold(targetLabel)}`));
      console.log();
    }
  } catch (error: unknown) {
    console.error(chalk.red(`Failed to resolve repository: ${(error as Error).message}`));
    process.exit(1);
  }

  const outputDir = options.output || `./bootcamp-${repoInfo.repo}`;

  const cloneStart = Date.now();
  progress.startPhase("clone", repoSource?.isLocal ? "local repository" : repoInfo.fullName);
  let repoPath: string;
  try {
    if (repoSource?.isLocal) {
      repoPath = repoSource.path;
      progress.succeed(`Using local repository: ${repoPath}`);
    } else {
      repoPath = await cloneRepository(repoInfo, options.branch, options.fullClone);
      progress.succeed(`Cloned ${repoInfo.fullName} (branch: ${repoInfo.branch})`);
    }
    runStats.cloneTime = Date.now() - cloneStart;
  } catch (error: unknown) {
    progress.fail(
      `${repoSource?.isLocal ? "Local repo setup" : "Clone"} failed: ${(error as Error).message}`
    );
    process.exit(1);
  }

  const cleanupFailedRun = async (): Promise<void> => {
    if (repoSource?.isLocal || options.keepTemp) {
      return;
    }
    try {
      await cleanupRepository(repoPath);
    } catch (cleanupError: unknown) {
      console.error(
        chalk.yellow(
          `Could not clean up temporary files after failure: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }`
        )
      );
    }
  };

  const scanStart = Date.now();
  progress.startPhase("scan", `max ${options.maxFiles} files`);
  // `--exclude`/`--subdir` scope the walk (normalized in resolveRunConfiguration);
  // keep the plain two-argument scan call when neither is set.
  const scanScope =
    (options.exclude && options.exclude.length > 0) || options.subdir
      ? { exclude: options.exclude, subdir: options.subdir }
      : undefined;
  let scanResult: ScanResult;
  try {
    scanResult = scanScope
      ? await scanRepositoryFiles(repoPath, options.maxFiles, scanScope)
      : await scanRepositoryFiles(repoPath, options.maxFiles);
    await updateSourcePathPrefix(repoPath, options.subdir, repoInfo);
    runStats.scanTime = Date.now() - scanStart;
    runStats.filesScanned = scanResult.files.length;
    progress.succeed(
      `Scanned ${scanResult.files.length} files (${scanResult.keySourceFiles.size} key files read)`
    );
  } catch (error: unknown) {
    progress.fail(`Scan failed: ${(error as Error).message}`);
    await cleanupFailedRun();
    process.exit(1);
  }

  if (!quiet) {
    console.log(chalk.cyan("\nDetected Stack:"));
    console.log(chalk.white(`  Languages: ${scanResult.stack.languages.join(", ") || "Unknown"}`));
    console.log(chalk.white(`  Frameworks: ${scanResult.stack.frameworks.join(", ") || "None"}`));
    console.log(chalk.white(`  Build: ${scanResult.stack.buildSystem || "Unknown"}`));
    console.log(chalk.white(`  CI: ${scanResult.stack.hasCi ? "Yes" : "No"}`));
    console.log(chalk.white(`  Docker: ${scanResult.stack.hasDocker ? "Yes" : "No"}`));
    console.log();
  }

  // The scanner validated the selected directory before returning relative
  // paths. Every file-reading consumer must resolve those paths from it.
  // Keep repoPath as the outer checkout for clone cleanup and Git watching.
  const analysisRepoPath = options.subdir ? resolve(repoPath, options.subdir) : repoPath;

  const analysisStart = Date.now();
  progress.startPhase("analyze");
  let facts!: RepoFacts;
  let analysisStats!: AnalysisStats;

  try {
    const analysis = await orchestrateAnalysis({
      repoPath: analysisRepoPath,
      repoInfo,
      scanResult,
      options,
      styleConfig,
      progress,
      analysisStart,
    });
    facts = {
      ...analysis.facts,
      firstTasks: analysis.facts.firstTasks.slice(0, styleConfig.firstTasksCount),
    };
    // Merge scan-detected packageManager as fallback if AI didn't provide one
    if (!facts.stack.packageManager && scanResult.stack.packageManager) {
      facts.stack.packageManager = scanResult.stack.packageManager;
    }
    analysisStats = analysis.analysisStats;
    runStats.analysisTime = analysis.durationMs;
    runStats.toolCalls = analysis.toolCalls;
    runStats.model = analysis.model;
  } catch (error: unknown) {
    progress.fail(`Analysis failed: ${(error as Error).message}`);
    console.log(chalk.yellow("\nTip: Make sure you're authenticated with GitHub Copilot"));
    console.log(chalk.gray("Run: gh auth status"));
    await cleanupFailedRun();
    process.exit(1);
  }

  try {
    await mkdir(outputDir, { recursive: true });
  } catch (error: unknown) {
    console.error(chalk.red(`Failed to create output directory: ${(error as Error).message}`));
    await cleanupFailedRun();
    process.exit(1);
  }

  let emittedFiles: string[] = [];
  const generateStart = Date.now();
  progress.startPhase("generate", options.jsonOnly ? "JSON only" : "Writing selected documents");
  try {
    const generation = await generateOutputs({
      repoPath: analysisRepoPath,
      repositoryRoot: repoPath,
      repoInfo,
      scanResult,
      facts,
      options,
      config,
      styleConfig,
      outputDir,
      outputFormat,
      progress,
    });

    const { security, radar, deps, metrics, health } = generation;

    const manifest = createAnalysisManifest({
      repoInfo,
      scanResult,
      facts,
      options,
      format: outputFormat,
      durationMs: Date.now() - startTime,
      model: analysisStats.model,
      toolCalls: analysisStats.toolCalls.length,
    });
    emittedFiles = await finalizeOutputs(generation, outputDir, repoInfo, manifest);

    runStats.generateTime = Date.now() - generateStart;
    progress.succeed(`Generated ${emittedFiles.length} files (including manifest)`);

    if (!quiet && !options.jsonOnly) {
      const grade = getSecurityGrade(security.score, security.sourceFilesScanned);
      const scoreColor =
        security.score >= 80 ? chalk.green : security.score >= 60 ? chalk.yellow : chalk.red;
      console.log(
        chalk.cyan("\nSecurity Score: ") + scoreColor(`${security.score}/100 (${grade})`)
      );

      const riskEmoji = getRiskEmoji(radar.onboardingRisk.grade);
      const riskColor =
        radar.onboardingRisk.score <= 25
          ? chalk.green
          : radar.onboardingRisk.score <= 50
            ? chalk.yellow
            : chalk.red;
      console.log(
        chalk.cyan("Onboarding Risk: ") +
          riskColor(
            `${radar.onboardingRisk.score}/100 (${radar.onboardingRisk.grade}) ${riskEmoji}`
          )
      );

      if (deps) {
        console.log(
          chalk.cyan("Dependencies: ") +
            chalk.white(
              `${deps.totalCount} total (${deps.runtime.length} runtime, ${deps.dev.length} dev)`
            )
        );
      }

      if (styleConfig.sections.showMetrics) {
        const appr = metrics.approachability;
        const apprColor =
          appr.score >= 80 ? chalk.green : appr.score >= 60 ? chalk.yellow : chalk.red;
        console.log(
          chalk.cyan("Codebase: ") +
            chalk.white(`${metrics.totalFiles} files, ${metrics.sourceFiles} source`) +
            chalk.dim(" · ") +
            chalk.cyan("approachability ") +
            apprColor(`${appr.score}/100 (${appr.grade})`)
        );
      }

      if (styleConfig.sections.showHealth) {
        const healthColor =
          health.score >= 80 ? chalk.green : health.score >= 60 ? chalk.yellow : chalk.red;
        console.log(
          chalk.cyan("Repo Health: ") +
            healthColor(`${health.score}/100 (${health.grade})`) +
            chalk.dim(
              ` · ${health.passCount} passed, ${health.warnCount} warnings, ${health.failCount} missing`
            )
        );
      }
    }
  } catch (error: unknown) {
    progress.fail(`Document generation failed: ${(error as Error).message}`);
    await cleanupFailedRun();
    process.exit(1);
  }

  const interactiveRepoPath = analysisRepoPath;
  const interactiveScanResult = scanResult;
  const shouldCleanupRepo = !repoSource?.isLocal;

  if (shouldCleanupRepo && !options.keepTemp && !options.interactive && !options.watch) {
    progress.startPhase("cleanup");
    try {
      await cleanupRepository(repoPath);
      progress.succeed("Cleanup complete");
    } catch {
      progress.warn("Could not clean up temporary files");
    }
  } else if (options.interactive && shouldCleanupRepo) {
    if (!quiet) console.log(chalk.gray(`Keeping clone for interactive mode: ${repoPath}`));
  } else if (shouldCleanupRepo) {
    if (!quiet) console.log(chalk.gray(`Temporary clone kept at: ${repoPath}`));
  } else {
    if (!quiet) console.log(chalk.gray(`Using local repository path: ${repoPath}`));
  }

  progress.stop();
  runStats.totalTime = Date.now() - startTime;

  if (quiet) {
    // Minimal, script-friendly completion line. The output directory is the
    // one piece of information a non-interactive caller needs.
    if (!options.jsonOnly) {
      console.log(outputDir);
    }
  } else {
    console.log();
    console.log(chalk.green("  ╔══════════════════════════════════════════════════════╗"));
    console.log(
      chalk.green("  ║") +
        chalk.white.bold("        ✓ Bootcamp Generated Successfully!           ") +
        chalk.green("║")
    );
    console.log(chalk.green("  ╚══════════════════════════════════════════════════════╝"));
    console.log();
  }
  if (!quiet) {
    console.log(chalk.white(`  📁 Output: ${chalk.cyan.bold(outputDir + "/")}`));
    console.log();
  }

  if (!quiet && !options.jsonOnly) {
    printGeneratedFiles(emittedFiles);
  }

  if (options.stats) {
    console.log(chalk.dim("  ─────────────────────────────────────────"));
    console.log(chalk.white.bold("  📊 Statistics"));
    console.log(chalk.white(`     Model:         ${chalk.cyan(runStats.model)}`));
    console.log(chalk.white(`     Files scanned: ${chalk.cyan(runStats.filesScanned)}`));
    console.log(chalk.white(`     Tool calls:    ${chalk.cyan(runStats.toolCalls)}`));
    console.log(
      chalk.white(
        `     Total time:    ${chalk.cyan((runStats.totalTime! / 1000).toFixed(1) + "s")}`
      )
    );
    console.log(chalk.dim(`       ├── Clone:    ${(runStats.cloneTime! / 1000).toFixed(1)}s`));
    console.log(chalk.dim(`       ├── Scan:     ${(runStats.scanTime! / 1000).toFixed(1)}s`));
    console.log(chalk.dim(`       ├── Analyze:  ${(runStats.analysisTime! / 1000).toFixed(1)}s`));
    console.log(chalk.dim(`       └── Generate: ${(runStats.generateTime! / 1000).toFixed(1)}s`));
    console.log();

    if (analysisStats.toolCalls.length > 0) {
      console.log(chalk.cyan("Tool calls made:"));
      for (const call of analysisStats.toolCalls) {
        console.log(chalk.gray(`  ${call.name}: ${call.args}`));
      }
      console.log();
    }
  }

  const nextFile = nextStepFile(emittedFiles);
  if (!quiet && nextFile) {
    console.log(
      chalk.white("  🚀 ") +
        chalk.white.bold("Next step: ") +
        chalk.cyan(`open ${outputDir}/${nextFile}`)
    );
    console.log();
  }

  if (options.watch) {
    const watchHandle = startWatch(repoPath, {
      intervalSeconds: options.watchInterval || 30,
      allowHardReset: options.watchForce || false,
      verbose: options.verbose,
      onChangeDetected: async (commitSha) => {
        // Preserve the initial run metadata while giving regenerated manifests
        // and phase caches the commit that watch just checked out.
        if (commitSha) repoInfo = { ...repoInfo, commitSha };
        const wp = new ProgressTracker(options.verbose, quiet);

        wp.startPhase("scan", `max ${options.maxFiles} files`);
        const newScan = scanScope
          ? await scanRepositoryFiles(repoPath, options.maxFiles, scanScope)
          : await scanRepositoryFiles(repoPath, options.maxFiles);
        await updateSourcePathPrefix(repoPath, options.subdir, repoInfo);
        wp.succeed(`Scanned ${newScan.files.length} files`);

        // Local edits may survive a non-conflicting checkout update. Record
        // HEAD in artifacts, but never cache modified working-tree results.
        const watchOptions = {
          ...options,
          noCache: Boolean(options.noCache) || (await isWorkingTreeDirty(repoPath)),
        };
        wp.startPhase("analyze");
        const result = await analyzeRepo(
          analysisRepoPath,
          repoInfo,
          newScan,
          watchOptions,
          (msg) => {
            wp.update(msg);
          },
          styleConfig
        );
        const styledFacts = {
          ...result.facts,
          firstTasks: result.facts.firstTasks.slice(0, styleConfig.firstTasksCount),
        };
        wp.succeed("Analysis complete");

        wp.startPhase("generate", options.jsonOnly ? "JSON only" : "Writing selected documents");
        const generation = await generateOutputs({
          repoPath: analysisRepoPath,
          repositoryRoot: repoPath,
          repoInfo,
          scanResult: newScan,
          facts: styledFacts,
          options: watchOptions,
          config,
          styleConfig,
          outputDir,
          outputFormat,
          progress: wp,
          allowIssueCreation: false,
        });
        const manifest = createAnalysisManifest({
          repoInfo,
          scanResult: newScan,
          facts: styledFacts,
          options: watchOptions,
          format: outputFormat,
          durationMs: result.stats.endTime ? result.stats.endTime - result.stats.startTime : 0,
          model: result.stats.model,
          toolCalls: result.stats.toolCalls.length,
        });
        const regeneratedFiles = await finalizeOutputs(generation, outputDir, repoInfo, manifest);
        wp.succeed(`Regenerated ${regeneratedFiles.length} files (including manifest)`);
        wp.stop();
      },
    });

    const onSignal = () => {
      watchHandle.stop();
      console.log(chalk.dim("\n  Watch mode stopped."));
      process.exit(0);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    await new Promise<void>(() => {});
    return;
  }

  if (options.interactive) {
    try {
      await runInteractiveMode(
        interactiveRepoPath,
        repoInfo,
        interactiveScanResult,
        outputDir,
        facts,
        { verbose: options.verbose, saveTranscript: options.transcript, model: options.model }
      );
    } finally {
      if (!options.keepTemp && shouldCleanupRepo) {
        try {
          await cleanupRepository(repoPath);
        } catch {
          // Best-effort cleanup must not replace an interactive failure.
        }
      }
    }
  } else {
    process.exit(0);
  }
}
