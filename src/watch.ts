/**
 * Watch Mode Module
 *
 * Polls a cloned repository's remote for new commits and
 * re-triggers analysis when changes are detected.
 * Also watches local .git/refs via fs.watch as a supplementary trigger.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { watch as fsWatch, type FSWatcher } from "fs";
import { join } from "path";
import chalk from "chalk";

const execAsync = promisify(exec);

export interface WatchOptions {
  /** Polling interval in seconds (default: 30) */
  intervalSeconds: number;
  /** Called when new commits are detected; resolves when re-analysis is done */
  onChangeDetected: () => Promise<void>;
  /** Optional verbose logging */
  verbose?: boolean;
}

export interface WatchHandle {
  /** Stop watching */
  stop: () => void;
}

/**
 * Get the current HEAD commit SHA of the cloned repo.
 */
export async function getHeadCommit(repoPath: string): Promise<string> {
  const { stdout } = await execAsync("git rev-parse HEAD", { cwd: repoPath });
  return stdout.trim();
}

/**
 * Fetch the latest changes from the remote and check for updates.
 * Returns whether new commits were found and the new SHA.
 */
export async function fetchAndCheckUpdates(repoPath: string, lastSha: string): Promise<{ updated: boolean; newSha: string }> {
  await execAsync("git fetch origin", { cwd: repoPath });

  let remoteSha: string;
  try {
    const { stdout } = await execAsync("git rev-parse @{u}", { cwd: repoPath });
    remoteSha = stdout.trim();
  } catch {
    const { stdout } = await execAsync("git rev-parse FETCH_HEAD", { cwd: repoPath });
    remoteSha = stdout.trim();
  }

  if (remoteSha !== lastSha) {
    // Fast-forward to get the new commits locally
    await execAsync("git merge --ff-only FETCH_HEAD", { cwd: repoPath }).catch(
      () => execAsync(`git reset --hard ${remoteSha}`, { cwd: repoPath })
    );
    return { updated: true, newSha: remoteSha };
  }

  return { updated: false, newSha: lastSha };
}

/**
 * Start watching a cloned repo for new remote commits.
 *
 * Uses two strategies:
 * 1. Periodic polling via `git fetch` (primary)
 * 2. `fs.watch` on `.git/refs` for local ref changes (supplementary)
 */
export function startWatch(
  repoPath: string,
  opts: WatchOptions
): WatchHandle {
  let lastSha = "";
  let running = false;
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let fsWatcher: FSWatcher | null = null;

  const log = (msg: string) => {
    if (opts.verbose) {
      console.log(chalk.dim(`  [watch] ${msg}`));
    }
  };

  const check = async () => {
    if (running || stopped) return;
    running = true;

    try {
      if (!lastSha) {
        lastSha = await getHeadCommit(repoPath);
        log(`Initial commit: ${lastSha.slice(0, 8)}`);
      }

      log("Checking for new commits...");
      const result = await fetchAndCheckUpdates(repoPath, lastSha);

      if (result.updated) {
        console.log(
          chalk.cyan("\n  🔄 New commits detected ") +
            chalk.dim(`(${lastSha.slice(0, 8)} → ${result.newSha.slice(0, 8)})`)
        );
        lastSha = result.newSha;

        console.log(chalk.cyan("  Re-running analysis...\n"));
        await opts.onChangeDetected();
        console.log(
          chalk.green("\n  ✓ Watch: analysis updated. Waiting for next change...\n")
        );
      } else {
        log("No new commits.");
      }
    } catch (err: unknown) {
      console.log(
        chalk.yellow(`  ⚠ Watch poll error: ${(err as Error).message}`)
      );
    } finally {
      running = false;
    }
  };

  // Schedule periodic polling
  const schedulePoll = () => {
    if (stopped) return;
    pollTimer = setTimeout(async () => {
      await check();
      schedulePoll();
    }, opts.intervalSeconds * 1000);
  };

  // Start fs.watch on .git/refs as supplementary trigger
  try {
    const refsPath = join(repoPath, ".git", "refs");
    fsWatcher = fsWatch(refsPath, { recursive: true }, () => {
      if (!running && !stopped) {
        log("Local ref change detected, checking...");
        check();
      }
    });
    fsWatcher.on("error", () => {
      // Ignore fs.watch errors (not critical)
    });
  } catch {
    // fs.watch not available or path doesn't exist
  }

  // Print initial watch message
  console.log(
    chalk.cyan(`\n  👀 Watch mode active `) +
      chalk.dim(`(polling every ${opts.intervalSeconds}s)`)
  );
  console.log(chalk.dim("  Press Ctrl+C to stop.\n"));

  // Kick off first poll
  schedulePoll();

  return {
    stop: () => {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (fsWatcher) {
        fsWatcher.close();
        fsWatcher = null;
      }
    },
  };
}
