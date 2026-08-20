import chalk from "chalk";

import { analyzeChangeImpact, buildImportGraph, getKeyFilesForImpact } from "../impact.js";
import { scanRepositoryFiles } from "../services/clone-service.js";
import type { ChangeImpact } from "../types.js";
import { finiteOr } from "../utils.js";
import { withResolvedRepo } from "./_shared.js";

/** Options accepted by the `bootcamp impact` command. */
export interface ImpactCommandOptions {
  branch?: string;
  /** Emit the impact analysis as JSON for machine consumption. */
  json?: boolean;
  /** When no file is given, how many key files to analyze. Defaults to 10. */
  top?: number;
  /** Maximum files to scan. Defaults to 500. */
  maxFiles?: number;
  /** Keep the temporary clone (remote repos only). */
  keepTemp?: boolean;
  verbose?: boolean;
}

/** Normalize a user-supplied path to match the forward-slash scan keys. */
function normalizePath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function impactCounts(impact: ChangeImpact): string {
  return (
    `imported by ${impact.importedBy.length}` +
    ` · affects ${plural(impact.affectedFiles.length, "file")}` +
    ` · ${plural(impact.affectedTests.length, "test")}` +
    ` · ${plural(impact.affectedDocs.length, "doc")}`
  );
}

function printList(label: string, items: string[], color: typeof chalk.green, cap = 25): void {
  console.log(color.bold(`${label} (${items.length})`));
  if (items.length === 0) {
    console.log(chalk.dim("  —"));
  } else {
    for (const item of items.slice(0, cap)) {
      console.log(`  ${color("•")} ${item}`);
    }
    if (items.length > cap) {
      console.log(chalk.dim(`  … +${items.length - cap} more`));
    }
  }
}

function printDetail(impact: ChangeImpact): void {
  console.log(chalk.bold(`\n🎯 ${impact.file}`));
  console.log(chalk.dim(`  ${impactCounts(impact)}\n`));
  printList("Imports", impact.imports, chalk.cyan);
  printList("Imported by", impact.importedBy, chalk.blue);
  printList("Affected files", impact.affectedFiles, chalk.yellow);
  printList("Affected tests", impact.affectedTests, chalk.green);
  printList("Affected docs", impact.affectedDocs, chalk.magenta);
}

function printSummary(impacts: ChangeImpact[]): void {
  for (const impact of impacts) {
    console.log(chalk.bold(impact.file));
    console.log(chalk.dim(`  ${impactCounts(impact)}`));
  }
}

/**
 * Run the standalone `bootcamp impact` command: clone/resolve the target repo,
 * scan it, and build an import graph to compute change-impact ("blast radius").
 * With a `<file>` argument, prints the files, tests, and docs that a change to
 * that file would affect; without one, summarizes the repo's key entry-point
 * files. Reuses the same `buildImportGraph`/`analyzeChangeImpact` engine that
 * powers `IMPACT.md`, so it never invokes the LLM.
 */
export async function runImpactCommand(
  repoUrl: string,
  file: string | undefined,
  opts: ImpactCommandOptions
): Promise<void> {
  const top = finiteOr(opts.top, 10, { min: 1 });

  await withResolvedRepo(repoUrl, opts, "Impact analysis failed", async (repoSource) => {
    const scan = await scanRepositoryFiles(
      repoSource.path,
      finiteOr(opts.maxFiles, 500, { min: 1 })
    );
    const graph = await buildImportGraph(repoSource.path, scan.files);

    const normalized = file ? normalizePath(file) : undefined;
    if (normalized && !graph.has(normalized)) {
      console.error(chalk.red(`File not found in scanned sources: ${normalized}`));
      console.error(
        chalk.dim("Pass a repository-relative path to a scanned source file (e.g. src/index.ts).")
      );
      return 1;
    }

    const targets = normalized ? [normalized] : getKeyFilesForImpact(scan.files).slice(0, top);

    const impacts: ChangeImpact[] = [];
    for (const target of targets) {
      impacts.push(await analyzeChangeImpact(repoSource.path, scan.files, target, graph));
    }

    if (opts.json) {
      console.log(JSON.stringify({ repo: repoSource.repoInfo.fullName, impacts }, null, 2));
    } else if (impacts.length === 0) {
      console.log(chalk.yellow("\n🎯 No key source files detected to analyze."));
      console.log(chalk.dim("Pass a specific file: bootcamp impact <repo> <path>\n"));
    } else {
      console.log(chalk.bold("\n🎯 Change Impact"));
      console.log(chalk.dim(`Repository: ${repoSource.repoInfo.fullName}`));
      if (normalized) {
        printDetail(impacts[0]);
        console.log();
      } else {
        console.log(
          chalk.dim(`Top ${impacts.length} key files — run with a file path for full detail\n`)
        );
        printSummary(impacts);
        console.log();
      }
    }

    return 0;
  });
}
