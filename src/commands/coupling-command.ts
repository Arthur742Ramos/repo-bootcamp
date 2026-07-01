import chalk from "chalk";

import { buildImportGraph } from "../impact.js";
import { scanRepositoryFiles } from "../services/clone-service.js";
import { SOURCE_EXT, isTestFile } from "../cycles.js";
import { finiteOr } from "../utils.js";
import { withResolvedRepo } from "./_shared.js";

/** Options accepted by the `bootcamp coupling` command. */
export interface CouplingCommandOptions {
  branch?: string;
  /** Emit the coupling map as JSON for machine consumption. */
  json?: boolean;
  /** How many entries to show per section. Defaults to 12. */
  top?: number;
  /** Maximum files to scan. Defaults to 500. */
  maxFiles?: number;
  /** Keep the temporary clone (remote repos only). */
  keepTemp?: boolean;
  verbose?: boolean;
}

/** Coupling metrics for a single module. */
interface ModuleCoupling {
  file: string;
  /** How many modules import this one (depended-upon — high = load-bearing). */
  fanIn: number;
  /** How many internal modules this one imports (dependencies — high = hub). */
  fanOut: number;
}

/** Tooling entry points (loaded by tools, not imported) — not dead code. */
function isConfigOrScript(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  if (/\.config\.[cm]?[jt]sx?$/.test(base)) return true; // vitest.config.ts, eslint.config.js
  if (/^(conftest|setup|manage|wsgi|asgi)\.(py|ts|js)$/.test(base)) return true;
  const top = path.split("/")[0];
  return top === "scripts" || top === "script";
}

function printList(
  label: string,
  detail: string,
  rows: Array<{ value: number; file: string }>,
  color: typeof chalk.green,
  glyph: string
): void {
  console.log(chalk.bold(label) + chalk.dim(`  ${detail}`));
  if (rows.length === 0) {
    console.log(chalk.dim("  —"));
  } else {
    for (const row of rows) {
      console.log(`  ${color(glyph)} ${color(String(row.value).padStart(3))}  ${row.file}`);
    }
  }
  console.log();
}

function printReport(
  modules: ModuleCoupling[],
  orphans: string[],
  repoName: string,
  edgeCount: number,
  top: number
): void {
  console.log(chalk.bold("\n🕸️  Module Coupling"));
  console.log(chalk.dim(`Repository: ${repoName}`));
  console.log(chalk.dim(`${modules.length} modules · ${edgeCount} import edges\n`));

  const core = [...modules]
    .filter((m) => m.fanIn > 0)
    .sort((a, b) => b.fanIn - a.fanIn || a.file.localeCompare(b.file))
    .slice(0, top)
    .map((m) => ({ value: m.fanIn, file: m.file }));
  printList("Load-bearing core", "(most depended-upon — start reading here)", core, chalk.green, "⬆");

  const hubs = [...modules]
    .filter((m) => m.fanOut > 0)
    .sort((a, b) => b.fanOut - a.fanOut || a.file.localeCompare(b.file))
    .slice(0, top)
    .map((m) => ({ value: m.fanOut, file: m.file }));
  printList("Orchestrators", "(import the most internal modules)", hubs, chalk.cyan, "⬇");

  console.log(
    chalk.bold("Possibly orphaned") +
      chalk.dim("  (isolated in the import graph — candidate dead code)")
  );
  if (orphans.length === 0) {
    console.log(chalk.dim("  —"));
  } else {
    for (const file of orphans.slice(0, top)) {
      console.log(`  ${chalk.yellow("•")} ${file}`);
    }
    if (orphans.length > top) {
      console.log(chalk.dim(`  … +${orphans.length - top} more`));
    }
  }
  console.log();
}

/**
 * Run the standalone `bootcamp coupling` command: clone/resolve the target repo,
 * build its internal import graph, and rank modules by coupling — fan-in (how
 * many modules depend on each) and fan-out (how many it depends on). Surfaces
 * the load-bearing core (where to start reading), the orchestrator hubs, and
 * possibly-orphaned modules (candidate dead code). Reuses the same
 * `buildImportGraph` engine as `IMPACT.md`, so it never invokes the LLM.
 */
export async function runCouplingCommand(
  repoUrl: string,
  opts: CouplingCommandOptions
): Promise<void> {
  const top = finiteOr(opts.top, 12, { min: 1 });

  await withResolvedRepo(repoUrl, opts, "Coupling analysis failed", async (repoSource) => {
    const scan = await scanRepositoryFiles(repoSource.path, finiteOr(opts.maxFiles, 500, { min: 1 }));
    const graph = await buildImportGraph(repoSource.path, scan.files);

    const modules: ModuleCoupling[] = [...graph.entries()]
      .filter(([file]) => SOURCE_EXT.test(file))
      .map(([file, node]) => ({
        file,
        fanIn: node.importedBy.length,
        fanOut: node.imports.length,
      }));
    const edgeCount = modules.reduce((sum, m) => sum + m.fanOut, 0);

    // Orphans: fully isolated modules — they import nothing internal AND are
    // imported by nothing (a strong, low-false-positive dead-code signal),
    // excluding tests and tooling entry points loaded externally.
    const orphans = modules
      .filter((m) => m.fanIn === 0 && m.fanOut === 0 && !isTestFile(m.file) && !isConfigOrScript(m.file))
      .map((m) => m.file)
      .sort((a, b) => a.localeCompare(b));

    if (opts.json) {
      const byFanIn = (a: ModuleCoupling, b: ModuleCoupling): number =>
        b.fanIn - a.fanIn || a.file.localeCompare(b.file);
      const byFanOut = (a: ModuleCoupling, b: ModuleCoupling): number =>
        b.fanOut - a.fanOut || a.file.localeCompare(b.file);
      console.log(
        JSON.stringify(
          {
            repo: repoSource.repoInfo.fullName,
            moduleCount: modules.length,
            edgeCount,
            core: [...modules].filter((m) => m.fanIn > 0).sort(byFanIn).slice(0, top),
            hubs: [...modules].filter((m) => m.fanOut > 0).sort(byFanOut).slice(0, top),
            orphans,
          },
          null,
          2
        )
      );
    } else {
      printReport(modules, orphans, repoSource.repoInfo.fullName, edgeCount, top);
    }
  });
}
