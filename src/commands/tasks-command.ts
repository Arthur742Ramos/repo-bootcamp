import chalk from "chalk";

import {
  CATEGORY_ORDER,
  discoverTasks,
  suggestGettingStarted,
  type DiscoveredTask,
  type TaskCategory,
} from "../tasks.js";
import { withResolvedRepo } from "./_shared.js";
import { normalizeScanScope } from "../services/config-resolution.js";
import { resolveScanRoot } from "../services/scan-scope.js";

/** Options accepted by the `bootcamp tasks` command. */
export interface TasksCommandOptions {
  branch?: string;
  /** Discover tasks only inside this contained repository directory. */
  subdir?: string;
  /** Emit the discovered tasks as JSON for machine consumption. */
  json?: boolean;
  /** Only show tasks in this category (install, build, test, lint, dev, run, release, other). */
  category?: string;
  /** Keep the temporary clone (remote repos only). */
  keepTemp?: boolean;
  verbose?: boolean;
}

/** Human-friendly heading for each task category. */
const CATEGORY_LABELS: Record<TaskCategory, string> = {
  install: "📦 Install",
  build: "🔨 Build",
  test: "🧪 Test",
  lint: "🎨 Lint & Format",
  dev: "⚡ Develop",
  run: "▶️  Run",
  release: "🚀 Release",
  other: "📋 Other",
};

function printReport(
  repoName: string,
  tasks: DiscoveredTask[],
  category?: TaskCategory,
  subdir?: string
): void {
  console.log(chalk.bold("\n🛠️  What Can I Run?"));
  console.log(chalk.dim(`Repository: ${repoName}\n`));
  if (subdir) console.log(chalk.dim(`Run these commands from: ${subdir}\n`));

  if (tasks.length === 0) {
    if (category) {
      console.log(chalk.yellow(`No ${category} tasks found.`));
    } else {
      console.log(chalk.yellow("No runnable tasks discovered."));
      console.log(
        chalk.dim(
          "Looked for package.json scripts, Makefile, justfile, Taskfile, docker-compose, pyproject, composer.json, qualifying Cargo.toml and Go module conventions.\n"
        )
      );
    }
    return;
  }

  if (!category) {
    const gettingStarted = suggestGettingStarted(tasks);
    if (gettingStarted.length > 0) {
      console.log(chalk.bold("Getting started"));
      gettingStarted.forEach((task, i) => {
        console.log(`  ${chalk.green(`${i + 1}.`)} ${chalk.cyan(task.command)}`);
      });
      console.log();
    }
  }

  const width = Math.min(48, Math.max(...tasks.map((t) => t.command.length)));
  for (const cat of CATEGORY_ORDER) {
    if (category && cat !== category) continue;
    const group = tasks.filter((t) => t.category === cat);
    if (group.length === 0) continue;
    console.log(chalk.bold(CATEGORY_LABELS[cat]) + chalk.dim(`  (${group.length})`));
    for (const task of group) {
      const desc = task.description ? chalk.dim(`  ${task.description}`) : "";
      const origin = chalk.dim(`[${task.source}]`);
      console.log(`  ${chalk.cyan(task.command.padEnd(width))} ${origin}${desc}`);
    }
    console.log();
  }
}

/**
 * Run the standalone `bootcamp tasks` command: clone/resolve the target repo and
 * answer "how do I build / test / run this?" by parsing the task-definition files
 * it already ships (package.json scripts, Makefile, justfile, go-task Taskfile,
 * docker-compose, pyproject, composer.json) plus qualifying Cargo and selected-root Go build/test conventions. Groups the results by category,
 * suggests a first-session sequence, and supports `--category` filtering and
 * `--json`. Deterministic; never invokes the LLM.
 */
export async function runTasksCommand(repoUrl: string, opts: TasksCommandOptions): Promise<void> {
  const scope = { subdir: opts.subdir };
  try {
    normalizeScanScope(scope);
  } catch (error: unknown) {
    console.error(
      chalk.red(`Task discovery failed: ${error instanceof Error ? error.message : String(error)}`)
    );
    process.exit(1);
    return;
  }
  // Validate --category up front: it is repo-independent, so a typo should fail
  // fast instead of cloning a remote repo before we ever look at the flag.
  let category: TaskCategory | undefined;
  if (opts.category) {
    const requested = opts.category.toLowerCase();
    if (!(CATEGORY_ORDER as readonly string[]).includes(requested)) {
      console.error(
        chalk.red(
          `Unknown category "${opts.category}". Valid categories: ${CATEGORY_ORDER.join(", ")}.`
        )
      );
      process.exit(1);
    }
    category = requested as TaskCategory;
  }

  await withResolvedRepo(repoUrl, opts, "Task discovery failed", async (repoSource) => {
    const taskRoot = scope.subdir
      ? await resolveScanRoot(repoSource.path, scope.subdir)
      : repoSource.path;
    const all = await discoverTasks(taskRoot);
    const tasks = category ? all.filter((t) => t.category === category) : all;

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            repo: repoSource.repoInfo.fullName,
            category: category ?? null,
            ...(scope.subdir ? { subdir: scope.subdir } : {}),
            gettingStarted: suggestGettingStarted(all).map((t) => t.command),
            tasks,
          },
          null,
          2
        )
      );
    } else {
      printReport(repoSource.repoInfo.fullName, tasks, category, scope.subdir);
    }
    return;
  });
}
