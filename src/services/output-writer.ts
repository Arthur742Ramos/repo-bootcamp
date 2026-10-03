import chalk from "chalk";
import { writeFile } from "fs/promises";
import { basename, join, relative, sep } from "path";

import { renderOutputDiagrams } from "../diagrams.js";
import { applyOutputFormat, type OutputFormat } from "../formatter.js";
import { createIssuesFromTasks, generateIssuePreview } from "../issues.js";
import type { OutputTargetPlugin } from "../plugin-api.js";
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
  outputTargets?: OutputTargetPlugin[];
}

export interface WriteGeneratedOutputsResult {
  documentCount: number;
  /** Local files successfully written by this run, excluding arbitrary output-target destinations. */
  emittedFiles: string[];
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
  outputTargets = [],
}: WriteGeneratedOutputsParams): Promise<WriteGeneratedOutputsResult> {
  const factsDoc = documents.find((doc) => doc.name === "repo_facts.json");
  const formattedDocuments = applyOutputFormat(documents, outputFormat);
  const emittedFiles = new Set<string>();
  const recordWrittenFile = (destination: string) =>
    emittedFiles.add(relative(outputDir, destination).split(sep).join("/"));

  if (!options.jsonOnly) {
    for (const doc of formattedDocuments) {
      progress.update(doc.name);
      await writeFile(join(outputDir, doc.name), doc.content, "utf-8");
      recordWrittenFile(join(outputDir, doc.name));
    }
  } else {
    await writeFile(
      join(outputDir, "repo_facts.json"),
      factsDoc?.content || JSON.stringify(facts, null, 2),
      "utf-8"
    );
    recordWrittenFile(join(outputDir, "repo_facts.json"));
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
      recordWrittenFile(join(outputDir, previewDoc.name));
      console.log(chalk.yellow(`Issue preview saved to ${previewDoc.name}`));
    }
    const results = await createIssuesFromTasks(facts.firstTasks, repoInfo, {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });
    const failed = results.filter((result) => !result.success).length;
    if (failed > 0) {
      throw new Error(
        `${failed} starter issue${failed === 1 ? "" : "s"} could not be created. Generated documents have been preserved.`
      );
    }
  }

  if (options.renderDiagrams && !options.jsonOnly) {
    progress.update("Rendering diagrams...");
    const format = options.diagramFormat || "svg";
    const renderResult = await renderOutputDiagrams(outputDir, format);
    for (const file of renderResult.files) recordWrittenFile(file);
    if (renderResult.rendered) {
      if (!options.quiet) {
        console.log(
          chalk.cyan("\nDiagrams rendered: ") +
            chalk.white(renderResult.files.map((f) => basename(f)).join(", "))
        );
      }
    } else if (renderResult.error) {
      if (!options.quiet) {
        console.log(chalk.yellow(`\nDiagram rendering skipped: ${renderResult.error}`));
      }
    }
  }

  if (outputTargets.length > 0) {
    const targetDocuments = options.jsonOnly
      ? [{ name: "repo_facts.json", content: factsDoc?.content || JSON.stringify(facts, null, 2) }]
      : formattedDocuments;
    for (const outputTarget of outputTargets) {
      try {
        await outputTarget.writeOutput({
          documents: targetDocuments,
          outputDir,
          repoInfo,
          facts,
          options,
        });
      } catch (error: unknown) {
        console.warn(`Output target ${outputTarget.name} failed: ${(error as Error).message}`);
      }
    }
  }

  return {
    documentCount: options.jsonOnly ? 1 : formattedDocuments.length,
    emittedFiles: [...emittedFiles],
  };
}
