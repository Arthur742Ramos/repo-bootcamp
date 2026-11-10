import chalk from "chalk";

import {
  CATEGORY_ORDER,
  discoverTasks,
  suggestGettingStarted,
  type DiscoverTasksOptions,
  type DiscoveredTask,
  type TaskCategory,
} from "../tasks.js";
import {
  fingerprintFirstSession,
  fingerprintTaskSource,
  updateFirstSession,
} from "../first-session.js";
import { withResolvedRepo } from "./_shared.js";
import { normalizeScanScope } from "../services/config-resolution.js";
import { resolveScopedPackageManager } from "../scoped-package-manager.js";
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
  /** Save and resume an explicitly opted-in first-session sequence. */
  session?: boolean;
  /** Mark a numbered first-session step as completed. */
  done?: string;
  /** Replace the saved sequence and its progress. */
  restartSession?: boolean;
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
  if (!opts.session && (opts.done !== undefined || opts.restartSession)) {
    console.error(chalk.red("--done and --restart-session require --session."));
    process.exit(1);
    return;
  }
  if ((opts.session && opts.category) || (opts.restartSession && opts.done !== undefined)) {
    console.error(
      chalk.red(
        "--session cannot be filtered by --category, and --done cannot be combined with --restart-session."
      )
    );
    process.exit(1);
    return;
  }
  if (
    opts.done !== undefined &&
    (!/^[1-9]\d*$/.test(opts.done) || !Number.isSafeInteger(Number(opts.done)))
  ) {
    console.error(chalk.red("--done must be a positive step number."));
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
    const manager = scope.subdir
      ? await resolveScopedPackageManager({
          repositoryRoot: repoSource.path,
          selectedRoot: taskRoot,
        })
      : undefined;
    const sourceEvidence = new Map<string, string>();
    const record = (kind: string) => (path: string, content: string) =>
      sourceEvidence.set(`${kind}:${path}`, fingerprintTaskSource(content));
    const discoverOptions: DiscoverTasksOptions = {
      ...(manager ? { packageManager: manager.packageManager } : {}),
      ...(opts.session
        ? {
            onTaskSourceRead: record("source"),
            onTaskfileRead: record("taskfile"),
            onCargoRead: record("cargo"),
            onCargoWorkspaceEvidence: record("workspace"),
            onGoModRead: record("go-mod"),
            onGoPackageEvidence: record("go-source"),
          }
        : {}),
    };
    const all = await discoverTasks(taskRoot, discoverOptions);
    const tasks = category ? all.filter((t) => t.category === category) : all;

    if (opts.session) {
      const steps = suggestGettingStarted(all);
      const done = opts.done === undefined ? undefined : Number(opts.done);
      if (done !== undefined && done > steps.length) {
        throw new Error(`Step ${done} does not exist; this session has ${steps.length} steps.`);
      }
      const state = await updateFirstSession({
        repo: repoSource,
        input: repoUrl,
        selectedRoot: taskRoot,
        subdir: scope.subdir,
        fingerprint: fingerprintFirstSession(all, sourceEvidence),
        stepCount: steps.length,
        done,
        restart: opts.restartSession,
      });
      const sessionSteps = steps.map((task, index) => ({
        number: index + 1,
        command: task.command,
        source: task.source,
        completed: state.completed.includes(index + 1),
      }));
      const next = sessionSteps.find((step) => !step.completed)?.number ?? null;
      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              repo: repoSource.repoInfo.fullName,
              ...(scope.subdir ? { subdir: scope.subdir } : {}),
              session: { steps: sessionSteps, next },
            },
            null,
            2
          )
        );
      } else {
        console.log(chalk.bold("\nFirst session"));
        console.log(
          chalk.dim(
            `Repository: ${repoSource.repoInfo.fullName}${scope.subdir ? ` · ${scope.subdir}` : ""}`
          )
        );
        if (sessionSteps.length === 0) console.log("No getting-started commands were discovered.");
        for (const step of sessionSteps) {
          console.log(
            `  ${step.completed ? "[x]" : "[ ]"} ${step.number}. ${step.command} ${chalk.dim(`[${step.source}]`)}`
          );
        }
        if (next !== null) {
          console.log(
            `\nRun the next command in your checkout, then mark it done with --session --done ${next}.`
          );
        } else if (sessionSteps.length > 0) {
          console.log("\nAll steps marked complete.");
        }
        console.log(chalk.dim("Commands are suggestions and are never run automatically."));
      }
      return;
    }

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
