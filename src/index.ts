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
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

import { parseGitHubUrl, cloneRepo, scanRepo } from "./ingest.js";
import { analyzeRepo, AnalysisStats } from "./agent.js";
import {
  generateBootcamp,
  generateOnboarding,
  generateArchitecture,
  generateCodemap,
  generateFirstTasks,
  generateRunbook,
  generateDiagrams,
} from "./generator.js";
import type { BootcampOptions, RepoFacts } from "./types.js";

const VERSION = "1.0.0";

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
  const spinner = ora();
  const runStats: Partial<RunStats> = {};
  const startTime = Date.now();

  console.log(chalk.bold.blue("\n=== Repo Bootcamp Generator ===\n"));
  console.log(chalk.gray(`Repository: ${repoUrl}`));
  console.log(chalk.gray(`Branch: ${options.branch || "default"}`));
  console.log(chalk.gray(`Focus: ${options.focus}`));
  console.log(chalk.gray(`Audience: ${options.audience}`));
  console.log(chalk.gray(`Max files: ${options.maxFiles}`));
  if (options.model) {
    console.log(chalk.gray(`Model override: ${options.model}`));
  }
  console.log();

  // Parse URL
  spinner.start("Parsing repository URL...");
  let repoInfo;
  try {
    repoInfo = parseGitHubUrl(repoUrl);
    spinner.succeed(`Repository: ${repoInfo.fullName}`);
  } catch (error: any) {
    spinner.fail(`Invalid URL: ${error.message}`);
    process.exit(1);
  }

  // Determine output directory
  const outputDir = options.output || `./bootcamp-${repoInfo.repo}`;

  // Clone repository
  const cloneStart = Date.now();
  spinner.start(`Cloning ${repoInfo.fullName}...`);
  let repoPath: string;
  try {
    repoPath = await cloneRepo(repoInfo, process.cwd(), options.branch);
    runStats.cloneTime = Date.now() - cloneStart;
    spinner.succeed(`Cloned to temporary directory (branch: ${repoInfo.branch})`);
  } catch (error: any) {
    spinner.fail(`Clone failed: ${error.message}`);
    process.exit(1);
  }

  // Scan repository
  const scanStart = Date.now();
  spinner.start(`Scanning file tree (max ${options.maxFiles} files)...`);
  let scanResult;
  try {
    scanResult = await scanRepo(repoPath, options.maxFiles);
    runStats.scanTime = Date.now() - scanStart;
    runStats.filesScanned = scanResult.files.length;
    spinner.succeed(`Scanned ${scanResult.files.length} files (${scanResult.keySourceFiles.size} key files read)`);
  } catch (error: any) {
    spinner.fail(`Scan failed: ${error.message}`);
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
  spinner.start("Analyzing repository with Copilot...");
  let facts: RepoFacts;
  let analysisStats: AnalysisStats;
  try {
    const result = await analyzeRepo(repoPath, repoInfo, scanResult, options, (msg) => {
      spinner.text = `Analyzing: ${msg}`;
    });
    facts = result.facts;
    analysisStats = result.stats;
    runStats.analysisTime = Date.now() - analysisStart;
    runStats.toolCalls = analysisStats.toolCalls.length;
    runStats.model = analysisStats.model;
    spinner.succeed(`Analysis complete (${analysisStats.toolCalls.length} tool calls)`);
  } catch (error: any) {
    spinner.fail(`Analysis failed: ${error.message}`);
    console.log(chalk.yellow("\nTip: Make sure you're authenticated with GitHub Copilot"));
    process.exit(1);
  }

  // Create output directory
  spinner.start(`Creating output directory: ${outputDir}`);
  try {
    await mkdir(outputDir, { recursive: true });
    spinner.succeed(`Output directory ready`);
  } catch (error: any) {
    spinner.fail(`Failed to create output directory: ${error.message}`);
    process.exit(1);
  }

  // Generate documents
  const generateStart = Date.now();
  spinner.start("Generating bootcamp documents...");
  try {
    const documents = [
      { name: "BOOTCAMP.md", content: generateBootcamp(facts, options) },
      { name: "ONBOARDING.md", content: generateOnboarding(facts) },
      { name: "ARCHITECTURE.md", content: generateArchitecture(facts) },
      { name: "CODEMAP.md", content: generateCodemap(facts) },
      { name: "FIRST_TASKS.md", content: generateFirstTasks(facts) },
      { name: "RUNBOOK.md", content: generateRunbook(facts) },
      { name: "diagrams.mmd", content: generateDiagrams(facts) },
      { name: "repo_facts.json", content: JSON.stringify(facts, null, 2) },
    ];

    // Only write if not json-only mode
    if (!options.jsonOnly) {
      for (const doc of documents) {
        await writeFile(join(outputDir, doc.name), doc.content, "utf-8");
      }
    } else {
      // Just write the JSON
      await writeFile(join(outputDir, "repo_facts.json"), JSON.stringify(facts, null, 2), "utf-8");
    }

    runStats.generateTime = Date.now() - generateStart;
    spinner.succeed(`Generated ${options.jsonOnly ? 1 : documents.length} files`);
  } catch (error: any) {
    spinner.fail(`Document generation failed: ${error.message}`);
    process.exit(1);
  }

  // Cleanup temporary clone
  if (!options.keepTemp) {
    spinner.start("Cleaning up...");
    try {
      await rm(repoPath, { recursive: true, force: true });
      spinner.succeed("Cleanup complete");
    } catch {
      spinner.warn("Could not clean up temporary files");
    }
  } else {
    console.log(chalk.gray(`Temporary clone kept at: ${repoPath}`));
  }

  runStats.totalTime = Date.now() - startTime;

  // Print summary
  console.log(chalk.bold.green("\n=== Bootcamp Generated! ===\n"));
  console.log(chalk.white(`Output: ${outputDir}/`));
  console.log();

  if (!options.jsonOnly) {
    console.log(chalk.gray("Generated files:"));
    console.log(chalk.white("  BOOTCAMP.md      - 1-page overview (start here!)"));
    console.log(chalk.white("  ONBOARDING.md    - Full setup guide"));
    console.log(chalk.white("  ARCHITECTURE.md  - System design & components"));
    console.log(chalk.white("  CODEMAP.md       - Directory tour"));
    console.log(chalk.white("  FIRST_TASKS.md   - Starter issues"));
    console.log(chalk.white("  RUNBOOK.md       - Operations guide"));
    console.log(chalk.white("  diagrams.mmd     - Mermaid diagrams"));
    console.log(chalk.white("  repo_facts.json  - Structured data"));
    console.log();
  }

  // Show stats if requested
  if (options.stats) {
    console.log(chalk.cyan("Statistics:"));
    console.log(chalk.white(`  Model: ${runStats.model}`));
    console.log(chalk.white(`  Files scanned: ${runStats.filesScanned}`));
    console.log(chalk.white(`  Tool calls: ${runStats.toolCalls}`));
    console.log(chalk.white(`  Clone time: ${(runStats.cloneTime! / 1000).toFixed(1)}s`));
    console.log(chalk.white(`  Scan time: ${(runStats.scanTime! / 1000).toFixed(1)}s`));
    console.log(chalk.white(`  Analysis time: ${(runStats.analysisTime! / 1000).toFixed(1)}s`));
    console.log(chalk.white(`  Generate time: ${(runStats.generateTime! / 1000).toFixed(1)}s`));
    console.log(chalk.white(`  Total time: ${(runStats.totalTime! / 1000).toFixed(1)}s`));
    console.log();

    if (analysisStats.toolCalls.length > 0) {
      console.log(chalk.cyan("Tool calls made:"));
      for (const call of analysisStats.toolCalls) {
        console.log(chalk.gray(`  ${call.name}: ${call.args}`));
      }
      console.log();
    }
  }

  console.log(chalk.cyan(`Open ${outputDir}/BOOTCAMP.md to get started!`));
  
  // Ensure process exits cleanly (SDK may have lingering connections)
  process.exit(0);
}

// CLI setup
const program = new Command();

program
  .name("bootcamp")
  .description("Turn any public GitHub repository into a Day 1 onboarding kit using GitHub Copilot SDK")
  .version(VERSION)
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
    };

    if (!["onboarding", "architecture", "contributing", "all"].includes(options.focus)) {
      console.error(chalk.red(`Invalid focus: ${options.focus}`));
      process.exit(1);
    }

    if (!["new-hire", "oss-contributor", "internal-dev"].includes(options.audience)) {
      console.error(chalk.red(`Invalid audience: ${options.audience}`));
      process.exit(1);
    }

    await run(repoUrl, options);
  });

program.parse();
