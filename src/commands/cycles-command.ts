import chalk from "chalk";

import { buildImportGraph } from "../impact.js";
import { resolveRepo, type RepoSource } from "../repo-resolver.js";
import { scanRepositoryFiles } from "../services/clone-service.js";
import { findCycles, describeCycle, type Cycle } from "../cycles.js";

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

/** Source-code extensions the import graph actually parses (mirrors impact.ts/coupling). */
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/;

/**
 * Whether a path is a test file. Mirrors coupling-command.ts so the two
 * import-graph commands treat test files consistently. Circular imports among
 * test fixtures are noise (bundlers never ship them), so they are excluded
 * from cycle detection.
 */
function isTestFile(path: string): boolean {
  if (/\.(test|spec)\.[^./]+$/.test(path)) return true;
  const base = path.split("/").pop() ?? "";
  if (/_test\.[^.]+$/.test(base)) return true;
  if (/^test_.+\.py$/.test(base)) return true;
  return path
    .split("/")
    .some((s) => s === "test" || s === "tests" || s === "spec" || s === "specs" || s === "__tests__" || s === "__mocks__");
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
  const maxCycles =
    typeof opts.maxCycles === "number" && Number.isFinite(opts.maxCycles) && opts.maxCycles >= 0
      ? opts.maxCycles
      : 0;
  // Guard against a NaN/invalid --max-files (e.g. `--max-files nope`), which
  // would otherwise disable the scan cap (`files.length >= NaN` is never true).
  const maxFiles =
    typeof opts.maxFiles === "number" && Number.isFinite(opts.maxFiles) && opts.maxFiles > 0
      ? opts.maxFiles
      : 500;

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
    const scan = await scanRepositoryFiles(repoSource.path, maxFiles);
    const fullGraph = await buildImportGraph(repoSource.path, scan.files);

    // Restrict the graph to non-test source modules, then rebuild each node's
    // imports against that restricted set so test/non-source edges can't form
    // or inflate a cycle.
    const included = new Set(
      [...fullGraph.keys()].filter((file) => SOURCE_EXT.test(file) && !isTestFile(file))
    );
    const graph = new Map<string, { imports: string[] }>();
    for (const file of included) {
      const imports = (fullGraph.get(file)?.imports ?? []).filter((target) => included.has(target));
      graph.set(file, { imports });
    }

    const cycles = findCycles(graph);
    const rings = cycles.map((cycle) => describeCycle(cycle, graph));

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            repo: repoSource.repoInfo.fullName,
            moduleCount: included.size,
            cycleCount: cycles.length,
            largestCycleSize: cycles.length > 0 ? cycles[0].size : 0,
            cycles,
          },
          null,
          2
        )
      );
    } else {
      printReport(repoSource.repoInfo.fullName, included.size, cycles, rings);
    }

    if (opts.check && cycles.length > maxCycles) {
      if (!opts.json) {
        console.error(
          chalk.red(
            `❌ Found ${cycles.length} circular dependency group(s); maximum allowed is ${maxCycles}.`
          )
        );
      }
      exitCode = 1;
    }
  } catch (error: unknown) {
    console.error(
      chalk.red(`Cycle analysis failed: ${error instanceof Error ? error.message : String(error)}`)
    );
    exitCode = 1;
  } finally {
    if (opts.keepTemp && !repoSource.isLocal) {
      // Route to stderr under --json so stdout stays valid JSON for consumers.
      const note = chalk.gray(`Temporary clone kept at: ${repoSource.path}`);
      if (opts.json) {
        console.error(note);
      } else {
        console.log(note);
      }
    } else {
      await repoSource.cleanup();
    }
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
