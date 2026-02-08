/**
 * Docs Fixer - Auto-repair stale documentation
 *
 * Provides functions to fix common documentation issues:
 * - Update version numbers
 * - Add missing framework mentions
 * - Update CLI usage sections
 */

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type {
  DocsAnalysisResult,
  VersionMismatch,
  FrameworkIssue,
  CLIDrift,
} from "./docs-analyzer.js";
import { readFileSafe, escapeRegex, README_NAMES } from "./utils.js";

export interface FixResult {
  file: string;
  changes: string[];
  success: boolean;
}

export interface FixSummary {
  filesModified: number;
  changesApplied: number;
  results: FixResult[];
}

/**
 * Get README path
 */
async function getReadmePath(repoPath: string): Promise<string | null> {
  for (const name of README_NAMES) {
    const path = join(repoPath, name);
    const content = await readFileSafe(path);
    if (content !== null) return path;
  }
  return null;
}

/**
 * Update version numbers in documentation
 */
export async function updateVersionNumbers(
  repoPath: string,
  mismatches: VersionMismatch[]
): Promise<FixResult> {
  const result: FixResult = {
    file: "README.md",
    changes: [],
    success: false,
  };

  const readmePath = await getReadmePath(repoPath);
  if (!readmePath) return result;

  const initialContent = await readFileSafe(readmePath);
  if (!initialContent) return result;

  let content: string = initialContent;

  for (const mismatch of mismatches) {
    const patterns: RegExp[] = [];
    const replacement = mismatch.actual.replace(/[>=<^~]/g, "");

    switch (mismatch.type) {
      case "node":
        patterns.push(
          new RegExp(`(Node(?:\\.js)?\\s*(?:>=?\\s*)?)v?${escapeRegex(mismatch.documented)}`, "gi"),
          new RegExp(`(requires?\\s+Node(?:\\.js)?\\s*)v?${escapeRegex(mismatch.documented)}`, "gi")
        );
        break;
      case "python":
        patterns.push(
          new RegExp(`(Python\\s*(?:>=?\\s*)?)v?${escapeRegex(mismatch.documented)}`, "gi"),
          new RegExp(`(requires?\\s+Python\\s*)v?${escapeRegex(mismatch.documented)}`, "gi")
        );
        break;
      case "npm":
        patterns.push(
          new RegExp(`(npm\\s*(?:>=?\\s*)?)v?${escapeRegex(mismatch.documented)}`, "gi")
        );
        break;
      default:
        continue;
    }

    for (const pattern of patterns) {
      const newContent: string = content.replace(pattern, `$1${replacement}`);
      if (newContent !== content) {
        content = newContent;
        result.changes.push(`Updated ${mismatch.type} version: ${mismatch.documented} → ${replacement}`);
      }
    }
  }

  if (result.changes.length > 0) {
    await writeFile(readmePath, content, "utf-8");
    result.success = true;
  }

  return result;
}


/**
 * Add missing framework mentions to README
 */
export async function addMissingFrameworks(
  repoPath: string,
  issues: FrameworkIssue[]
): Promise<FixResult> {
  const result: FixResult = {
    file: "README.md",
    changes: [],
    success: false,
  };

  if (issues.length === 0) return result;

  const readmePath = await getReadmePath(repoPath);
  if (!readmePath) return result;

  let content = await readFileSafe(readmePath);
  if (!content) return result;

  // Find or create a "Tech Stack" or "Built With" section
  const sectionPatterns = [
    /^##\s+(Tech\s*Stack|Built\s*With|Technologies|Stack)/im,
    /^##\s+Features/im,
    /^##\s+Installation/im,
  ];

  let insertionPoint = -1;
  let insertBefore = false;

  for (const pattern of sectionPatterns) {
    const match = content.match(pattern);
    if (match && match.index !== undefined) {
      insertionPoint = match.index;
      // Insert after "Tech Stack" section header, before others
      insertBefore = !pattern.source.includes("Tech");
      break;
    }
  }

  const missingFrameworks = issues.filter((i) => i.status === "missing");
  if (missingFrameworks.length === 0) return result;

  // Format framework list
  const frameworkList = missingFrameworks
    .map((f) => `- **${capitalize(f.framework)}**${f.version ? ` (${f.version})` : ""}`)
    .join("\n");

  if (insertionPoint === -1) {
    // Add a new "Tech Stack" section before Installation or at the end
    const installMatch = content.match(/^##\s+Installation/im);
    if (installMatch && installMatch.index !== undefined) {
      const newSection = `\n## Tech Stack\n\n${frameworkList}\n\n`;
      content = content.slice(0, installMatch.index) + newSection + content.slice(installMatch.index);
      result.changes.push(`Added Tech Stack section with: ${missingFrameworks.map((f) => f.framework).join(", ")}`);
    } else {
      // Append to end
      content += `\n\n## Tech Stack\n\n${frameworkList}\n`;
      result.changes.push(`Added Tech Stack section with: ${missingFrameworks.map((f) => f.framework).join(", ")}`);
    }
  } else {
    // Find the end of the section (next ##) or end of file
    const afterInsertion = content.slice(insertionPoint);
    const nextSection = afterInsertion.match(/\n##\s+/);

    if (insertBefore) {
      // Insert new section before this one
      const newSection = `## Tech Stack\n\n${frameworkList}\n\n`;
      content = content.slice(0, insertionPoint) + newSection + content.slice(insertionPoint);
    } else {
      // Append to existing section
      if (nextSection && nextSection.index !== undefined) {
        const sectionEnd = insertionPoint + nextSection.index;
        content =
          content.slice(0, sectionEnd) +
          "\n" +
          frameworkList +
          "\n" +
          content.slice(sectionEnd);
      } else {
        content += "\n" + frameworkList + "\n";
      }
    }
    result.changes.push(`Added frameworks to docs: ${missingFrameworks.map((f) => f.framework).join(", ")}`);
  }

  if (result.changes.length > 0) {
    await writeFile(readmePath, content, "utf-8");
    result.success = true;
  }

  return result;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Update CLI usage sections in documentation
 */
export async function updateCLIUsage(
  repoPath: string,
  drift: CLIDrift[]
): Promise<FixResult> {
  const result: FixResult = {
    file: "README.md",
    changes: [],
    success: false,
  };

  if (drift.length === 0) return result;

  const readmePath = await getReadmePath(repoPath);
  if (!readmePath) return result;

  let content = await readFileSafe(readmePath);
  if (!content) return result;

  // Find Usage section
  const usageMatch = content.match(/^##\s+Usage/im);
  if (!usageMatch || usageMatch.index === undefined) {
    // No usage section to update
    return result;
  }

  // Get missing options
  const missingOpts = drift.filter((d) => d.type === "missing");
  if (missingOpts.length > 0) {
    // Find the end of the Usage section
    const afterUsage = content.slice(usageMatch.index);
    const nextSection = afterUsage.match(/\n##\s+[^#]/);
    const sectionEnd = nextSection?.index
      ? usageMatch.index + nextSection.index
      : content.length;

    // Add a note about additional options
    const optsList = missingOpts.map((o) => `\`${o.actual}\``).join(", ");
    const note = `\n\n> **Note:** Additional options available: ${optsList}. Run \`${drift[0].command} --help\` for full usage.\n`;

    // Check if note already exists
    if (!content.includes("Additional options available:")) {
      content = content.slice(0, sectionEnd) + note + content.slice(sectionEnd);
      result.changes.push(`Added note about undocumented options: ${optsList}`);
    }
  }

  // Remove extra documented options that don't exist
  const extraOpts = drift.filter((d) => d.type === "extra");
  for (const opt of extraOpts) {
    // Try to find and comment out references to non-existent options
    const optPattern = new RegExp(`\`${escapeRegex(opt.documented)}\``, "g");
    if (content.match(optPattern)) {
      result.changes.push(`Warning: ${opt.documented} is documented but doesn't exist in CLI`);
    }
  }

  if (result.changes.length > 0) {
    await writeFile(readmePath, content, "utf-8");
    result.success = true;
  }

  return result;
}

/**
 * Apply all available fixes to documentation
 */
export async function fixDocumentation(
  repoPath: string,
  analysis: DocsAnalysisResult
): Promise<FixSummary> {
  const results: FixResult[] = [];

  // Apply fixes
  const versionResult = await updateVersionNumbers(repoPath, analysis.versionMismatches);
  if (versionResult.changes.length > 0) results.push(versionResult);

  const frameworkResult = await addMissingFrameworks(repoPath, analysis.frameworkIssues);
  if (frameworkResult.changes.length > 0) results.push(frameworkResult);

  const cliResult = await updateCLIUsage(repoPath, analysis.cliDrift);
  if (cliResult.changes.length > 0) results.push(cliResult);

  const totalChanges = results.reduce((sum, r) => sum + r.changes.length, 0);

  return {
    filesModified: results.length,
    changesApplied: totalChanges,
    results,
  };
}
