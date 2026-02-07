#!/usr/bin/env node
/**
 * Repo Bootcamp Generator
 *
 * Turn any public GitHub repository into a "Day 1 onboarding kit"
 * using the GitHub Copilot SDK for intelligent agentic analysis.
 *
 * Usage:
 *   bootcamp https://github.com/owner/repo
 *   bootcamp https://github.com/owner/repo --output ./my-bootcamp
 *   bootcamp https://github.com/owner/repo --interactive
 *   bootcamp https://github.com/owner/repo --compare v1.0.0
 *   bootcamp ask https://github.com/owner/repo
 *   bootcamp --web
 */

import { Command } from "commander";
import chalk from "chalk";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join, basename } from "path";

import { parseGitHubUrl, cloneRepo, scanRepo, mergeFrameworksFromDeps } from "./ingest.js";
import { analyzeRepo, AnalysisStats } from "./agent.js";
import { ProgressTracker } from "./progress.js";
import { extractDependencies, generateDependencyDocs } from "./deps.js";
import { analyzeSecurityPatterns, generateSecurityDocs, getSecurityGrade } from "./security.js";
import { generateTechRadar, generateRadarDocs, getRiskEmoji } from "./radar.js";
import { buildImportGraph, analyzeChangeImpact, generateImpactDocs, getKeyFilesForImpact } from "./impact.js";
import { runInteractiveMode } from "./interactive.js";
import { createIssuesFromTasks, generateIssuePreview } from "./issues.js";
import { analyzeDiff, generateDiffDocs } from "./diff.js";
import { startServer } from "./web.js";
import { startWatch } from "./watch.js";
import { loadConfig, getStyleConfig, loadPlugins, runPlugins } from "./plugins.js";
import { renderOutputDiagrams, DiagramFormat } from "./diagrams.js";
import { readCache, writeCache } from "./cache.js";
import {
  generateBootcamp,
  generateOnboarding,
  generateArchitecture,
  generateCodemap,
  generateFirstTasks,
  generateRunbook,
  generateDiagrams,
} from "./generator.js";
import type { BootcampOptions, RepoFacts, ScanResult, RepoInfo, StylePack } from "./types.js";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;

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

async function run(repoUrl: string, options: BootcampOptions): Promise<void> {
  const progress = new ProgressTracker(options.verbose);
  const runStats: Partial<RunStats> = {};
  const startTime = Date.now();

  // Load config file if present
  const config = await loadConfig();
  const styleConfig = getStyleConfig(
    options.style || config?.style,
    config?.customStyle
  );

  // ASCII art banner
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
  if (options.model) {
    console.log(chalk.white(`  Model:       ${chalk.cyan(options.model)}`));
  }
  if (options.compare) {
    console.log(chalk.white(`  Compare:     ${chalk.cyan(options.compare)}`));
  }
  console.log(chalk.dim("─".repeat(50)));
  console.log();

  // Show phase overview
  ProgressTracker.printPhaseOverview();

  // Parse URL
  let repoInfo: RepoInfo;
  try {
    repoInfo = parseGitHubUrl(repoUrl);
    console.log(chalk.white(`Target: ${chalk.bold(repoInfo.fullName)}`));
    console.log();
  } catch (error: unknown) {
    console.error(chalk.red(`Invalid URL: ${(error as Error).message}`));
    process.exit(1);
  }

  // Determine output directory
  const outputDir = options.output || `./bootcamp-${repoInfo.repo}`;

  // Clone repository
  const cloneStart = Date.now();
  progress.startPhase("clone", repoInfo.fullName);
  let repoPath: string;
  try {
    repoPath = await cloneRepo(repoInfo, process.cwd(), options.branch, options.fullClone);
    runStats.cloneTime = Date.now() - cloneStart;
    progress.succeed(`Cloned ${repoInfo.fullName} (branch: ${repoInfo.branch})`);
  } catch (error: unknown) {
    progress.fail(`Clone failed: ${(error as Error).message}`);
    process.exit(1);
  }

  // Scan repository
  const scanStart = Date.now();
  progress.startPhase("scan", `max ${options.maxFiles} files`);
  let scanResult: ScanResult;
  try {
    scanResult = await scanRepo(repoPath, options.maxFiles);
    runStats.scanTime = Date.now() - scanStart;
    runStats.filesScanned = scanResult.files.length;
    progress.succeed(`Scanned ${scanResult.files.length} files (${scanResult.keySourceFiles.size} key files read)`);
  } catch (error: unknown) {
    progress.fail(`Scan failed: ${(error as Error).message}`);
    process.exit(1);
  }

  // Display detected stack
  console.log(chalk.cyan("\nDetected Stack:"));
  console.log(chalk.white(`  Languages: ${scanResult.stack.languages.join(", ") || "Unknown"}`));
  console.log(chalk.white(`  Frameworks: ${scanResult.stack.frameworks.join(", ") || "None"}`));
  console.log(chalk.white(`  Build: ${scanResult.stack.buildSystem || "Unknown"}`));
  console.log(chalk.white(`  CI: ${scanResult.stack.hasCi ? "Yes" : "No"}`));
  console.log(chalk.white(`  Docker: ${scanResult.stack.hasDocker ? "Yes" : "No"}`));
  console.log();

  // Analyze with Copilot SDK
  const analysisStart = Date.now();
  progress.startPhase("analyze");
  let facts!: RepoFacts;
  let analysisStats!: AnalysisStats;

  // Check cache first
  const useCache = !options.noCache && !!repoInfo.commitSha;
  let cacheHit = false;

  if (useCache) {
    const cached = await readCache(repoInfo.fullName, repoInfo.commitSha!);
    if (cached) {
      facts = cached;
      cacheHit = true;
      analysisStats = {
        model: "cached",
        toolCalls: [],
        totalEvents: 0,
        responseLength: 0,
        startTime: analysisStart,
        endTime: Date.now(),
      };
      runStats.analysisTime = Date.now() - analysisStart;
      runStats.toolCalls = 0;
      runStats.model = "cached";
      progress.succeed(`Analysis loaded from cache (${repoInfo.commitSha!.substring(0, 7)})`);
    }
  }

  if (!cacheHit) {
    try {
      const result = await analyzeRepo(repoPath, repoInfo, scanResult, options, (msg) => {
        // Track tool calls
        if (msg.startsWith("Tool:")) {
          const toolName = msg.replace("Tool:", "").trim();
          progress.recordToolCall(toolName);
        }
        progress.update(msg);
      });
      facts = result.facts;
      analysisStats = result.stats;
      runStats.analysisTime = Date.now() - analysisStart;
      runStats.toolCalls = analysisStats.toolCalls.length;
      runStats.model = analysisStats.model;
      progress.succeed(`Analysis complete`);

      // Write to cache
      if (useCache) {
        try {
          await writeCache(repoInfo.fullName, repoInfo.commitSha!, facts);
        } catch {
          // Cache write failure is non-fatal
        }
      }
    } catch (error: unknown) {
      progress.fail(`Analysis failed: ${(error as Error).message}`);
      console.log(chalk.yellow("\nTip: Make sure you're authenticated with GitHub Copilot"));
      console.log(chalk.gray("Run: gh auth status"));
      process.exit(1);
    }
  }

  // Create output directory
  try {
    await mkdir(outputDir, { recursive: true });
  } catch (error: unknown) {
    console.error(chalk.red(`Failed to create output directory: ${(error as Error).message}`));
    process.exit(1);
  }

  // Generate documents
  const generateStart = Date.now();
  progress.startPhase("generate", options.jsonOnly ? "JSON only" : "12+ files");
  try {
    // Extract dependencies
    const deps = await extractDependencies(repoPath);
    
    // Merge frameworks detected from dependencies into stack info
    if (deps) {
      const allDepNames = [
        ...deps.runtime.map(d => d.name),
        ...deps.dev.map(d => d.name),
      ];
      mergeFrameworksFromDeps(scanResult.stack, allDepNames);
    }
    
    // Analyze security (read package.json for deps check)
    let packageJson: Record<string, unknown> | undefined;
    try {
      const pkgContent = await readFile(join(repoPath, "package.json"), "utf-8");
      packageJson = JSON.parse(pkgContent);
    } catch {
      // No package.json
    }
    const security = await analyzeSecurityPatterns(repoPath, scanResult.files, packageJson);

    // Generate Tech Radar
    const radar = generateTechRadar(
      scanResult.stack,
      scanResult.files,
      deps,
      security,
      !!scanResult.readme,
      !!scanResult.contributing
    );

    // Generate Change Impact Map
    const keyFiles = getKeyFilesForImpact(scanResult.files);
    const importGraph = await buildImportGraph(repoPath, scanResult.files);
    const impacts = await Promise.all(
      keyFiles.slice(0, 10).map(file => 
        analyzeChangeImpact(repoPath, scanResult.files, file, importGraph)
      )
    );

    // Generate Diff if --compare is specified
    let diffSummary = null;
    if (options.compare) {
      try {
        progress.update("Analyzing diff...");
        diffSummary = await analyzeDiff(repoPath, options.compare, "HEAD");
      } catch (error: unknown) {
        console.log(chalk.yellow(`  Warning: Could not generate diff: ${(error as Error).message}`));
      }
    }

    // Build document list
    const documents = [
      { name: "BOOTCAMP.md", content: generateBootcamp(facts, options) },
      { name: "ONBOARDING.md", content: generateOnboarding(facts) },
      { name: "ARCHITECTURE.md", content: generateArchitecture(facts) },
      { name: "CODEMAP.md", content: generateCodemap(facts) },
      { name: "FIRST_TASKS.md", content: generateFirstTasks(facts) },
      { name: "RUNBOOK.md", content: generateRunbook(facts) },
      { name: "diagrams.mmd", content: generateDiagrams(facts) },
      { name: "repo_facts.json", content: JSON.stringify(facts, null, 2) },
      { name: "SECURITY.md", content: generateSecurityDocs(security, repoInfo.repo) },
      { name: "RADAR.md", content: generateRadarDocs(radar, repoInfo.repo) },
    ];

    // Add dependency docs if we have deps
    if (deps) {
      documents.push({
        name: "DEPENDENCIES.md",
        content: generateDependencyDocs(deps, repoInfo.repo),
      });
    }

    // Add impact docs if we have impacts
    if (impacts.length > 0) {
      documents.push({
        name: "IMPACT.md",
        content: generateImpactDocs(impacts, repoInfo.repo),
      });
    }

    // Add diff docs if generated
    if (diffSummary) {
      documents.push({
        name: "DIFF.md",
        content: generateDiffDocs(diffSummary, repoInfo.repo),
      });
    }

    // Load and run plugins if configured
    if (config?.plugins && config.plugins.length > 0) {
      progress.update("Running plugins...");
      const plugins = await loadPlugins(config.plugins);
      const pluginOutput = await runPlugins(plugins, repoPath, scanResult, facts, options);
      
      // Add plugin docs
      for (const doc of pluginOutput.docs) {
        documents.push(doc);
      }

      // Merge extra data into facts JSON
      if (Object.keys(pluginOutput.extraData).length > 0) {
        const factsWithPlugins = {
          ...facts,
          plugins: pluginOutput.extraData,
        };
        const factsDoc = documents.find(d => d.name === "repo_facts.json");
        if (factsDoc) {
          factsDoc.content = JSON.stringify(factsWithPlugins, null, 2);
        }
      }
    }

    // Only write if not json-only mode
    if (!options.jsonOnly) {
      for (const doc of documents) {
        progress.update(doc.name);
        await writeFile(join(outputDir, doc.name), doc.content, "utf-8");
      }
    } else {
      // Just write the JSON
      await writeFile(join(outputDir, "repo_facts.json"), JSON.stringify(facts, null, 2), "utf-8");
    }

    runStats.generateTime = Date.now() - generateStart;
    progress.succeed(`Generated ${options.jsonOnly ? 1 : documents.length} files`);

    // Show security score
    if (!options.jsonOnly) {
      const grade = getSecurityGrade(security.score);
      const scoreColor = security.score >= 80 ? chalk.green : security.score >= 60 ? chalk.yellow : chalk.red;
      console.log(chalk.cyan("\nSecurity Score: ") + scoreColor(`${security.score}/100 (${grade})`));
      
      // Show onboarding risk
      const riskEmoji = getRiskEmoji(radar.onboardingRisk.grade);
      const riskColor = radar.onboardingRisk.score <= 25 ? chalk.green : 
                        radar.onboardingRisk.score <= 50 ? chalk.yellow : chalk.red;
      console.log(chalk.cyan("Onboarding Risk: ") + riskColor(`${radar.onboardingRisk.score}/100 (${radar.onboardingRisk.grade}) ${riskEmoji}`));

      if (deps) {
        console.log(chalk.cyan("Dependencies: ") + chalk.white(`${deps.totalCount} total (${deps.runtime.length} runtime, ${deps.dev.length} dev)`));
      }
    }

    // Create issues if requested
    if (options.createIssues && facts.firstTasks.length > 0) {
      console.log();
      if (options.dryRun) {
        const preview = generateIssuePreview(facts.firstTasks, repoInfo);
        await writeFile(join(outputDir, "ISSUES_PREVIEW.md"), preview, "utf-8");
        console.log(chalk.yellow("Issue preview saved to ISSUES_PREVIEW.md"));
      }
      await createIssuesFromTasks(facts.firstTasks, repoInfo, {
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
    }

    // Render diagrams if requested
    if (options.renderDiagrams && !options.jsonOnly) {
      progress.update("Rendering diagrams...");
      const format = options.diagramFormat || "svg";
      const renderResult = await renderOutputDiagrams(outputDir, format);
      if (renderResult.rendered) {
        console.log(chalk.cyan("\nDiagrams rendered: ") + chalk.white(renderResult.files.map(f => basename(f)).join(", ")));
      } else if (renderResult.error) {
        console.log(chalk.yellow(`\nDiagram rendering skipped: ${renderResult.error}`));
      }
    }

  } catch (error: unknown) {
    progress.fail(`Document generation failed: ${(error as Error).message}`);
    process.exit(1);
  }

  // Store repoPath and scanResult for interactive mode before cleanup
  const interactiveRepoPath = repoPath;
  const interactiveScanResult = scanResult;

  // Cleanup temporary clone (unless keeping for interactive or watch mode)
  if (!options.keepTemp && !options.interactive && !options.watch) {
    progress.startPhase("cleanup");
    try {
      await rm(repoPath, { recursive: true, force: true });
      progress.succeed("Cleanup complete");
    } catch {
      progress.warn("Could not clean up temporary files");
    }
  } else if (options.interactive) {
    console.log(chalk.gray(`Keeping clone for interactive mode: ${repoPath}`));
  } else {
    console.log(chalk.gray(`Temporary clone kept at: ${repoPath}`));
  }

  progress.stop();
  runStats.totalTime = Date.now() - startTime;

  // Print summary with nice box
  console.log();
  console.log(chalk.green("  ╔══════════════════════════════════════════════════════╗"));
  console.log(chalk.green("  ║") + chalk.white.bold("        ✓ Bootcamp Generated Successfully!           ") + chalk.green("║"));
  console.log(chalk.green("  ╚══════════════════════════════════════════════════════╝"));
  console.log();
  console.log(chalk.white(`  📁 Output: ${chalk.cyan.bold(outputDir + "/")}`));
  console.log();

  if (!options.jsonOnly) {
    console.log(chalk.dim("  Generated files:"));
    console.log(chalk.white("  ├── ") + chalk.cyan("BOOTCAMP.md") + chalk.dim("      → 1-page overview (start here!)"));
    console.log(chalk.white("  ├── ") + chalk.cyan("ONBOARDING.md") + chalk.dim("    → Full setup guide"));
    console.log(chalk.white("  ├── ") + chalk.cyan("ARCHITECTURE.md") + chalk.dim("  → System design & diagrams"));
    console.log(chalk.white("  ├── ") + chalk.cyan("CODEMAP.md") + chalk.dim("       → Directory tour"));
    console.log(chalk.white("  ├── ") + chalk.cyan("FIRST_TASKS.md") + chalk.dim("   → Starter issues"));
    console.log(chalk.white("  ├── ") + chalk.cyan("RUNBOOK.md") + chalk.dim("       → Operations guide"));
    console.log(chalk.white("  ├── ") + chalk.cyan("DEPENDENCIES.md") + chalk.dim("  → Dependency graph"));
    console.log(chalk.white("  ├── ") + chalk.cyan("SECURITY.md") + chalk.dim("      → Security findings"));
    console.log(chalk.white("  ├── ") + chalk.cyan("RADAR.md") + chalk.dim("         → Tech radar & risk score"));
    console.log(chalk.white("  ├── ") + chalk.cyan("IMPACT.md") + chalk.dim("        → Change impact analysis"));
    if (options.compare) {
      console.log(chalk.white("  ├── ") + chalk.cyan("DIFF.md") + chalk.dim("          → Version comparison"));
    }
    console.log(chalk.white("  ├── ") + chalk.cyan("diagrams.mmd") + chalk.dim("     → Mermaid diagrams"));
    console.log(chalk.white("  └── ") + chalk.cyan("repo_facts.json") + chalk.dim("  → Structured data"));
    console.log();
  }

  // Show stats if requested
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

  console.log(chalk.white("  🚀 ") + chalk.white.bold("Next step: ") + chalk.cyan(`open ${outputDir}/BOOTCAMP.md`));
  console.log();

  // Start watch mode if requested
  if (options.watch) {
    const watchHandle = startWatch(repoPath, {
      intervalSeconds: options.watchInterval || 30,
      verbose: options.verbose,
      onChangeDetected: async () => {
        // Re-run scan → analyze → generate on the existing clone
        const wp = new ProgressTracker(options.verbose);

        wp.startPhase("scan", `max ${options.maxFiles} files`);
        const newScan = await scanRepo(repoPath, options.maxFiles);
        wp.succeed(`Scanned ${newScan.files.length} files`);

        wp.startPhase("analyze");
        const result = await analyzeRepo(repoPath, repoInfo, newScan, options, (msg) => {
          wp.update(msg);
        });
        wp.succeed("Analysis complete");

        wp.startPhase("generate");
        const docs = [
          { name: "BOOTCAMP.md", content: generateBootcamp(result.facts, options) },
          { name: "ONBOARDING.md", content: generateOnboarding(result.facts) },
          { name: "ARCHITECTURE.md", content: generateArchitecture(result.facts) },
          { name: "CODEMAP.md", content: generateCodemap(result.facts) },
          { name: "FIRST_TASKS.md", content: generateFirstTasks(result.facts) },
          { name: "RUNBOOK.md", content: generateRunbook(result.facts) },
          { name: "diagrams.mmd", content: generateDiagrams(result.facts) },
          { name: "repo_facts.json", content: JSON.stringify(result.facts, null, 2) },
        ];
        for (const doc of docs) {
          await writeFile(join(outputDir, doc.name), doc.content, "utf-8");
        }
        wp.succeed(`Regenerated ${docs.length} files`);
        wp.stop();
      },
    });

    // Clean up on SIGINT/SIGTERM
    const onSignal = () => {
      watchHandle.stop();
      console.log(chalk.dim("\n  Watch mode stopped."));
      process.exit(0);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    // Block forever (watch timers keep the event loop alive)
    await new Promise<void>(() => {});
    return;
  }

  // Start interactive mode if requested
  if (options.interactive) {
    await runInteractiveMode(
      interactiveRepoPath,
      repoInfo,
      interactiveScanResult,
      outputDir,
      facts,
      { verbose: options.verbose, saveTranscript: options.transcript }
    );
    
    // Cleanup after interactive mode
    if (!options.keepTemp) {
      try {
        await rm(interactiveRepoPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  } else {
    // Ensure process exits cleanly (SDK may have lingering connections)
    process.exit(0);
  }
}

/**
 * Run ask command - standalone Q&A mode
 */
async function runAsk(repoUrl: string, options: { branch?: string; verbose?: boolean }): Promise<void> {
  console.log(chalk.bold.blue("\n=== Repo Bootcamp - Ask Mode ===\n"));

  // Parse URL
  let repoInfo: RepoInfo;
  try {
    repoInfo = parseGitHubUrl(repoUrl);
    console.log(chalk.gray(`Repository: ${repoInfo.fullName}`));
  } catch (error: unknown) {
    console.error(chalk.red(`Invalid URL: ${(error as Error).message}`));
    process.exit(1);
  }

  // Clone
  console.log(chalk.gray("Cloning repository..."));
  let repoPath: string;
  try {
    repoPath = await cloneRepo(repoInfo, process.cwd(), options.branch, false);
  } catch (error: unknown) {
    console.error(chalk.red(`Clone failed: ${(error as Error).message}`));
    process.exit(1);
  }

  // Scan
  console.log(chalk.gray("Scanning files..."));
  let scanResult: ScanResult;
  try {
    scanResult = await scanRepo(repoPath, 200);
  } catch (error: unknown) {
    console.error(chalk.red(`Scan failed: ${(error as Error).message}`));
    process.exit(1);
  }

  // Run interactive mode
  await runInteractiveMode(
    repoPath,
    repoInfo,
    scanResult,
    process.cwd(),
    undefined,
    { verbose: options.verbose, saveTranscript: true }
  );

  // Cleanup
  try {
    await rm(repoPath, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

// CLI setup
const program = new Command();

program
  .name("bootcamp")
  .description("Turn any public GitHub repository into a Day 1 onboarding kit using GitHub Copilot SDK")
  .version(VERSION);

// Main command
program
  .argument("<repo-url>", "GitHub repository URL")
  .option("-b, --branch <branch>", "Branch to analyze", "")
  .option(
    "-f, --focus <focus>",
    "Focus area: onboarding, architecture, contributing, all",
    "all"
  )
  .option(
    "-a, --audience <audience>",
    "Target audience: new-hire, oss-contributor, internal-dev",
    "oss-contributor"
  )
  .option("-o, --output <dir>", "Output directory")
  .option("-m, --max-files <number>", "Maximum files to scan", "200")
  .option("--model <model>", "Override model selection (e.g., claude-opus-4-5)")
  .option("--no-clone", "Use GitHub API instead of cloning (faster but limited)")
  .option("--keep-temp", "Keep temporary clone directory")
  .option("--json-only", "Only generate repo_facts.json, skip markdown docs")
  .option("--stats", "Show detailed statistics after generation")
  .option("-v, --verbose", "Show detailed progress including tool calls")
  // New feature flags
  .option("-i, --interactive", "Start interactive Q&A mode after generation")
  .option("--transcript", "Save interactive session transcript to TRANSCRIPT.md")
  .option("-c, --compare <ref>", "Compare with another git ref (tag, branch, commit)")
  .option("--create-issues", "Create GitHub issues from FIRST_TASKS.md")
  .option("--dry-run", "Preview issues without creating (use with --create-issues)")
  .option("-s, --style <style>", "Output style: startup, enterprise, oss, devops", "oss")
  .option("--render-diagrams [format]", "Render diagrams.mmd to SVG/PNG (requires mermaid-cli)", "svg")
  .option("--fast", "Fast mode: inline key files, skip tools, much faster (~15-30s)")
  .option("--full-clone", "Perform a full clone instead of shallow clone (slower but includes full history)")
  .option("--no-cache", "Skip reading/writing analysis cache")
  .option("-w, --watch", "Watch mode: re-run analysis when target repo gets new commits")
  .option("--watch-interval <seconds>", "Polling interval for watch mode in seconds", "30")
  .action(async (repoUrl: string, opts) => {
    const options: BootcampOptions = {
      branch: opts.branch,
      focus: opts.focus as BootcampOptions["focus"],
      audience: opts.audience as BootcampOptions["audience"],
      output: opts.output,
      maxFiles: parseInt(opts.maxFiles, 10),
      noClone: opts.clone === false,
      verbose: opts.verbose || false,
      model: opts.model,
      keepTemp: opts.keepTemp || false,
      jsonOnly: opts.jsonOnly || false,
      stats: opts.stats || false,
      fast: opts.fast || false,
      // New options
      interactive: opts.interactive || false,
      transcript: opts.transcript || false,
      compare: opts.compare,
      createIssues: opts.createIssues || false,
      dryRun: opts.dryRun || false,
      style: opts.style as StylePack,
      renderDiagrams: opts.renderDiagrams !== undefined,
      diagramFormat: (opts.renderDiagrams === true ? "svg" : opts.renderDiagrams) as DiagramFormat,
      fullClone: opts.fullClone || false,
      noCache: opts.cache === false,
      watch: opts.watch || false,
      watchInterval: parseInt(opts.watchInterval, 10),
    };

    if (!["onboarding", "architecture", "contributing", "all"].includes(options.focus)) {
      console.error(chalk.red(`Invalid focus: ${options.focus}`));
      process.exit(1);
    }

    if (!["new-hire", "oss-contributor", "internal-dev"].includes(options.audience)) {
      console.error(chalk.red(`Invalid audience: ${options.audience}`));
      process.exit(1);
    }

    if (options.style && !["startup", "enterprise", "oss", "devops"].includes(options.style)) {
      console.error(chalk.red(`Invalid style: ${options.style}. Use: startup, enterprise, oss, devops`));
      process.exit(1);
    }

    await run(repoUrl, options);
  });

// Ask subcommand
program
  .command("ask <repo-url>")
  .description("Start interactive Q&A mode without full generation")
  .option("-b, --branch <branch>", "Branch to analyze")
  .option("-v, --verbose", "Show detailed output")
  .action(async (repoUrl: string, opts) => {
    await runAsk(repoUrl, opts);
  });

// Web subcommand
program
  .command("web")
  .alias("serve")
  .description("Start local web demo server")
  .option("-p, --port <port>", "Port to listen on", "3000")
  .action((opts) => {
    startServer(parseInt(opts.port, 10));
  });

program.parse();
