import chalk from "chalk";

import { parseGitHubUrl } from "../ingest.js";
import { quickAsk, runInteractiveMode } from "../interactive.js";
import { isLocalPath, resolveRepo, type RepoSource } from "../repo-resolver.js";
import { cloneRepository, cleanupRepository, scanRepositoryFiles } from "../services/clone-service.js";
import type { RepoInfo, ScanResult } from "../types.js";

/**
 * Run ask command - standalone Q&A mode.
 *
 * When a `question` is supplied the command runs non-interactively: the answer
 * streams to stdout via {@link quickAsk} while every banner/status line is routed
 * to stderr, so `bootcamp ask <repo> "..."` pipes cleanly and no TRANSCRIPT.md is
 * written. Without a question it drops into the interactive REPL as before.
 */
export async function runAskCommand(
  repoUrl: string,
  options: { branch?: string; verbose?: boolean; model?: string; noClone?: boolean; question?: string }
): Promise<void> {
  const question = options.question?.trim();
  const oneShot = Boolean(question);
  // Keep stdout answer-only in one-shot mode by sending status output to stderr.
  const status = (message: string): void => {
    if (oneShot) {
      console.error(message);
    } else {
      console.log(message);
    }
  };

  if (!oneShot) {
    console.log(chalk.bold.blue("\n=== Repo Bootcamp - Ask Mode ===\n"));
  }

  let repoInfo: RepoInfo;
  let repoSource: RepoSource | null = null;
  const useLocalRepo = Boolean(options.noClone || isLocalPath(repoUrl));
  try {
    if (useLocalRepo) {
      if (!isLocalPath(repoUrl)) {
        throw new Error("--no-clone requires a local directory path (for example: ./my-repo)");
      }
      repoSource = await resolveRepo(repoUrl, process.cwd(), options.branch);
      repoInfo = repoSource.repoInfo;
      status(chalk.gray(`Repository: ${repoSource.path}`));
    } else {
      repoInfo = parseGitHubUrl(repoUrl);
      status(chalk.gray(`Repository: ${repoInfo.fullName}`));
    }
  } catch (error: unknown) {
    console.error(chalk.red(`Failed to resolve repository: ${(error as Error).message}`));
    process.exit(1);
  }

  let repoPath: string;
  if (repoSource?.isLocal) {
    repoPath = repoSource.path;
    status(chalk.gray(`Using local repository: ${repoPath}`));
  } else {
    status(chalk.gray("Cloning repository..."));
    try {
      repoPath = await cloneRepository(repoInfo, options.branch, false);
    } catch (error: unknown) {
      console.error(chalk.red(`Clone failed: ${(error as Error).message}`));
      process.exit(1);
    }
  }

  status(chalk.gray("Scanning files..."));
  let scanResult: ScanResult;
  try {
    scanResult = await scanRepositoryFiles(repoPath, 200);
  } catch (error: unknown) {
    console.error(chalk.red(`Scan failed: ${(error as Error).message}`));
    process.exit(1);
  }

  const cleanupIfCloned = async (): Promise<void> => {
    if (!repoSource?.isLocal) {
      try {
        await cleanupRepository(repoPath);
      } catch {
        // Best-effort temp cleanup; ignore failures.
      }
    }
  };

  if (oneShot) {
    try {
      // quickAsk streams the answer to stdout and returns it — no REPL, no transcript.
      await quickAsk(repoPath, repoInfo, scanResult, question!, options.verbose, options.model);
    } catch (error: unknown) {
      console.error(chalk.red(`Ask failed: ${(error as Error).message}`));
      await cleanupIfCloned();
      process.exit(1);
    }
  } else {
    await runInteractiveMode(
      repoPath,
      repoInfo,
      scanResult,
      process.cwd(),
      undefined,
      { verbose: options.verbose, saveTranscript: true, model: options.model }
    );
  }

  await cleanupIfCloned();
}
