import chalk from "chalk";
import { mkdir } from "fs/promises";

import { analyzeRepo, type AnalysisStats } from "../agent.js";
import { formatDocName, type OutputFormat } from "../formatter.js";
import { parseGitHubUrl } from "../ingest.js";
import { runInteractiveMode } from "../interactive.js";
import type { BootcampConfig } from "../plugins.js";
import { ProgressTracker } from "../progress.js";
import { getRiskEmoji } from "../radar.js";
import { isLocalPath, resolveRepo, type RepoSource } from "../repo-resolver.js";
import { getSecurityGrade } from "../security.js";
import { cloneRepository, cleanupRepository, scanRepositoryFiles } from "../services/clone-service.js";
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
  documentCount: number;
  security: Awaited<ReturnType<typeof prepareOutputDocuments>>["security"];
  radar: Awaited<ReturnType<typeof prepareOutputDocuments>>["radar"];
  deps: Awaited<ReturnType<typeof prepareOutputDocuments>>["deps"];
  metrics: Awaited<ReturnType<typeof prepareOutputDocuments>>["metrics"];
  health: Awaited<ReturnType<typeof prepareOutputDocuments>>["health"];
}

interface GenerateOutputsParams {
  repoPath: string;
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

async function generateOutputs({
  repoPath,
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
  const { documents, facts: preparedFacts, security, radar, deps, metrics, health, outputTargets } = await prepareOutputDocuments({
    repoPath,
    repoInfo,
    scanResult,
    facts,
    options,
    config,
    styleConfig,
    progress,
  });

  const { documentCount } = await writeGeneratedOutputs({
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
    documentCount,
    security,
    radar,
    deps,
    metrics,
    health,
  };
}

export async function runMainCommand(repoUrl: string, options: BootcampOptions): Promise<void> {
  const progress = new ProgressTracker(options.verbose);
  const runStats: Partial<RunStats> = {};
  const startTime = Date.now();

  const { config, styleConfig, outputFormat } = await resolveRunConfiguration(options);

  console.log(chalk.cyan(`
  ╦═╗╔═╗╔═╗╔═╗  ╔╗ ╔═╗╔═╗╔╦╗╔═╗╔═╗╔╦╗╔═╗
  ╠╦╝║╣ ╠═╝║ ║  ╠╩╗║ ║║ ║ ║ ║  ╠═╣║║║╠═╝
  ╩╚═╚═╝╩  ╚═╝  ╚═╝╚═╝╚═╝ ╩ ╚═╝╩ ╩╩ ╩╩  
  `));
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
    console.log(chalk.white(`Target: ${chalk.bold(targetLabel)}`));
    console.log();
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
    progress.fail(`${repoSource?.isLocal ? "Local repo setup" : "Clone"} failed: ${(error as Error).message}`);
    process.exit(1);
  }

  const scanStart = Date.now();
  progress.startPhase("scan", `max ${options.maxFiles} files`);
  let scanResult: ScanResult;
  try {
    scanResult = await scanRepositoryFiles(repoPath, options.maxFiles);
    runStats.scanTime = Date.now() - scanStart;
    runStats.filesScanned = scanResult.files.length;
    progress.succeed(`Scanned ${scanResult.files.length} files (${scanResult.keySourceFiles.size} key files read)`);
  } catch (error: unknown) {
    progress.fail(`Scan failed: ${(error as Error).message}`);
    process.exit(1);
  }

  console.log(chalk.cyan("\nDetected Stack:"));
  console.log(chalk.white(`  Languages: ${scanResult.stack.languages.join(", ") || "Unknown"}`));
  console.log(chalk.white(`  Frameworks: ${scanResult.stack.frameworks.join(", ") || "None"}`));
  console.log(chalk.white(`  Build: ${scanResult.stack.buildSystem || "Unknown"}`));
  console.log(chalk.white(`  CI: ${scanResult.stack.hasCi ? "Yes" : "No"}`));
  console.log(chalk.white(`  Docker: ${scanResult.stack.hasDocker ? "Yes" : "No"}`));
  console.log();

  const analysisStart = Date.now();
  progress.startPhase("analyze");
  let facts!: RepoFacts;
  let analysisStats!: AnalysisStats;

  try {
    const analysis = await orchestrateAnalysis({
      repoPath,
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
    process.exit(1);
  }

  try {
    await mkdir(outputDir, { recursive: true });
  } catch (error: unknown) {
    console.error(chalk.red(`Failed to create output directory: ${(error as Error).message}`));
    process.exit(1);
  }

  const generateStart = Date.now();
  progress.startPhase("generate", options.jsonOnly ? "JSON only" : "12+ files");
  try {
    const { documentCount, security, radar, deps, metrics, health } = await generateOutputs({
      repoPath,
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

    runStats.generateTime = Date.now() - generateStart;
    progress.succeed(`Generated ${documentCount} files`);

    if (!options.jsonOnly) {
      const grade = getSecurityGrade(security.score);
      const scoreColor = security.score >= 80 ? chalk.green : security.score >= 60 ? chalk.yellow : chalk.red;
      console.log(chalk.cyan("\nSecurity Score: ") + scoreColor(`${security.score}/100 (${grade})`));

      const riskEmoji = getRiskEmoji(radar.onboardingRisk.grade);
      const riskColor = radar.onboardingRisk.score <= 25 ? chalk.green :
        radar.onboardingRisk.score <= 50 ? chalk.yellow : chalk.red;
      console.log(chalk.cyan("Onboarding Risk: ") + riskColor(`${radar.onboardingRisk.score}/100 (${radar.onboardingRisk.grade}) ${riskEmoji}`));

      if (deps) {
        console.log(chalk.cyan("Dependencies: ") + chalk.white(`${deps.totalCount} total (${deps.runtime.length} runtime, ${deps.dev.length} dev)`));
      }

      if (styleConfig.sections.showMetrics) {
        const appr = metrics.approachability;
        const apprColor = appr.score >= 80 ? chalk.green : appr.score >= 60 ? chalk.yellow : chalk.red;
        console.log(
          chalk.cyan("Codebase: ") +
            chalk.white(`${metrics.totalFiles} files, ${metrics.sourceFiles} source`) +
            chalk.dim(" · ") +
            chalk.cyan("approachability ") +
            apprColor(`${appr.score}/100 (${appr.grade})`)
        );
      }

      if (styleConfig.sections.showHealth) {
        const healthColor = health.score >= 80 ? chalk.green : health.score >= 60 ? chalk.yellow : chalk.red;
        console.log(
          chalk.cyan("Repo Health: ") +
            healthColor(`${health.score}/100 (${health.grade})`) +
            chalk.dim(` · ${health.passCount} passed, ${health.warnCount} warnings, ${health.failCount} missing`)
        );
      }
    }
  } catch (error: unknown) {
    progress.fail(`Document generation failed: ${(error as Error).message}`);
    process.exit(1);
  }

  const interactiveRepoPath = repoPath;
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
    console.log(chalk.gray(`Keeping clone for interactive mode: ${repoPath}`));
  } else if (shouldCleanupRepo) {
    console.log(chalk.gray(`Temporary clone kept at: ${repoPath}`));
  } else {
    console.log(chalk.gray(`Using local repository path: ${repoPath}`));
  }

  progress.stop();
  runStats.totalTime = Date.now() - startTime;

  console.log();
  console.log(chalk.green("  ╔══════════════════════════════════════════════════════╗"));
  console.log(chalk.green("  ║") + chalk.white.bold("        ✓ Bootcamp Generated Successfully!           ") + chalk.green("║"));
  console.log(chalk.green("  ╚══════════════════════════════════════════════════════╝"));
  console.log();
  console.log(chalk.white(`  📁 Output: ${chalk.cyan.bold(outputDir + "/")}`));
  console.log();

  if (!options.jsonOnly) {
    const formatName = (name: string) => formatDocName(name, outputFormat);
    console.log(chalk.dim("  Generated files:"));
    console.log(chalk.white("  ├── ") + chalk.cyan(formatName("BOOTCAMP.md")) + chalk.dim("      → 1-page overview (start here!)"));
    console.log(chalk.white("  ├── ") + chalk.cyan(formatName("ONBOARDING.md")) + chalk.dim("    → Full setup guide"));
    console.log(chalk.white("  ├── ") + chalk.cyan(formatName("ARCHITECTURE.md")) + chalk.dim("  → System design & diagrams"));
    console.log(chalk.white("  ├── ") + chalk.cyan(formatName("CODEMAP.md")) + chalk.dim("       → Directory tour"));
    console.log(chalk.white("  ├── ") + chalk.cyan(formatName("FIRST_TASKS.md")) + chalk.dim("   → Starter issues"));
    if (styleConfig.sections.showRunbook) {
      console.log(chalk.white("  ├── ") + chalk.cyan(formatName("RUNBOOK.md")) + chalk.dim("       → Operations guide"));
    }
    if (styleConfig.sections.showDependencyGraph) {
      console.log(chalk.white("  ├── ") + chalk.cyan(formatName("DEPENDENCIES.md")) + chalk.dim("  → Dependency graph"));
    }
    if (styleConfig.sections.showSecurityDetails) {
      console.log(chalk.white("  ├── ") + chalk.cyan(formatName("SECURITY.md")) + chalk.dim("      → Security findings"));
    }
    if (styleConfig.sections.showRadar) {
      console.log(chalk.white("  ├── ") + chalk.cyan(formatName("RADAR.md")) + chalk.dim("         → Tech radar & risk score"));
    }
    if (styleConfig.sections.showImpact) {
      console.log(chalk.white("  ├── ") + chalk.cyan(formatName("IMPACT.md")) + chalk.dim("        → Change impact analysis"));
    }
    if (styleConfig.sections.showMetrics) {
      console.log(chalk.white("  ├── ") + chalk.cyan(formatName("METRICS.md")) + chalk.dim("       → Codebase metrics & hotspots"));
    }
    if (styleConfig.sections.showHealth) {
      console.log(chalk.white("  ├── ") + chalk.cyan(formatName("HEALTH.md")) + chalk.dim("        → Onboarding-readiness health check"));
    }
    if (options.compare) {
      console.log(chalk.white("  ├── ") + chalk.cyan(formatName("DIFF.md")) + chalk.dim("          → Version comparison"));
    }
    console.log(chalk.white("  ├── ") + chalk.cyan("diagrams.mmd") + chalk.dim("     → Mermaid diagrams"));
    console.log(chalk.white("  └── ") + chalk.cyan("repo_facts.json") + chalk.dim("  → Structured data"));
    console.log();
  }

  if (options.stats) {
    console.log(chalk.dim("  ─────────────────────────────────────────"));
    console.log(chalk.white.bold("  📊 Statistics"));
    console.log(chalk.white(`     Model:         ${chalk.cyan(runStats.model)}`));
    console.log(chalk.white(`     Files scanned: ${chalk.cyan(runStats.filesScanned)}`));
    console.log(chalk.white(`     Tool calls:    ${chalk.cyan(runStats.toolCalls)}`));
    console.log(chalk.white(`     Total time:    ${chalk.cyan((runStats.totalTime! / 1000).toFixed(1) + "s")}`));
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

  console.log(chalk.white("  🚀 ") + chalk.white.bold("Next step: ") + chalk.cyan(`open ${outputDir}/${formatDocName("BOOTCAMP.md", outputFormat)}`));
  console.log();

  if (options.watch) {
    const watchHandle = startWatch(repoPath, {
      intervalSeconds: options.watchInterval || 30,
      allowHardReset: options.watchForce || false,
      verbose: options.verbose,
      onChangeDetected: async () => {
        const wp = new ProgressTracker(options.verbose);

        wp.startPhase("scan", `max ${options.maxFiles} files`);
        const newScan = await scanRepositoryFiles(repoPath, options.maxFiles);
        wp.succeed(`Scanned ${newScan.files.length} files`);

        wp.startPhase("analyze");
        const result = await analyzeRepo(repoPath, repoInfo, newScan, options, (msg) => {
          wp.update(msg);
        }, styleConfig);
        const styledFacts = {
          ...result.facts,
          firstTasks: result.facts.firstTasks.slice(0, styleConfig.firstTasksCount),
        };
        wp.succeed("Analysis complete");

        wp.startPhase("generate", options.jsonOnly ? "JSON only" : "12+ files");
        const { documentCount } = await generateOutputs({
          repoPath,
          repoInfo,
          scanResult: newScan,
          facts: styledFacts,
          options,
          config,
          styleConfig,
          outputDir,
          outputFormat,
          progress: wp,
          allowIssueCreation: false,
        });
        wp.succeed(`Regenerated ${documentCount} files`);
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
    await runInteractiveMode(
      interactiveRepoPath,
      repoInfo,
      interactiveScanResult,
      outputDir,
      facts,
      { verbose: options.verbose, saveTranscript: options.transcript, model: options.model }
    );

    if (!options.keepTemp && shouldCleanupRepo) {
      try {
        await cleanupRepository(interactiveRepoPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  } else {
    process.exit(0);
  }
}
