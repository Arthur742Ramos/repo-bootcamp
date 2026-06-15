import chalk from "chalk";
import { readFile } from "fs/promises";
import { join } from "path";

import { computeRepoHealth, type RepoHealth } from "../health.js";
import { computeCodebaseMetrics, type CodebaseMetrics } from "../metrics.js";
import { resolveRepo, type RepoSource } from "../repo-resolver.js";
import {
  analyzeSecurityPatterns,
  getSecurityGrade,
  type SecurityAnalysis,
} from "../security.js";
import { scanRepositoryFiles } from "../services/clone-service.js";

/** Options accepted by the `bootcamp scan` command. */
export interface ScanCommandOptions {
  branch?: string;
  /** Emit the combined report as JSON for machine consumption. */
  json?: boolean;
  /** Exit non-zero when the lowest of the three scores is below `minScore`. */
  check?: boolean;
  /** Minimum passing score for `--check` (0-100). Defaults to 70. */
  minScore?: number;
  /** Maximum files to scan. Defaults to 500. */
  maxFiles?: number;
  /** Keep the temporary clone (remote repos only). */
  keepTemp?: boolean;
  verbose?: boolean;
}

/** The three deterministic scores produced by a combined scan. */
export interface CombinedScores {
  health: number;
  metrics: number;
  security: number;
  /** The lowest of the three — what `--check` gates on. */
  lowest: number;
}

/** Extract the three headline scores from the individual analyses. */
export function combinedScores(
  health: RepoHealth,
  metrics: CodebaseMetrics,
  security: SecurityAnalysis
): CombinedScores {
  const health_ = health.score;
  const metrics_ = metrics.approachability.score;
  const security_ = security.score;
  return {
    health: health_,
    metrics: metrics_,
    security: security_,
    lowest: Math.min(health_, metrics_, security_),
  };
}

function scoreColor(score: number): typeof chalk.green {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.yellow;
  return chalk.red;
}

function scoreEmoji(score: number): string {
  return score >= 80 ? "🟢" : score >= 60 ? "🟡" : "🔴";
}

function scoreLine(label: string, score: number, grade: string, detail: string): string {
  const color = scoreColor(score);
  const padded = label.padEnd(10);
  return (
    `  ${scoreEmoji(score)} ${chalk.bold(padded)} ` +
    color(`${String(score).padStart(3)}/100 (${grade})`) +
    chalk.dim(`  ${detail}`)
  );
}

function printReport(
  health: RepoHealth,
  metrics: CodebaseMetrics,
  security: SecurityAnalysis,
  repoName: string,
  filesScanned: number
): void {
  console.log(chalk.bold("\n🧭 Repository Scan"));
  console.log(chalk.dim(`Repository: ${repoName}`));
  console.log(chalk.dim(`Scanned ${filesScanned} files\n`));

  console.log(
    scoreLine(
      "Health",
      health.score,
      health.grade,
      `${health.passCount} passed · ${health.warnCount} warnings · ${health.failCount} missing`
    )
  );
  console.log(
    scoreLine(
      "Metrics",
      metrics.approachability.score,
      metrics.approachability.grade,
      `${metrics.totalFiles} files · ${metrics.sourceFiles} source · ${metrics.sizeClass}`
    )
  );
  const secFindings = security.findings.length;
  console.log(
    scoreLine(
      "Security",
      security.score,
      getSecurityGrade(security.score),
      `${secFindings} finding${secFindings === 1 ? "" : "s"}`
    )
  );
  console.log();

  // A few of the highest-impact recommendations across the reports.
  const tips: string[] = [];
  if (health.recommendations.length > 0) {
    tips.push(`Health: ${health.recommendations[0]}`);
  }
  const criticalOrHigh = security.findings.find(
    (f) => f.severity === "critical" || f.severity === "high"
  );
  if (criticalOrHigh) {
    tips.push(`Security: ${criticalOrHigh.recommendation || criticalOrHigh.title}`);
  }
  if (metrics.approachability.factors.length > 0) {
    const negative = metrics.approachability.factors.find((f) => /large|complex|big|above/i.test(f));
    if (negative) {
      tips.push(`Metrics: ${negative}`);
    }
  }
  if (tips.length > 0) {
    console.log(chalk.bold("Top suggestions"));
    for (const tip of tips) {
      console.log(chalk.dim("  • ") + tip);
    }
    console.log();
  }

  console.log(
    chalk.dim("Run ") +
      chalk.cyan("bootcamp health|metrics|security <repo>") +
      chalk.dim(" for the full per-area report.\n")
  );
}

/**
 * Run the standalone `bootcamp scan` command: clone/resolve the target repo
 * once, then run all three deterministic analyses (health, metrics, security)
 * from that single scan and print a combined dashboard (or `--json`). With
 * `--check`, exits non-zero when the lowest of the three scores is below
 * `--min-score`.
 */
export async function runScanCommand(repoUrl: string, opts: ScanCommandOptions): Promise<void> {
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
    const packageJson = await readFile(join(repoSource.path, "package.json"), "utf-8")
      .then((content) => JSON.parse(content) as Record<string, unknown>)
      .catch(() => undefined);

    const health = computeRepoHealth(scan);
    const metrics = computeCodebaseMetrics(scan);
    const security = await analyzeSecurityPatterns(repoSource.path, scan.files, packageJson);
    const scores = combinedScores(health, metrics, security);
    const filesScanned = scan.files.length;

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            repo: repoSource.repoInfo.fullName,
            filesScanned,
            scores: {
              health: { score: health.score, grade: health.grade },
              metrics: { score: metrics.approachability.score, grade: metrics.approachability.grade },
              security: { score: security.score, grade: getSecurityGrade(security.score) },
              lowest: scores.lowest,
            },
            health,
            metrics,
            security,
          },
          null,
          2
        )
      );
    } else {
      printReport(health, metrics, security, repoSource.repoInfo.fullName, filesScanned);
    }

    if (opts.check && scores.lowest < minScore) {
      if (!opts.json) {
        console.error(
          chalk.red(
            `❌ Lowest score ${scores.lowest}/100 is below the required minimum of ${minScore}.`
          )
        );
      }
      exitCode = 1;
    }
  } catch (error: unknown) {
    console.error(
      chalk.red(`Scan failed: ${error instanceof Error ? error.message : String(error)}`)
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
