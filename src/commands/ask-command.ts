import chalk from "chalk";

import { parseGitHubUrl } from "../ingest.js";
import { runInteractiveMode } from "../interactive.js";
import { cloneRepository, cleanupRepository, scanRepositoryFiles } from "../services/clone-service.js";
import type { RepoInfo, ScanResult } from "../types.js";

/**
 * Run ask command - standalone Q&A mode
 */
export async function runAskCommand(
  repoUrl: string,
  options: { branch?: string; verbose?: boolean; model?: string }
): Promise<void> {
  console.log(chalk.bold.blue("\n=== Repo Bootcamp - Ask Mode ===\n"));

  let repoInfo: RepoInfo;
  try {
    repoInfo = parseGitHubUrl(repoUrl);
    console.log(chalk.gray(`Repository: ${repoInfo.fullName}`));
  } catch (error: unknown) {
    console.error(chalk.red(`Invalid URL: ${(error as Error).message}`));
    process.exit(1);
  }

  console.log(chalk.gray("Cloning repository..."));
  let repoPath: string;
  try {
    repoPath = await cloneRepository(repoInfo, options.branch, false);
  } catch (error: unknown) {
    console.error(chalk.red(`Clone failed: ${(error as Error).message}`));
    process.exit(1);
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

  try {
    await cleanupRepository(repoPath);
  } catch {
    // Ignore
  }
}
