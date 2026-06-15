import chalk from "chalk";

import {
  extractDependencies,
  generateDependencyDiagram,
  type Dependency,
  type DependencyAnalysis,
} from "../deps.js";
import { resolveRepo, type RepoSource } from "../repo-resolver.js";

/** Options accepted by the `bootcamp deps` command. */
export interface DepsCommandOptions {
  branch?: string;
  /** Emit the dependency analysis as JSON for machine consumption. */
  json?: boolean;
  /** Print the Mermaid dependency graph instead of the human-readable report. */
  diagram?: boolean;
  /** Keep the temporary clone (remote repos only). */
  keepTemp?: boolean;
  verbose?: boolean;
}

/** Human-friendly label (with source file) for each detected package manager. */
const MANAGER_LABEL: Record<string, string> = {
  npm: "npm (package.json)",
  cargo: "Cargo (Cargo.toml)",
  poetry: "Poetry (pyproject.toml)",
  pip: "pip (requirements.txt)",
  go: "Go modules (go.mod)",
};

function managerLabel(packageManager: string): string {
  return MANAGER_LABEL[packageManager] ?? packageManager;
}

function countLine(label: string, count: number, color: typeof chalk.green): string {
  return `  ${chalk.bold(label.padEnd(12))}${color(String(count).padStart(4))}`;
}

function printDepTable(title: string, list: Dependency[], cap: number): void {
  if (list.length === 0) return;
  console.log(chalk.bold(title));
  const nameWidth = Math.min(40, Math.max(10, ...list.slice(0, cap).map((dep) => dep.name.length)));
  for (const dep of list.slice(0, cap)) {
    console.log(`  ${dep.name.padEnd(nameWidth)} ${chalk.dim(dep.version)}`);
  }
  if (list.length > cap) {
    console.log(chalk.dim(`  … +${list.length - cap} more`));
  }
  console.log();
}

function printReport(deps: DependencyAnalysis, repoName: string): void {
  console.log(chalk.bold("\n📦 Dependencies"));
  console.log(chalk.dim(`Repository: ${repoName}`));
  console.log(chalk.dim(`Package manager: ${managerLabel(deps.packageManager)}\n`));

  console.log(countLine("Runtime", deps.runtime.length, chalk.green));
  console.log(countLine("Development", deps.dev.length, chalk.cyan));
  if (deps.peer.length > 0) {
    console.log(countLine("Peer", deps.peer.length, chalk.magenta));
  }
  console.log(countLine("Total", deps.totalCount, chalk.bold));
  console.log();

  if (deps.categories.length > 0) {
    console.log(chalk.bold("By category"));
    for (const category of deps.categories.slice(0, 10)) {
      const shown = category.deps.slice(0, 8).join(", ");
      const extra =
        category.deps.length > 8 ? chalk.dim(` +${category.deps.length - 8} more`) : "";
      console.log(`  ${chalk.cyan(category.name)}${chalk.dim(": ")}${shown}${extra}`);
    }
    console.log();
  }

  printDepTable("Runtime dependencies", deps.runtime, 40);
  printDepTable("Development dependencies", deps.dev, 20);
}

/**
 * Run the standalone `bootcamp deps` command: clone/resolve the target repo,
 * detect its package manager (npm, Cargo, pip/Poetry, or Go), and report the
 * dependency breakdown — grouped by smart categories — as a human-readable
 * table, machine-readable `--json`, or a Mermaid `--diagram`. Reuses the same
 * deterministic `extractDependencies` engine that powers `DEPENDENCIES.md`,
 * so it never invokes the LLM.
 */
export async function runDepsCommand(repoUrl: string, opts: DepsCommandOptions): Promise<void> {
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
    const deps = await extractDependencies(repoSource.path);

    if (!deps) {
      if (opts.json) {
        console.log(
          JSON.stringify({ repo: repoSource.repoInfo.fullName, dependencies: null }, null, 2)
        );
      } else {
        console.log(chalk.yellow("\n📦 No recognized dependency manifest found."));
        console.log(
          chalk.dim(
            "Looked for package.json, Cargo.toml, pyproject.toml, requirements.txt, and go.mod.\n"
          )
        );
      }
      return;
    }

    if (opts.diagram) {
      // Raw Mermaid graph, ready to pipe into a renderer or a Markdown fence.
      console.log(generateDependencyDiagram(deps, repoSource.repoInfo.repo));
    } else if (opts.json) {
      console.log(
        JSON.stringify(
          {
            repo: repoSource.repoInfo.fullName,
            packageManager: deps.packageManager,
            totalCount: deps.totalCount,
            counts: {
              runtime: deps.runtime.length,
              dev: deps.dev.length,
              peer: deps.peer.length,
            },
            runtime: deps.runtime,
            dev: deps.dev,
            peer: deps.peer,
            categories: deps.categories,
          },
          null,
          2
        )
      );
    } else {
      printReport(deps, repoSource.repoInfo.fullName);
    }
  } catch (error: unknown) {
    console.error(
      chalk.red(`Dependency analysis failed: ${error instanceof Error ? error.message : String(error)}`)
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
