import chalk from "chalk";

import { parseGitHubUrl } from "../ingest.js";
import { runInteractiveMode } from "../interactive.js";
import { isLocalPath, resolveRepo, type RepoSource } from "../repo-resolver.js";
import { cloneRepository, cleanupRepository, scanRepositoryFiles } from "../services/clone-service.js";
import type { RepoInfo, ScanResult } from "../types.js";

/**
 * Run ask command - standalone Q&A mode
 */
export async function runAskCommand(
  repoUrl: string,
  options: { branch?: string; verbose?: boolean; model?: string; noClone?: boolean }
): Promise<void> {
  console.log(chalk.bold.blue("\n=== Repo Bootcamp - Ask Mode ===\n"));

  let repoInfo: RepoInfo;
  let repoSource: RepoSource | null = null;
  try {
    if (options.noClone) {
      if (!isLocalPath(repoUrl)) {
        throw new Error("--no-clone requires a local directory path (for example: ./my-repo)");
      }
      repoSource = await resolveRepo(repoUrl, process.cwd(), options.branch);
      repoInfo = repoSource.repoInfo;
      console.log(chalk.gray(`Repository: ${repoSource.path}`));
    } else {
      repoInfo = parseGitHubUrl(repoUrl);
      console.log(chalk.gray(`Repository: ${repoInfo.fullName}`));
    }
  } catch (error: unknown) {
    console.error(chalk.red(`Failed to resolve repository: ${(error as Error).message}`));
    process.exit(1);
  }

  let repoPath: string;
  if (repoSource?.isLocal) {
    repoPath = repoSource.path;
    console.log(chalk.gray(`Using local repository: ${repoPath}`));
  } else {
    console.log(chalk.gray("Cloning repository..."));
    try {
      repoPath = await cloneRepository(repoInfo, options.branch, false);
    } catch (error: unknown) {
      console.error(chalk.red(`Clone failed: ${(error as Error).message}`));
      process.exit(1);
    }
  }

  console.log(chalk.gray("Scanning files..."));
  let scanResult: ScanResult;
  try {
    scanResult = await scanRepositoryFiles(repoPath, 200);
  } catch (error: unknown) {
    console.error(chalk.red(`Scan failed: ${(error as Error).message}`));
    process.exit(1);
  }

  await runInteractiveMode(
    repoPath,
    repoInfo,
    scanResult,
    process.cwd(),
    undefined,
    { verbose: options.verbose, saveTranscript: true, model: options.model }
  );

  if (!repoSource?.isLocal) {
    try {
      await cleanupRepository(repoPath);
    } catch {
      // Ignore
    }
  }
}
