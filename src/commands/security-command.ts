import chalk from "chalk";
import { readFile } from "fs/promises";
import { join } from "path";

import {
  analyzeSecurityPatterns,
  getSecurityGrade,
  type SecurityAnalysis,
  type Severity,
} from "../security.js";
import { scanRepositoryFiles } from "../services/clone-service.js";
import { finiteOr } from "../utils.js";
import { withResolvedRepo } from "./_shared.js";

/** Options accepted by the `bootcamp security` command. */
export interface SecurityCommandOptions {
  branch?: string;
  /** Emit the report as JSON for machine consumption. */
  json?: boolean;
  /** Exit non-zero when the security score is below `minScore` (CI gate). */
  check?: boolean;
  /** Minimum passing score for `--check` (0-100). Defaults to 70. */
  minScore?: number;
  /** Maximum files to scan. Defaults to 500. */
  maxFiles?: number;
  /** Keep the temporary clone (remote repos only). */
  keepTemp?: boolean;
  verbose?: boolean;
}

const SEVERITY_ICON: Record<Severity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  info: "⚪",
};

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

function scoreColor(score: number): typeof chalk.green {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.yellow;
  return chalk.red;
}

function checkmark(value: boolean): string {
  return value ? chalk.green("✓") : chalk.dim("·");
}

function printReport(analysis: SecurityAnalysis, repoName: string, filesScanned: number): void {
  const grade = getSecurityGrade(analysis.score, analysis.sourceFilesScanned);
  const emoji = analysis.score >= 80 ? "🟢" : analysis.score >= 60 ? "🟡" : "🔴";
  const color = scoreColor(analysis.score);

  console.log(chalk.bold("\n🔒 Security Analysis"));
  console.log(chalk.dim(`Repository: ${repoName}`));
  console.log(chalk.dim(`Scanned ${filesScanned} files\n`));

  console.log(`${emoji} ` + color.bold(`${analysis.score}/100 (Grade: ${grade})`));

  const counts = SEVERITY_ORDER.map(
    (sev) => [sev, analysis.findings.filter((f) => f.severity === sev).length] as const
  ).filter(([, n]) => n > 0);
  if (counts.length > 0) {
    console.log(
      chalk.dim("Findings: ") +
        counts.map(([sev, n]) => `${SEVERITY_ICON[sev]} ${n} ${sev}`).join(chalk.dim(" · "))
    );
  } else {
    console.log(chalk.green("No pattern-based findings detected."));
  }
  console.log();

  console.log(chalk.bold("Protections"));
  console.log(
    `  ${checkmark(analysis.headers.hasHelmet)} security headers (helmet)` +
      `   ${checkmark(analysis.headers.hasCors)} CORS` +
      `   ${checkmark(analysis.headers.hasCSP)} CSP`
  );
  console.log(
    `  ${checkmark(analysis.hasRateLimiting)} rate limiting` +
      `   ${checkmark(analysis.hasInputValidation)} input validation` +
      `   ${checkmark(analysis.hasSqlInjectionPrevention)} SQL-injection prevention`
  );
  console.log(
    `  ${checkmark(analysis.secretsHandling.gitignoreSecrets)} secrets git-ignored` +
      `   ${checkmark(analysis.secretsHandling.hasEnvExample)} .env.example present`
  );
  console.log();

  if (analysis.securityDeps.length > 0) {
    console.log(chalk.bold("Security dependencies"));
    for (const dep of analysis.securityDeps) {
      console.log(
        `  ${chalk.cyan(dep.name)}` + (dep.purpose ? chalk.dim(` — ${dep.purpose}`) : "")
      );
    }
    console.log();
  }

  if (analysis.findings.length > 0) {
    console.log(chalk.bold("Findings") + chalk.dim(" (most severe first)"));
    const sorted = [...analysis.findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    );
    for (const finding of sorted) {
      const where = finding.file
        ? chalk.dim(` (${finding.file}${finding.line ? `:${finding.line}` : ""})`)
        : "";
      console.log(`  ${SEVERITY_ICON[finding.severity]} ` + chalk.cyan(finding.title) + where);
      if (finding.recommendation) {
        console.log(chalk.dim(`      → ${finding.recommendation}`));
      }
    }
    console.log();
  }
}

/**
 * Run the standalone `bootcamp security` command: clone/resolve the target
 * repo, scan it, run the deterministic security pattern analysis, and report
 * it (human or JSON). With `--check`, exits non-zero when the score is below
 * `--min-score`. Reuses the same `analyzeSecurityPatterns` engine that powers
 * `SECURITY.md` — mirroring `bootcamp health` and `bootcamp metrics`.
 */
export async function runSecurityCommand(
  repoUrl: string,
  opts: SecurityCommandOptions
): Promise<void> {
  const minScore = finiteOr(opts.minScore, 70);

  await withResolvedRepo(repoUrl, opts, "Security analysis failed", async (repoSource) => {
    const scan = await scanRepositoryFiles(
      repoSource.path,
      finiteOr(opts.maxFiles, 500, { min: 1 })
    );
    const packageJson = await readFile(join(repoSource.path, "package.json"), "utf-8")
      .then((content) => JSON.parse(content) as Record<string, unknown>)
      .catch(() => undefined);
    const analysis = await analyzeSecurityPatterns(repoSource.path, scan.files, packageJson);
    const filesScanned = scan.files.length;

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            repo: repoSource.repoInfo.fullName,
            filesScanned,
            grade: getSecurityGrade(analysis.score, analysis.sourceFilesScanned),
            ...analysis,
          },
          null,
          2
        )
      );
    } else {
      printReport(analysis, repoSource.repoInfo.fullName, filesScanned);
    }

    if (opts.check && analysis.score < minScore) {
      if (!opts.json) {
        console.error(
          chalk.red(
            `❌ Security score ${analysis.score}/100 is below the required minimum of ${minScore}.`
          )
        );
      }
      return 1;
    }

    return 0;
  });
}
