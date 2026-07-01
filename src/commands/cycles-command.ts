import chalk from "chalk";

import { buildImportGraph } from "../impact.js";
import { scanRepositoryFiles } from "../services/clone-service.js";
import { detectCyclesInImportGraph, type Cycle } from "../cycles.js";
import { finiteOr } from "../utils.js";
import { withResolvedRepo } from "./_shared.js";

/** Options accepted by the `bootcamp cycles` command. */
export interface CyclesCommandOptions {
  branch?: string;
  /** Emit the cycle report as JSON for machine consumption. */
  json?: boolean;
  /** Exit non-zero when the number of cycles exceeds maxCycles (CI gate). */
  check?: boolean;
  /** Threshold for --check. Defaults to 0 (fail if any cycle exists). */
  maxCycles?: number;
  /** Maximum files to scan. Defaults to 500. */
  maxFiles?: number;
  /** Keep the temporary clone (remote repos only). */
  keepTemp?: boolean;
  verbose?: boolean;
}

function printReport(repoName: string, moduleCount: number, cycles: Cycle[], rings: string[]): void {
  console.log(chalk.bold("\n🔄  Circular Dependencies"));
  console.log(chalk.dim(`Repository: ${repoName}`));

  if (cycles.length === 0) {
    console.log(
      chalk.green("✓ No circular dependencies found.") + chalk.dim(`  (${moduleCount} modules scanned)`)
    );
    console.log();
    return;
  }

  console.log(
    chalk.dim(`${moduleCount} modules · ${cycles.length} circular dependency group(s)\n`)
  );
  cycles.forEach((cycle, i) => {
    const suffix = cycle.size === 1 ? "self-import" : `${cycle.size} files`;
    console.log(`${chalk.red("⛔")} ${chalk.red(String(i + 1).padStart(2))}  ${rings[i]}  ${chalk.dim(`(${suffix})`)}`);
  });
  console.log();
  console.log(
    chalk.dim("Break a cycle by extracting the shared code into a third module, or by\ninverting one import (depend on an interface/callback instead of the concrete module).")
  );
  console.log();
}

/**
 * Run the standalone `bootcamp cycles` command: clone/resolve the target repo,
 * build the import graph, and report circular import groups. Reuses the same
 * `buildImportGraph` engine as `IMPACT.md` and `bootcamp coupling`, so it never
 * invokes the LLM.
 */
export async function runCyclesCommand(repoUrl: string, opts: CyclesCommandOptions): Promise<void> {
  const maxCycles = finiteOr(opts.maxCycles, 0, { min: 0 });

  await withResolvedRepo(repoUrl, opts, "Cycle analysis failed", async (repoSource) => {
    // Guard against a NaN/invalid --max-files (e.g. `--max-files nope`), which
    // would otherwise disable the scan cap (`files.length >= NaN` is never true).
    const maxFiles = finiteOr(opts.maxFiles, 500, { min: 1 });
    const scan = await scanRepositoryFiles(repoSource.path, maxFiles);
    const fullGraph = await buildImportGraph(repoSource.path, scan.files);
    const { moduleCount, cycles, rings } = detectCyclesInImportGraph(fullGraph);

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            repo: repoSource.repoInfo.fullName,
            moduleCount,
            cycleCount: cycles.length,
            largestCycleSize: cycles.length > 0 ? cycles[0].size : 0,
            cycles,
          },
          null,
          2
        )
      );
    } else {
      printReport(repoSource.repoInfo.fullName, moduleCount, cycles, rings);
    }

    if (opts.check && cycles.length > maxCycles) {
      if (!opts.json) {
        console.error(
          chalk.red(
            `❌ Found ${cycles.length} circular dependency group(s); maximum allowed is ${maxCycles}.`
          )
        );
      }
      return 1;
    }

    return 0;
  });
}
