import chalk from "chalk";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

import {
  analyzeDiff,
  fetchPullRequestRefs,
  generateDiffDocs,
  parsePullRequestTarget,
} from "../diff.js";
import { formatDocName, type OutputFormat, applyOutputFormat } from "../formatter.js";
import { parseGitHubUrl } from "../ingest.js";
import { ProgressTracker } from "../progress.js";
import { cloneRepository, cleanupRepository } from "../services/clone-service.js";
import { resolveOutputFormat } from "../services/config-resolution.js";
import type { DiffSummary, RepoInfo } from "../types.js";

export interface PullRequestDiffOptions {
  output?: string;
  format?: string;
  fullClone?: boolean;
  keepTemp?: boolean;
  verbose?: boolean;
}

export async function runPullRequestDiff(
  prTarget: string,
  options: PullRequestDiffOptions
): Promise<void> {
  console.log(chalk.bold.blue("\n=== Repo Bootcamp - PR Diff ===\n"));

  let targetInfo: { repoUrl: string; prNumber: number };
  try {
    targetInfo = parsePullRequestTarget(prTarget);
  } catch (error: unknown) {
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  let repoInfo: RepoInfo;
  try {
    repoInfo = parseGitHubUrl(targetInfo.repoUrl);
  } catch (error: unknown) {
    console.error(chalk.red(`Invalid repo: ${(error as Error).message}`));
    process.exit(1);
  }

  let outputFormat: OutputFormat;
  try {
    outputFormat = resolveOutputFormat(options.format || "markdown");
  } catch (error: unknown) {
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  const outputDir = options.output || `./bootcamp-${repoInfo.repo}-pr-${targetInfo.prNumber}`;

  console.log(chalk.dim("─".repeat(50)));
  console.log(chalk.white(`  Repository:  ${chalk.cyan(repoInfo.fullName)}`));
  console.log(chalk.white(`  Pull Request:${chalk.cyan(` #${targetInfo.prNumber}`)}`));
  console.log(chalk.white(`  Format:      ${chalk.cyan(outputFormat)}`));
  console.log(chalk.white(`  Output:      ${chalk.cyan(outputDir)}`));
  console.log(chalk.dim("─".repeat(50)));
  console.log();

  const progress = new ProgressTracker(options.verbose || false);
  let repoPath: string;

  progress.startPhase("clone", repoInfo.fullName);
  try {
    repoPath = await cloneRepository(repoInfo, undefined, options.fullClone);
    progress.succeed(`Cloned ${repoInfo.fullName}`);
  } catch (error: unknown) {
    progress.fail(`Clone failed: ${(error as Error).message}`);
    process.exit(1);
  }

  try {
    progress.startPhase("diff", `PR #${targetInfo.prNumber}`);
    let diffSummary: DiffSummary;
    try {
      const refs = await fetchPullRequestRefs(repoPath, repoInfo, targetInfo.prNumber);
      const rawDiffSummary = await analyzeDiff(repoPath, refs.baseRef, refs.headRef);
      diffSummary = {
        ...rawDiffSummary,
        baseRef: refs.baseName,
        headRef: refs.headName
          ? `PR #${targetInfo.prNumber} (${refs.headName})`
          : `PR #${targetInfo.prNumber}`,
        prNumber: targetInfo.prNumber,
        prTitle: refs.title,
        prUrl: refs.url,
      };
      progress.succeed(`Analyzed PR #${targetInfo.prNumber}`);
    } catch (error: unknown) {
      progress.fail(`Diff failed: ${(error as Error).message}`);
      process.exit(1);
    }

    try {
      await mkdir(outputDir, { recursive: true });
    } catch (error: unknown) {
      console.error(chalk.red(`Failed to create output directory: ${(error as Error).message}`));
      process.exit(1);
    }

    progress.startPhase("generate", "DIFF.md");
    try {
      const formattedDocs = applyOutputFormat(
        [{ name: "DIFF.md", content: generateDiffDocs(diffSummary, repoInfo.repo) }],
        outputFormat
      );
      for (const doc of formattedDocs) {
        await writeFile(join(outputDir, doc.name), doc.content, "utf-8");
      }
      progress.succeed(
        `Generated ${formattedDocs.length} file${formattedDocs.length === 1 ? "" : "s"}`
      );
    } catch (error: unknown) {
      progress.fail(`Write failed: ${(error as Error).message}`);
      process.exit(1);
    }
  } finally {
    if (!options.keepTemp) {
      progress.startPhase("cleanup");
      try {
        await cleanupRepository(repoPath);
        progress.succeed("Cleanup complete");
      } catch {
        progress.warn("Could not clean up temporary files");
      }
    } else {
      console.log(chalk.gray(`Temporary clone kept at: ${repoPath}`));
    }
  }

  progress.stop();

  console.log();
  console.log(chalk.green("  ╔══════════════════════════════════════════════════════╗"));
  console.log(
    chalk.green("  ║") +
      chalk.white.bold("        ✓ PR Diff Generated Successfully!           ") +
      chalk.green("║")
  );
  console.log(chalk.green("  ╚══════════════════════════════════════════════════════╝"));
  console.log();
  console.log(chalk.white(`  📁 Output: ${chalk.cyan.bold(outputDir + "/")}`));
  console.log(chalk.white(`  📄 File:   ${chalk.cyan(formatDocName("DIFF.md", outputFormat))}`));
  console.log();
}
