import chalk from "chalk";

import {
  computeCodebaseMetrics,
  formatBytes,
  type CodebaseMetrics,
} from "../metrics.js";
import { resolveRepo, type RepoSource } from "../repo-resolver.js";
import { scanRepositoryFiles } from "../services/clone-service.js";

/** Options accepted by the `bootcamp metrics` command. */
export interface MetricsCommandOptions {
  branch?: string;
  /** Emit the report as JSON for machine consumption. */
  json?: boolean;
  /** Exit non-zero when the approachability score is below `minScore` (CI gate). */
  check?: boolean;
  /** Minimum passing approachability score for `--check` (0-100). Defaults to 70. */
  minScore?: number;
  /** Maximum files to scan. Defaults to 500. */
  maxFiles?: number;
  /** Keep the temporary clone (remote repos only). */
  keepTemp?: boolean;
  verbose?: boolean;
}

function scoreColor(score: number): typeof chalk.green {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.yellow;
  return chalk.red;
}

/** Render a compact horizontal bar for a 0-100 percentage. */
function bar(percentage: number, width = 20): string {
  const filled = Math.round((Math.min(100, Math.max(0, percentage)) / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function printReport(metrics: CodebaseMetrics, repoName: string): void {
  const appr = metrics.approachability;
  const emoji = appr.score >= 80 ? "🟢" : appr.score >= 60 ? "🟡" : "🔴";
  const color = scoreColor(appr.score);

  console.log(chalk.bold("\n📊 Codebase Metrics"));
  console.log(chalk.dim(`Repository: ${repoName}`));
  console.log(
    chalk.dim(
      `${metrics.totalFiles} files · ${formatBytes(metrics.totalBytes)} · size class: ${metrics.sizeClass}\n`
    )
  );

  console.log(`${emoji} ` + chalk.bold("Approachability ") + color.bold(`${appr.score}/100 (Grade: ${appr.grade})`));
  if (appr.factors.length > 0) {
    for (const factor of appr.factors) {
      console.log(chalk.dim(`  • ${factor}`));
    }
  }
  console.log();

  console.log(chalk.bold("Composition"));
  console.log(
    chalk.dim("  ") +
      chalk.cyan(`${metrics.sourceFiles} source`) +
      chalk.dim(" · ") +
      `${metrics.testFiles} test` +
      chalk.dim(" · ") +
      `${metrics.docFiles} docs` +
      chalk.dim(" · ") +
      `${metrics.configFiles} config` +
      chalk.dim(" · ") +
      `${metrics.otherFiles} other`
  );
  console.log(
    chalk.dim(
      `  avg file ${formatBytes(metrics.averageFileBytes)} · median ${formatBytes(metrics.medianFileBytes)} · test:source ${metrics.testToSourceRatio.toFixed(2)}`
    )
  );
  console.log();

  if (metrics.languages.length > 0) {
    console.log(chalk.bold("Languages"));
    for (const lang of metrics.languages) {
      const label = lang.language.padEnd(14);
      console.log(
        `  ${chalk.cyan(label)} ${chalk.dim(bar(lang.percentage))} ${lang.percentage.toFixed(1)}% ` +
          chalk.dim(`(${lang.files} file${lang.files === 1 ? "" : "s"})`)
      );
    }
    console.log();
  }

  if (metrics.directories.length > 0) {
    console.log(chalk.bold("Top-level distribution"));
    for (const dir of metrics.directories) {
      const label = dir.path.padEnd(20);
      console.log(
        `  ${chalk.cyan(label)} ${dir.percentage.toFixed(1)}% ` +
          chalk.dim(`(${dir.files} file${dir.files === 1 ? "" : "s"}, ${formatBytes(dir.bytes)})`)
      );
    }
    console.log();
  }

  if (metrics.hotspots.length > 0) {
    console.log(chalk.bold("Largest files") + chalk.dim(" (review hotspots)"));
    for (const hotspot of metrics.hotspots) {
      console.log(`  ${chalk.dim(formatBytes(hotspot.bytes).padStart(9))}  ` + chalk.cyan(hotspot.path));
    }
    console.log();
  }
}

/**
 * Run the standalone `bootcamp metrics` command: clone/resolve the target repo,
 * scan it, compute deterministic codebase metrics, and report them (human or
 * JSON). With `--check`, exits non-zero when the approachability score is below
 * `--min-score`. Reuses the same `computeCodebaseMetrics` engine that powers
 * `METRICS.md`.
 */
export async function runMetricsCommand(repoUrl: string, opts: MetricsCommandOptions): Promise<void> {
  const minScore = typeof opts.minScore === "number" && Number.isFinite(opts.minScore) ? opts.minScore : 70;

  let repoSource: RepoSource;
  try {
    repoSource = await resolveRepo(repoUrl, process.cwd(), opts.branch || undefined);
  } catch (error: unknown) {
    console.error(
      chalk.red(`Failed to resolve repository: ${error instanceof Error ? error.message : String(error)}`)
    );
    process.exit(1);
    return;
  }

  let exitCode = 0;
  try {
    const scan = await scanRepositoryFiles(repoSource.path, opts.maxFiles ?? 500);
    const metrics = computeCodebaseMetrics(scan);

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            repo: repoSource.repoInfo.fullName,
            filesScanned: scan.files.length,
            ...metrics,
          },
          null,
          2
        )
      );
    } else {
      printReport(metrics, repoSource.repoInfo.fullName);
    }

    if (opts.check && metrics.approachability.score < minScore) {
      if (!opts.json) {
        console.error(
          chalk.red(
            `❌ Approachability ${metrics.approachability.score}/100 is below the required minimum of ${minScore}.`
          )
        );
      }
      exitCode = 1;
    }
  } catch (error: unknown) {
    console.error(
      chalk.red(`Metrics analysis failed: ${error instanceof Error ? error.message : String(error)}`)
    );
    exitCode = 1;
  } finally {
    if (opts.keepTemp && !repoSource.isLocal) {
      console.log(chalk.gray(`Temporary clone kept at: ${repoSource.path}`));
    } else {
      await repoSource.cleanup();
    }
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
