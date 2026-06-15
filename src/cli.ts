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
import { runCacheList } from "./commands/cache-list.js";
import { runCompletionCommand } from "./commands/completion-command.js";
import { runDepsCommand } from "./commands/deps-command.js";
import { runPullRequestDiff } from "./commands/diff-command.js";
import { runDocsCommand } from "./commands/docs-command.js";
import { runDoctor } from "./commands/doctor-command.js";
import { runHealthCommand } from "./commands/health-command.js";
import { runInitCommand } from "./commands/init-command.js";
import { runMainCommand } from "./commands/main-command.js";
import { runMetricsCommand } from "./commands/metrics-command.js";
import { runScanCommand } from "./commands/scan-command.js";
import { runSecurityCommand } from "./commands/security-command.js";
import { runStylesCommand } from "./commands/styles-command.js";
import { STYLE_PACK_NAMES } from "./plugins.js";
import { resolveOutputFormat } from "./services/config-resolution.js";
import type { OutputFormat } from "./formatter.js";
import type { BootcampOptions, StylePack } from "./types.js";
import { startServer } from "./web/server.js";
import { getFlagValue, hasFlag } from "./utils.js";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;

const program = new Command();

interface MainActionOptions {
  [key: string]: unknown;
  branch?: string;
  focus?: string;
  audience?: string;
  output?: string;
  format?: string;
  maxFiles?: string;
  clone?: boolean;
  noClone?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  model?: string;
  keepTemp?: boolean;
  jsonOnly?: boolean;
  stats?: boolean;
  fast?: boolean;
  interactive?: boolean;
  transcript?: boolean;
  compare?: string;
  createIssues?: boolean;
  dryRun?: boolean;
  style?: string;
  renderDiagrams?: boolean | string;
  fullClone?: boolean;
  cache?: boolean;
  noCache?: boolean;
  watch?: boolean;
  watchInterval?: string;
  watchForce?: boolean;
  repoPrompts?: string;
}

interface AskActionOptions {
  [key: string]: unknown;
  branch?: string;
  clone?: boolean;
  noClone?: boolean;
  model?: string;
  verbose?: boolean;
}

interface DiffActionOptions {
  [key: string]: unknown;
  output?: string;
  format?: string;
  fullClone?: boolean;
  keepTemp?: boolean;
  verbose?: boolean;
}

interface DepsActionOptions {
  [key: string]: unknown;
  branch?: string;
  json?: boolean;
  diagram?: boolean;
  keepTemp?: boolean;
  verbose?: boolean;
}

interface WebActionOptions {
  [key: string]: unknown;
  port?: string;
}

interface DocsActionOptions {
  [key: string]: unknown;
  check?: boolean;
  fix?: boolean;
  branch?: string;
  verbose?: boolean;
}

interface DoctorActionOptions {
  [key: string]: unknown;
  json?: boolean;
}

interface StylesActionOptions {
  [key: string]: unknown;
  json?: boolean;
}

/**
 * Shared option shape for the deterministic, scan-based report commands
 * (`health`, `metrics`, `security`). They expose an identical flag surface.
 */
interface ScanActionOptions {
  [key: string]: unknown;
  branch?: string;
  check?: boolean;
  minScore?: string;
  json?: boolean;
  maxFiles?: string;
  keepTemp?: boolean;
  verbose?: boolean;
}

interface InitActionOptions {
  [key: string]: unknown;
  force?: boolean;
  print?: boolean;
  path?: string;
  style?: string;
}

interface CachePruneActionOptions {
  [key: string]: unknown;
  maxAge?: string;
}

interface CacheListActionOptions {
  [key: string]: unknown;
  json?: boolean;
}

function getOptionSource(command: Command, name: string): "cli" | "default" {
  return command.getOptionValueSource(name) === "cli" ? "cli" : "default";
}

function getActionOptions<T extends Record<string, unknown>>(opts: Command | T): T {
  return (typeof (opts as Command).opts === "function"
    ? (opts as Command).opts() as T
    : opts) as T;
}

function getCliFlagValue(flags: string[]): string | undefined {
  return getFlagValue(process.argv.slice(2), flags);
}

function hasCliFlag(flags: string[]): boolean {
  return hasFlag(process.argv.slice(2), flags);
}

function isNegativeOptionEnabled(
  opts: { [key: string]: unknown },
  negativeKey: string,
  positiveKey: string
): boolean {
  return opts[negativeKey] === true || opts[positiveKey] === false;
}

/** Resolved options passed to a scan-command runner. */
interface ScanRunnerOptions {
  branch: string;
  check: boolean;
  minScore: number;
  json: boolean;
  maxFiles: number;
  keepTemp: boolean;
  verbose: boolean;
}

type ScanCommandRunner = (repoUrl: string, options: ScanRunnerOptions) => Promise<void>;

/**
 * Register one of the deterministic, scan-based report commands (`scan`,
 * `health`, `metrics`, `security`). They share an identical flag surface and
 * option plumbing — including the raw-argv fallback for `-b/--branch` and
 * `-m/--max-files`, which collide with the root command's options — so this
 * helper keeps the registrations in lock-step and DRY.
 */
function registerScanCommand(config: {
  name: string;
  description: string;
  checkHelp: string;
  minScoreHelp: string;
  jsonHelp: string;
  run: ScanCommandRunner;
}): void {
  program
    .command(`${config.name} <repo-url>`)
    .description(config.description)
    .option("-b, --branch <branch>", "Branch to analyze", "")
    .option("--check", config.checkHelp)
    .option("--min-score <score>", config.minScoreHelp, "70")
    .option("--json", config.jsonHelp)
    .option("-m, --max-files <number>", "Maximum files to scan")
    .option("--keep-temp", "Keep temporary clone directory")
    .option("-v, --verbose", "Show detailed output")
    .action(async (repoUrl: string, rawOpts) => {
      const opts = getActionOptions<ScanActionOptions>(rawOpts as Command | ScanActionOptions);
      // `-b/--branch` and `-m/--max-files` collide with the root command's
      // options, which can capture them before the subcommand does. Fall back
      // to reading the raw argv (same approach as `diff --output`).
      const branch = opts.branch || getCliFlagValue(["--branch", "-b"]) || "";
      const maxFiles = opts.maxFiles || getCliFlagValue(["--max-files", "-m"]) || "500";
      await config.run(repoUrl, {
        branch,
        check: opts.check || false,
        minScore: parseInt(opts.minScore || "70", 10),
        json: opts.json || false,
        maxFiles: parseInt(maxFiles, 10),
        keepTemp: opts.keepTemp || false,
        verbose: opts.verbose || false,
      });
    });
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
  .option("-q, --quiet", "Suppress banner, progress, and file tree; print only the output path (for scripting/CI)")
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
  .action(async (repoUrl: string, rawOpts, command: Command) => {
    const opts = getActionOptions<MainActionOptions>(rawOpts as Command | MainActionOptions);
    const options: BootcampOptions = {
      branch: opts.branch || "",
      focus: opts.focus as BootcampOptions["focus"],
      audience: opts.audience as BootcampOptions["audience"],
      output: opts.output || "",
      format: (opts.format || "markdown") as OutputFormat,
      maxFiles: parseInt(opts.maxFiles || "200", 10),
      noClone: isNegativeOptionEnabled(opts, "noClone", "clone"),
      verbose: opts.verbose || false,
      quiet: opts.quiet || false,
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
      watchInterval: parseInt(opts.watchInterval || "30", 10),
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

    if (options.quiet && options.verbose) {
      console.error(chalk.red("--quiet and --verbose are mutually exclusive."));
      process.exit(1);
    }

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
  .action(async (repoUrl: string, rawOpts) => {
    const opts = getActionOptions<AskActionOptions>(rawOpts as Command | AskActionOptions);
    await runAskCommand(repoUrl, {
      branch: opts.branch || getCliFlagValue(["--branch", "-b"]),
      model: opts.model || getCliFlagValue(["--model"]),
      noClone: isNegativeOptionEnabled(opts, "noClone", "clone"),
      verbose: opts.verbose,
    });
  });

program
  .command("diff <repo-pr>")
  .description("Generate onboarding diff for a GitHub PR")
  .option("-o, --output <dir>", "Output directory")
  .option("--format <format>", "Output format: markdown, html, pdf")
  .option("--full-clone", "Perform a full clone instead of shallow clone (slower but includes full history)")
  .option("--keep-temp", "Keep temporary clone directory")
  .option("-v, --verbose", "Show detailed output")
  .action(async (repoPr: string, rawOpts) => {
    const opts = getActionOptions<DiffActionOptions>(rawOpts as Command | DiffActionOptions);
    await runPullRequestDiff(repoPr, {
      output: opts.output || getCliFlagValue(["--output", "-o"]),
      format: opts.format || getCliFlagValue(["--format"]),
      fullClone: opts.fullClone || hasCliFlag(["--full-clone"]),
      keepTemp: opts.keepTemp || hasCliFlag(["--keep-temp"]),
      verbose: opts.verbose || hasCliFlag(["--verbose", "-v"]),
    });
  });

program
  .command("web")
  .alias("serve")
  .description("Start local web demo server")
  .option("-p, --port <port>", "Port to listen on", "3000")
  .action((rawOpts) => {
    const opts = getActionOptions<WebActionOptions>(rawOpts as Command | WebActionOptions);
    startServer(parseInt(opts.port || "3000", 10));
  });

program
  .command("docs <repo-url>")
  .description("Analyze repo documentation for staleness and mismatches (supports local paths)")
  .option("--check", "Exit with code 1 if docs are stale (for CI)")
  .option("--fix", "Auto-fix stale documentation sections")
  .option("-b, --branch <branch>", "Branch to analyze", "")
  .option("-v, --verbose", "Show detailed output")
  .action(async (repoUrl: string, rawOpts) => {
    const opts = getActionOptions<DocsActionOptions>(rawOpts as Command | DocsActionOptions);
    await runDocsCommand(repoUrl, {
      check: opts.check,
      fix: opts.fix,
      branch: opts.branch || getCliFlagValue(["--branch", "-b"]),
      verbose: opts.verbose || hasCliFlag(["--verbose", "-v"]),
    });
  });

registerScanCommand({
  name: "scan",
  description:
    "Scan a repository once and report a combined health + metrics + security dashboard, gated on the lowest of the three scores (supports local paths)",
  checkHelp: "Exit with code 1 if the lowest of the three scores is below --min-score (for CI)",
  minScoreHelp: "Minimum passing score for --check, applied to the lowest of the three scores (0-100)",
  jsonHelp: "Output the combined report (all three analyses plus a score summary) as JSON",
  run: runScanCommand,
});

registerScanCommand({
  name: "health",
  description:
    "Score a repository's onboarding-readiness: docs, community, quality, and automation (supports local paths)",
  checkHelp: "Exit with code 1 if the health score is below --min-score (for CI)",
  minScoreHelp: "Minimum passing score for --check (0-100)",
  jsonHelp: "Output the health report as JSON for machine consumption",
  run: runHealthCommand,
});

registerScanCommand({
  name: "metrics",
  description:
    "Report deterministic codebase metrics: languages, size, hotspots, and an approachability score (supports local paths)",
  checkHelp: "Exit with code 1 if the approachability score is below --min-score (for CI)",
  minScoreHelp: "Minimum passing approachability score for --check (0-100)",
  jsonHelp: "Output the metrics report as JSON for machine consumption",
  run: runMetricsCommand,
});

registerScanCommand({
  name: "security",
  description:
    "Run deterministic security pattern analysis: findings, protections, and a 0-100 score (supports local paths)",
  checkHelp: "Exit with code 1 if the security score is below --min-score (for CI)",
  minScoreHelp: "Minimum passing security score for --check (0-100)",
  jsonHelp: "Output the security report as JSON for machine consumption",
  run: runSecurityCommand,
});

program
  .command("deps <repo-url>")
  .description(
    "Report a repository's dependencies grouped by category and ecosystem (npm, Cargo, pip/Poetry, Go) without invoking the LLM (supports local paths)"
  )
  .option("-b, --branch <branch>", "Branch to analyze", "")
  .option("--json", "Output the dependency analysis as JSON for machine consumption")
  .option("--diagram", "Print the Mermaid dependency graph instead of the human-readable report")
  .option("--keep-temp", "Keep temporary clone directory")
  .option("-v, --verbose", "Show detailed output")
  .action(async (repoUrl: string, rawOpts) => {
    const opts = getActionOptions<DepsActionOptions>(rawOpts as Command | DepsActionOptions);
    // `-b/--branch` collides with the root command's option, which can capture
    // it before the subcommand does — fall back to the raw argv (same approach
    // as the scan-based report commands).
    await runDepsCommand(repoUrl, {
      branch: opts.branch || getCliFlagValue(["--branch", "-b"]) || "",
      json: opts.json || false,
      diagram: opts.diagram || false,
      keepTemp: opts.keepTemp || hasCliFlag(["--keep-temp"]),
      verbose: opts.verbose || hasCliFlag(["--verbose", "-v"]),
    });
  });

program
  .command("init")
  .description("Scaffold a .bootcamprc.json config file in the current directory")
  .option("--force", "Overwrite an existing config file")
  .option("--print", "Print the config to stdout instead of writing a file")
  .option("--path <file>", "Path to write the config file", ".bootcamprc.json")
  .option("-s, --style <style>", "Preset a style pack: corporate, startup, oss, academic, minimal")
  .action(async (rawOpts) => {
    const opts = getActionOptions<InitActionOptions>(rawOpts as Command | InitActionOptions);
    await runInitCommand({
      force: opts.force || false,
      print: opts.print || false,
      path: opts.path,
      style: opts.style || getCliFlagValue(["--style", "-s"]),
    });
  });

program
  .command("doctor")
  .description("Diagnose your environment for running bootcamp (Node, git, gh, auth, cache)")
  .option("--json", "Output diagnostics as JSON for machine consumption")
  .action(async (rawOpts) => {
    const opts = getActionOptions<DoctorActionOptions>(rawOpts as Command | DoctorActionOptions);
    await runDoctor({ json: opts.json });
  });

program
  .command("styles")
  .alias("style")
  .description("List the built-in style packs and the doc sections each one enables")
  .option("--json", "Output the style packs as JSON for machine consumption")
  .action((rawOpts) => {
    const opts = getActionOptions<StylesActionOptions>(rawOpts as Command | StylesActionOptions);
    runStylesCommand({ json: opts.json });
  });

program
  .command("completion <shell>")
  .description("Print a shell completion script (bash, zsh, or fish)")
  .action((shell: string) => {
    runCompletionCommand(program, { shell });
  });

const cacheCommand = program
  .command("cache")
  .description("Manage the analysis cache");

cacheCommand
  .command("prune")
  .description("Remove cache entries older than a given age")
  .option("--max-age <days>", "Maximum age in days", "7")
  .action(async (rawOpts) => {
    const opts = getActionOptions<CachePruneActionOptions>(rawOpts as Command | CachePruneActionOptions);
    const days = parseFloat(opts.maxAge || "7");
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

cacheCommand
  .command("list")
  .alias("ls")
  .description("List cache entries with repo, phase, age, and size")
  .option("--json", "Output as JSON for machine consumption")
  .action(async (rawOpts) => {
    const opts = getActionOptions<CacheListActionOptions>(rawOpts as Command | CacheListActionOptions);
    await runCacheList({ json: opts.json });
  });

const isCliEntry = Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCliEntry) {
  program.parse();
}

export { program };
