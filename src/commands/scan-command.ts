import chalk from "chalk";
import pkg from "../../package.json" with { type: "json" };
import {
  SCAN_SCHEMA_VERSION,
  readScanBaseline,
  compareScanSnapshots,
  formatScanComparison,
  type ScanSnapshot,
} from "../scan-baseline.js";
import { readContainedFile } from "../fs-safe.js";

import { extractDependencies } from "../deps.js";
import { computeRepoHealth, type RepoHealth } from "../health.js";
import { computeCodebaseMetrics, type CodebaseMetrics } from "../metrics.js";
import { generateTechRadar, getRiskEmoji } from "../radar.js";
import { analyzeSecurityPatterns, getSecurityGrade, type SecurityAnalysis } from "../security.js";
import { scanRepositoryFiles } from "../services/clone-service.js";
import type { TechRadar } from "../types.js";
import { finiteOr } from "../utils.js";
import { withResolvedRepo } from "./_shared.js";

/** Options accepted by the `bootcamp scan` command. */
export interface ScanCommandOptions {
  branch?: string;
  /** Compare with a previous scan JSON report. */
  baseline?: string;
  /** Maximum per-score deterioration allowed by --check with --baseline. */
  maxRegression?: number;
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
  radar: TechRadar,
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
      getSecurityGrade(security.score, security.sourceFilesScanned),
      `${secFindings} finding${secFindings === 1 ? "" : "s"}`
    )
  );
  // Onboarding risk is lower-is-better, so it's shown distinctly (not gated).
  const risk = radar.onboardingRisk;
  console.log(
    `  ${getRiskEmoji(risk.grade)} ${chalk.bold("Onboarding")} ` +
      chalk.dim(`risk ${String(risk.score).padStart(3)}/100 (${risk.grade}) · lower is better`)
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
    const negative = metrics.approachability.factors.find((f) =>
      /large|complex|big|above/i.test(f)
    );
    if (negative) {
      tips.push(`Metrics: ${negative}`);
    }
  }
  if (risk.factors.length > 0) {
    tips.push(`Onboarding: ${risk.factors[0]}`);
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
      chalk.cyan("bootcamp health|metrics|security|radar <repo>") +
      chalk.dim(" for the full per-area report.\n")
  );
}

/**
 * Run the standalone `bootcamp scan` command: clone/resolve the target repo
 * once, then run the deterministic analyses (health, metrics, security, plus a
 * tech-radar onboarding-risk score) from that single scan and print a combined
 * dashboard (or `--json`). With `--check`, exits non-zero when the lowest of the
 * three *higher-is-better* scores (health/metrics/security) is below
 * `--min-score`; onboarding risk is shown but, being lower-is-better, is not
 * part of the absolute gate. With --baseline, --check also gates deterioration
 * in all four scores, respecting the lower-is-better onboarding-risk direction.
 */
export async function runScanCommand(repoUrl: string, opts: ScanCommandOptions): Promise<void> {
  const minScore = finiteOr(opts.minScore, 70);
  const maxFiles = finiteOr(opts.maxFiles, 500, { min: 1 });
  const metadata = { schemaVersion: SCAN_SCHEMA_VERSION, analyzerVersion: pkg.version, maxFiles };
  let baseline: ScanSnapshot | undefined;
  try {
    if (opts.maxRegression !== undefined && (!opts.baseline || !opts.check)) {
      throw new Error("--max-regression requires both --baseline and --check.");
    }
    if (
      opts.maxRegression !== undefined &&
      (!Number.isFinite(opts.maxRegression) || opts.maxRegression < 0 || opts.maxRegression > 100)
    ) {
      throw new Error("--max-regression must be a finite number from 0 to 100.");
    }
    if (opts.baseline !== undefined) {
      if (
        opts.minScore !== undefined &&
        (!Number.isFinite(opts.minScore) || opts.minScore < 0 || opts.minScore > 100)
      ) {
        throw new Error("Baseline comparisons require --min-score from 0 to 100.");
      }
      if (!opts.baseline.trim()) throw new Error("--baseline requires a JSON file path.");
      if (
        opts.maxFiles !== undefined &&
        (!Number.isSafeInteger(opts.maxFiles) || opts.maxFiles < 1)
      ) {
        throw new Error("Baseline comparisons require a positive integer --max-files.");
      }
      baseline = await readScanBaseline(opts.baseline, metadata);
    }
  } catch (error: unknown) {
    console.error(
      chalk.red("Scan failed: " + (error instanceof Error ? error.message : String(error)))
    );
    process.exit(1);
    return;
  }

  await withResolvedRepo(repoUrl, opts, "Scan failed", async (repoSource) => {
    const scan = await scanRepositoryFiles(repoSource.path, maxFiles);
    const packageJson = await readContainedFile(repoSource.path, "package.json")
      .then((content) => JSON.parse(content) as Record<string, unknown>)
      .catch(() => undefined);

    const health = computeRepoHealth(scan);
    const metrics = computeCodebaseMetrics(scan);
    const security = await analyzeSecurityPatterns(repoSource.path, scan.files, packageJson);
    const deps = await extractDependencies(repoSource.path);
    const radar = generateTechRadar(
      scan.stack,
      scan.files,
      deps,
      security,
      !!scan.readme,
      !!scan.contributing
    );
    const scores = combinedScores(health, metrics, security);
    const filesScanned = scan.files.length;

    const report = {
      metadata,
      repo: repoSource.repoInfo.fullName,
      filesScanned,
      scores: {
        health: { score: health.score, grade: health.grade },
        metrics: { score: metrics.approachability.score, grade: metrics.approachability.grade },
        security: {
          score: security.score,
          grade: getSecurityGrade(security.score, security.sourceFilesScanned),
        },
        onboardingRisk: { score: radar.onboardingRisk.score, grade: radar.onboardingRisk.grade },
        lowest: scores.lowest,
      },
      health,
      metrics,
      security,
      onboardingRisk: radar.onboardingRisk,
    };
    const comparison = baseline
      ? compareScanSnapshots(baseline, report, opts.maxRegression ?? 0)
      : undefined;
    if (opts.json) {
      console.log(JSON.stringify({ ...report, ...(comparison && { comparison }) }, null, 2));
    } else {
      printReport(health, metrics, security, radar, repoSource.repoInfo.fullName, filesScanned);
      if (comparison) console.log(formatScanComparison(comparison));
    }

    if (opts.check && comparison?.regressed) {
      if (!opts.json)
        console.error(chalk.red("Scan scores regressed beyond the allowed tolerance."));
      return 1;
    }

    if (opts.check && scores.lowest < minScore) {
      if (!opts.json) {
        console.error(
          chalk.red(
            `❌ Lowest score ${scores.lowest}/100 is below the required minimum of ${minScore}.`
          )
        );
      }
      return 1;
    }

    return 0;
  });
}
