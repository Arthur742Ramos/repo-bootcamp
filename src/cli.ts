#!/usr/bin/env node
/**
 * Repo Bootcamp Generator
 *
 * Turn any public repository into a "Day 1 onboarding kit"
 * using the GitHub Copilot SDK for intelligent agentic analysis.
 *
 * Usage:
 *   bootcamp https://github.com/owner/repo
 *   bootcamp https://github.com/owner/repo --output ./my-bootcamp
 *   bootcamp https://github.com/owner/repo --interactive
 *   bootcamp https://github.com/owner/repo --compare v1.0.0
 *   bootcamp https://github.com/owner/repo --watch
 *   bootcamp diff owner/repo#123
 *   bootcamp ask https://github.com/owner/repo
 *   bootcamp --web
 */

import { Command } from "commander";
import chalk from "chalk";
import { resolve } from "path";
import { pathToFileURL } from "url";

import { clearCache, getCacheDir, pruneCache } from "./cache.js";
import { runAskCommand } from "./commands/ask-command.js";
import { runPullRequestDiff } from "./commands/diff-command.js";
import { runDocsCommand } from "./commands/docs-command.js";
import { runMainCommand } from "./commands/main-command.js";
import { STYLE_PACK_NAMES } from "./plugins.js";
import { resolveOutputFormat } from "./services/config-resolution.js";
import type { OutputFormat } from "./formatter.js";
import type { BootcampOptions, StylePack } from "./types.js";
import { startServer } from "./web/server.js";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;

const program = new Command();

function getOptionSource(command: Command, name: string): "cli" | "default" {
  return command.getOptionValueSource(name) === "cli" ? "cli" : "default";
}

function isNegativeOptionEnabled(
  opts: { [key: string]: unknown },
  negativeKey: string,
  positiveKey: string
): boolean {
  return opts[negativeKey] === true || opts[positiveKey] === false;
}

program
  .name("bootcamp")
  .description("Turn any public GitHub/GitLab/Bitbucket repository into a Day 1 onboarding kit using GitHub Copilot SDK")
  .version(VERSION);

program
  .argument("<repo-url>", "Repository URL (GitHub/GitLab/Bitbucket) or local path with --no-clone")
  .option("-b, --branch <branch>", "Branch to analyze", "")
  .option(
    "-f, --focus <focus>",
    "Focus area: onboarding, architecture, contributing, all",
    "all"
  )
  .option(
    "-a, --audience <audience>",
    "Target audience: all, backend, frontend, sre",
    "all"
  )
  .option("-o, --output <dir>", "Output directory")
  .option("--format <format>", "Output format: markdown, html, pdf", "markdown")
  .option("-m, --max-files <number>", "Maximum files to scan", "200")
  .option("--model <model>", "Override model selection (e.g., claude-opus-4-5)")
  .option("--no-clone", "Use a local directory path instead of cloning")
  .option("--keep-temp", "Keep temporary clone directory")
  .option("--json-only", "Only generate repo_facts.json, skip markdown docs")
  .option("--stats", "Show detailed statistics after generation")
  .option("-v, --verbose", "Show detailed progress including tool calls")
  .option("-i, --interactive", "Start interactive Q&A mode after generation")
  .option("--transcript", "Save interactive session transcript to TRANSCRIPT.md")
  .option("-c, --compare <ref>", "Compare with another git ref (tag, branch, commit)")
  .option("--create-issues", "Create GitHub issues from FIRST_TASKS.md")
  .option("--dry-run", "Preview issues without creating (use with --create-issues)")
  .option("-s, --style <style>", "Output style: corporate, startup, oss, academic, minimal")
  .option("--render-diagrams [format]", "Render diagrams.mmd to SVG/PNG (requires mermaid-cli)", "svg")
  .option("--fast", "Fast mode: inline key files, skip tools, much faster (~15-30s)")
  .option("--repo-prompts <path>", "Path to custom prompts file (default: .bootcamp-prompts.md in target repo)")
  .option("--full-clone", "Perform a full clone instead of shallow clone (slower but includes full history)")
  .option("--no-cache", "Skip reading/writing analysis cache")
  .option("-w, --watch", "Watch mode: re-run analysis when target repo gets new commits")
  .option("--watch-interval <seconds>", "Polling interval for watch mode in seconds", "30")
  .option("--watch-force", "Allow destructive git reset --hard fallback in watch mode")
  .action(async (repoUrl: string, opts, command: Command) => {
    const options: BootcampOptions = {
      branch: opts.branch,
      focus: opts.focus as BootcampOptions["focus"],
      audience: opts.audience as BootcampOptions["audience"],
      output: opts.output,
      format: opts.format as OutputFormat,
      maxFiles: parseInt(opts.maxFiles, 10),
      noClone: isNegativeOptionEnabled(opts, "noClone", "clone"),
      verbose: opts.verbose || false,
      model: opts.model,
      keepTemp: opts.keepTemp || false,
      jsonOnly: opts.jsonOnly || false,
      stats: opts.stats || false,
      fast: opts.fast || false,
      interactive: opts.interactive || false,
      transcript: opts.transcript || false,
      compare: opts.compare,
      createIssues: opts.createIssues || false,
      dryRun: opts.dryRun || false,
      style: opts.style as StylePack | undefined,
      renderDiagrams: opts.renderDiagrams !== undefined,
      diagramFormat: (opts.renderDiagrams === true ? "svg" : opts.renderDiagrams) as BootcampOptions["diagramFormat"],
      fullClone: opts.fullClone || false,
      noCache: isNegativeOptionEnabled(opts, "noCache", "cache"),
      watch: opts.watch || false,
      watchInterval: parseInt(opts.watchInterval, 10),
      watchForce: opts.watchForce || false,
      repoPrompts: opts.repoPrompts,
      optionSource: {
        focus: getOptionSource(command, "focus"),
        audience: getOptionSource(command, "audience"),
        style: getOptionSource(command, "style"),
        model: getOptionSource(command, "model"),
        maxFiles: getOptionSource(command, "maxFiles"),
      },
    };

    if (!["onboarding", "architecture", "contributing", "all"].includes(options.focus)) {
      console.error(chalk.red(`Invalid focus: ${options.focus}`));
      process.exit(1);
    }

    if (!["all", "backend", "frontend", "sre"].includes(options.audience)) {
      console.error(chalk.red(`Invalid audience: ${options.audience}`));
      process.exit(1);
    }

    if (options.style && !STYLE_PACK_NAMES.includes(options.style)) {
      console.error(chalk.red(`Invalid style: ${options.style}. Use: ${STYLE_PACK_NAMES.join(", ")}`));
      process.exit(1);
    }

    try {
      options.format = resolveOutputFormat(options.format);
    } catch (error: unknown) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }

    await runMainCommand(repoUrl, options);
  });

program
  .command("ask <repo-url>")
  .description("Start interactive Q&A mode without full generation (supports local paths with --no-clone)")
  .option("-b, --branch <branch>", "Branch to analyze")
  .option("--no-clone", "Use a local directory path instead of cloning")
  .option("--model <model>", "Override model selection (e.g., claude-opus-4-5)")
  .option("-v, --verbose", "Show detailed output")
  .action(async (repoUrl: string, opts) => {
    await runAskCommand(repoUrl, {
      branch: opts.branch,
      model: opts.model,
      noClone: isNegativeOptionEnabled(opts, "noClone", "clone"),
      verbose: opts.verbose,
    });
  });

program
  .command("diff <repo-pr>")
  .description("Generate onboarding diff for a GitHub PR")
  .option("-o, --output <dir>", "Output directory")
  .option("--format <format>", "Output format: markdown, html, pdf", "markdown")
  .option("--full-clone", "Perform a full clone instead of shallow clone (slower but includes full history)")
  .option("--keep-temp", "Keep temporary clone directory")
  .option("-v, --verbose", "Show detailed output")
  .action(async (repoPr: string, opts) => {
    await runPullRequestDiff(repoPr, {
      output: opts.output,
      format: opts.format,
      fullClone: opts.fullClone || false,
      keepTemp: opts.keepTemp || false,
      verbose: opts.verbose || false,
    });
  });

program
  .command("web")
  .alias("serve")
  .description("Start local web demo server")
  .option("-p, --port <port>", "Port to listen on", "3000")
  .action((opts) => {
    startServer(parseInt(opts.port, 10));
  });

program
  .command("docs <repo-url>")
  .description("Analyze repo documentation for staleness and mismatches (supports local paths)")
  .option("--check", "Exit with code 1 if docs are stale (for CI)")
  .option("--fix", "Auto-fix stale documentation sections")
  .option("-b, --branch <branch>", "Branch to analyze", "")
  .option("-v, --verbose", "Show detailed output")
  .action(async (repoUrl: string, opts) => {
    await runDocsCommand(repoUrl, opts);
  });

const cacheCommand = program
  .command("cache")
  .description("Manage the analysis cache");

cacheCommand
  .command("prune")
  .description("Remove cache entries older than a given age")
  .option("--max-age <days>", "Maximum age in days", "7")
  .action(async (opts) => {
    const days = parseFloat(opts.maxAge);
    const maxAgeMs = days * 24 * 60 * 60 * 1000;
    console.log(chalk.dim(`Pruning cache entries older than ${days} day(s)...`));
    const pruned = await pruneCache(maxAgeMs);
    console.log(chalk.green(`Pruned ${pruned} cache file(s) from ${getCacheDir()}`));
  });

cacheCommand
  .command("clear")
  .description("Remove all cache entries")
  .action(async () => {
    const cleared = await clearCache();
    console.log(chalk.green(`Cleared ${cleared} cache file(s) from ${getCacheDir()}`));
  });

const isCliEntry = Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCliEntry) {
  program.parse();
}

export { program };
