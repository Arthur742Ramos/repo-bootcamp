import chalk from "chalk";

import { computeRepoHealth, type HealthCategory, type HealthStatus, type RepoHealth } from "../health.js";
import { resolveRepo, type RepoSource } from "../repo-resolver.js";
import { scanRepositoryFiles } from "../services/clone-service.js";

/** Options accepted by the `bootcamp health` command. */
export interface HealthCommandOptions {
  branch?: string;
  /** Emit the report as JSON for machine consumption. */
  json?: boolean;
  /** Exit non-zero when the score is below `minScore` (CI gate). */
  check?: boolean;
  /** Minimum passing score for `--check` (0-100). Defaults to 70. */
  minScore?: number;
  /** Maximum files to scan. Defaults to 500. */
  maxFiles?: number;
  /** Keep the temporary clone (remote repos only). */
  keepTemp?: boolean;
  verbose?: boolean;
}

const STATUS_ICON: Record<HealthStatus, string> = {
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
};

const CATEGORY_ORDER: HealthCategory[] = ["Documentation", "Community", "Quality", "Automation"];

function scoreColor(score: number): typeof chalk.green {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.yellow;
  return chalk.red;
}

function printReport(health: RepoHealth, repoName: string): void {
  const emoji = health.score >= 80 ? "🟢" : health.score >= 60 ? "🟡" : "🔴";
  const color = scoreColor(health.score);

  console.log(chalk.bold("\n🩺 Repo Health"));
  console.log(chalk.dim(`Repository: ${repoName}\n`));

  console.log(`${emoji} ` + color.bold(`${health.score}/100 (Grade: ${health.grade})`));
  console.log(
    chalk.dim(
      `${health.passCount} passed · ${health.warnCount} warning${health.warnCount === 1 ? "" : "s"} · ${health.failCount} missing\n`
    )
  );

  for (const category of CATEGORY_ORDER) {
    const checks = health.checks.filter((check) => check.category === category);
    if (checks.length === 0) continue;
    console.log(chalk.bold(category));
    for (const check of checks) {
      console.log(`  ${STATUS_ICON[check.status]} ` + chalk.cyan(check.label) + chalk.dim(` — ${check.detail}`));
    }
    console.log();
  }

  if (health.recommendations.length > 0) {
    console.log(chalk.bold("Recommendations") + chalk.dim(" (highest impact first)"));
    health.recommendations.forEach((recommendation, index) => {
      console.log(chalk.dim(`  ${index + 1}. `) + recommendation);
    });
    console.log();
  } else {
    console.log(chalk.green("🎉 No gaps detected — this repository covers the onboarding-readiness checklist.\n"));
  }
}

/**
 * Run the standalone `bootcamp health` command: clone/resolve the target repo,
 * scan it, compute the deterministic onboarding-readiness score, and report it
 * (human-readable or JSON). With `--check`, exits non-zero below `--min-score`.
 */
export async function runHealthCommand(repoUrl: string, opts: HealthCommandOptions): Promise<void> {
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
    const health = computeRepoHealth(scan);

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            repo: repoSource.repoInfo.fullName,
            score: health.score,
            grade: health.grade,
            passCount: health.passCount,
            warnCount: health.warnCount,
            failCount: health.failCount,
            earnedWeight: health.earnedWeight,
            totalWeight: health.totalWeight,
            checks: health.checks,
            recommendations: health.recommendations,
          },
          null,
          2
        )
      );
    } else {
      printReport(health, repoSource.repoInfo.fullName);
    }

    if (opts.check && health.score < minScore) {
      if (!opts.json) {
        console.error(
          chalk.red(`❌ Repo health ${health.score}/100 is below the required minimum of ${minScore}.`)
        );
      }
      exitCode = 1;
    }
  } catch (error: unknown) {
    console.error(
      chalk.red(`Health analysis failed: ${error instanceof Error ? error.message : String(error)}`)
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
