import chalk from "chalk";
import { writeFile } from "fs/promises";
import { basename, join } from "path";

import { renderOutputDiagrams } from "../diagrams.js";
import { applyOutputFormat, type OutputFormat } from "../formatter.js";
import { createIssuesFromTasks, generateIssuePreview } from "../issues.js";
import { ProgressTracker } from "../progress.js";
import type { BootcampOptions, RepoFacts, RepoInfo } from "../types.js";
import type { GeneratedDoc } from "./analysis-orchestration.js";

interface WriteGeneratedOutputsParams {
  documents: GeneratedDoc[];
  repoInfo: RepoInfo;
  facts: RepoFacts;
  options: BootcampOptions;
  outputDir: string;
  outputFormat: OutputFormat;
  progress: ProgressTracker;
  allowIssueCreation?: boolean;
}

export interface WriteGeneratedOutputsResult {
  documentCount: number;
}

export async function writeGeneratedOutputs({
  documents,
  repoInfo,
  facts,
  options,
  outputDir,
  outputFormat,
  progress,
  allowIssueCreation = true,
}: WriteGeneratedOutputsParams): Promise<WriteGeneratedOutputsResult> {
  const formattedDocuments = applyOutputFormat(documents, outputFormat);

  if (!options.jsonOnly) {
    for (const doc of formattedDocuments) {
      progress.update(doc.name);
      await writeFile(join(outputDir, doc.name), doc.content, "utf-8");
    }
  } else {
    await writeFile(join(outputDir, "repo_facts.json"), JSON.stringify(facts, null, 2), "utf-8");
  }

  if (allowIssueCreation && options.createIssues && facts.firstTasks.length > 0) {
    console.log();
    if (options.dryRun) {
      const preview = generateIssuePreview(facts.firstTasks, repoInfo);
      const [previewDoc] = applyOutputFormat(
        [{ name: "ISSUES_PREVIEW.md", content: preview }],
        outputFormat
      );
      await writeFile(join(outputDir, previewDoc.name), previewDoc.content, "utf-8");
      console.log(chalk.yellow(`Issue preview saved to ${previewDoc.name}`));
    }
    await createIssuesFromTasks(facts.firstTasks, repoInfo, {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });
  }

  if (options.renderDiagrams && !options.jsonOnly) {
    progress.update("Rendering diagrams...");
    const format = options.diagramFormat || "svg";
    const renderResult = await renderOutputDiagrams(outputDir, format);
    if (renderResult.rendered) {
      console.log(chalk.cyan("\nDiagrams rendered: ") + chalk.white(renderResult.files.map((f) => basename(f)).join(", ")));
    } else if (renderResult.error) {
      console.log(chalk.yellow(`\nDiagram rendering skipped: ${renderResult.error}`));
    }
  }

  return {
    documentCount: options.jsonOnly ? 1 : formattedDocuments.length,
  };
}
