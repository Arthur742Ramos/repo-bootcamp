import chalk from "chalk";
import { readFile } from "fs/promises";
import { join } from "path";

import { extractDependencies } from "../deps.js";
import { generateTechRadar, getRiskEmoji } from "../radar.js";
import { analyzeSecurityPatterns } from "../security.js";
import { scanRepositoryFiles } from "../services/clone-service.js";
import type { TechRadar } from "../types.js";
import { finiteOr } from "../utils.js";
import { withResolvedRepo } from "./_shared.js";

/** Options accepted by the `bootcamp radar` command. */
export interface RadarCommandOptions {
  branch?: string;
  /** Emit the radar report as JSON for machine consumption. */
  json?: boolean;
  /** Exit non-zero when the onboarding-risk score exceeds `maxRisk` (CI gate). */
  check?: boolean;
  /** Maximum acceptable onboarding-risk score for `--check` (0-100). Defaults to 50. */
  maxRisk?: number;
  /** Maximum files to scan. Defaults to 500. */
  maxFiles?: number;
  /** Keep the temporary clone (remote repos only). */
  keepTemp?: boolean;
  verbose?: boolean;
}

/** Display metadata for each radar ring, in best-to-worst order. */
const CATEGORY_META: Array<{
  key: "modern" | "stable" | "legacy" | "risky";
  label: string;
  color: typeof chalk.green;
}> = [
  { key: "modern", label: "Modern", color: chalk.green },
  { key: "stable", label: "Stable", color: chalk.cyan },
  { key: "legacy", label: "Legacy", color: chalk.yellow },
  { key: "risky", label: "Risky", color: chalk.red },
];

function printReport(radar: TechRadar, repoName: string, filesScanned: number): void {
  const { onboardingRisk } = radar;

  console.log(chalk.bold("\n🛰️  Tech Radar"));
  console.log(chalk.dim(`Repository: ${repoName}`));
  console.log(chalk.dim(`Scanned ${filesScanned} files\n`));

  console.log(
    `${getRiskEmoji(onboardingRisk.grade)} ` +
      chalk.bold(`Onboarding risk ${onboardingRisk.score}/100 (Grade: ${onboardingRisk.grade})`) +
      chalk.dim("  — lower is better")
  );
  if (onboardingRisk.factors.length > 0) {
    for (const factor of onboardingRisk.factors) {
      console.log(chalk.dim("  • ") + factor);
    }
  } else {
    console.log(chalk.dim("  • ") + chalk.green("No onboarding-risk factors detected"));
  }
  console.log();

  for (const { key, label, color } of CATEGORY_META) {
    const signals = radar[key];
    console.log(color.bold(`${label} (${signals.length})`));
    if (signals.length === 0) {
      console.log(chalk.dim("  —"));
    } else {
      for (const signal of signals) {
        console.log(`  ${color("•")} ${chalk.bold(signal.name)}${chalk.dim(` — ${signal.reason}`)}`);
      }
    }
    console.log();
  }
}

/**
 * Run the standalone `bootcamp radar` command: clone/resolve the target repo,
 * scan it once, gather the deterministic dependency and security analyses, and
 * map the tech stack onto a modern/stable/legacy/risky radar plus a 0-100
 * onboarding-risk score (lower is better). Prints a human-readable report or
 * `--json`. With `--check`, exits non-zero when the risk score exceeds
 * `--max-risk`. Reuses the same `generateTechRadar` engine that powers
 * `RADAR.md`, so it never invokes the LLM.
 */
export async function runRadarCommand(repoUrl: string, opts: RadarCommandOptions): Promise<void> {
  const maxRisk = finiteOr(opts.maxRisk, 50);

  await withResolvedRepo(repoUrl, opts, "Radar analysis failed", async (repoSource) => {
    const scan = await scanRepositoryFiles(repoSource.path, finiteOr(opts.maxFiles, 500, { min: 1 }));
    const packageJson = await readFile(join(repoSource.path, "package.json"), "utf-8")
      .then((content) => JSON.parse(content) as Record<string, unknown>)
      .catch(() => undefined);

    const deps = await extractDependencies(repoSource.path);
    const security = await analyzeSecurityPatterns(repoSource.path, scan.files, packageJson);
    const radar = generateTechRadar(
      scan.stack,
      scan.files,
      deps,
      security,
      !!scan.readme,
      !!scan.contributing
    );
    const filesScanned = scan.files.length;

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            repo: repoSource.repoInfo.fullName,
            filesScanned,
            onboardingRisk: radar.onboardingRisk,
            modern: radar.modern,
            stable: radar.stable,
            legacy: radar.legacy,
            risky: radar.risky,
          },
          null,
          2
        )
      );
    } else {
      printReport(radar, repoSource.repoInfo.fullName, filesScanned);
    }

    if (opts.check && radar.onboardingRisk.score > maxRisk) {
      if (!opts.json) {
        console.error(
          chalk.red(
            `❌ Onboarding-risk score ${radar.onboardingRisk.score}/100 exceeds the maximum of ${maxRisk}.`
          )
        );
      }
      return 1;
    }

    return 0;
  });
}
