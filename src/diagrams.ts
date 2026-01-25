/**
 * Diagram Rendering Module
 *
 * Renders Mermaid diagrams to SVG/PNG using mermaid-cli (mmdc).
 * This is an optional feature that requires @mermaid-js/mermaid-cli to be installed.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, unlink, access } from "fs/promises";
import { join, dirname, basename } from "path";

const execFileAsync = promisify(execFile);

export type DiagramFormat = "svg" | "png" | "pdf";

export interface RenderResult {
  inputFile: string;
  outputFiles: string[];
  success: boolean;
  error?: string;
}

/**
 * Check if mermaid-cli (mmdc) is available
 */
export async function isMermaidCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync("npx", ["--no-install", "mmdc", "--version"]);
    return true;
  } catch {
    // Try global mmdc
    try {
      await execFileAsync("mmdc", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get the mmdc command (npx or global)
 */
async function getMmdcCommand(): Promise<{ cmd: string; args: string[] }> {
  try {
    await execFileAsync("mmdc", ["--version"]);
    return { cmd: "mmdc", args: [] };
  } catch {
    return { cmd: "npx", args: ["mmdc"] };
  }
}

/**
 * Parse a .mmd file that may contain multiple diagrams
 * Each diagram should start with a title comment: %%% Title Name
 */
export function parseMermaidFile(content: string): Array<{ title: string; code: string }> {
  const diagrams: Array<{ title: string; code: string }> = [];
  const lines = content.split("\n");

  let currentTitle = "diagram";
  let currentCode: string[] = [];
  let inDiagram = false;

  for (const line of lines) {
    // Check for title marker
    const titleMatch = line.match(/^%%%\s*(.+)$/);
    if (titleMatch) {
      // Save previous diagram if any
      if (currentCode.length > 0 && inDiagram) {
        diagrams.push({
          title: currentTitle,
          code: currentCode.join("\n").trim(),
        });
      }
      currentTitle = titleMatch[1].trim().replace(/\s+/g, "-").toLowerCase();
      currentCode = [];
      inDiagram = false;
      continue;
    }

    // Check for diagram start (graph, flowchart, sequenceDiagram, etc.)
    const diagramStarters = [
      "graph",
      "flowchart",
      "sequenceDiagram",
      "classDiagram",
      "stateDiagram",
      "erDiagram",
      "gantt",
      "pie",
      "journey",
      "gitGraph",
      "mindmap",
      "timeline",
      "quadrantChart",
      "sankey",
      "xychart",
    ];

    if (!inDiagram && diagramStarters.some((s) => line.trim().startsWith(s))) {
      inDiagram = true;
    }

    if (inDiagram || line.trim()) {
      currentCode.push(line);
    }
  }

  // Don't forget the last diagram
  if (currentCode.length > 0) {
    diagrams.push({
      title: currentTitle,
      code: currentCode.join("\n").trim(),
    });
  }

  return diagrams;
}

/**
 * Render a single Mermaid diagram to the specified format
 */
export async function renderDiagram(
  code: string,
  outputPath: string,
  format: DiagramFormat = "svg"
): Promise<{ success: boolean; error?: string }> {
  // Write temporary input file
  const tempInput = outputPath.replace(/\.(svg|png|pdf)$/, ".mmd.tmp");

  try {
    await writeFile(tempInput, code, "utf-8");

    const { cmd, args } = await getMmdcCommand();
    const fullArgs = [
      ...args,
      "-i",
      tempInput,
      "-o",
      outputPath,
      "-b",
      "transparent",
    ];

    // Add format-specific options
    if (format === "png") {
      fullArgs.push("-s", "2"); // 2x scale for better quality
    }

    await execFileAsync(cmd, fullArgs, { timeout: 30000 });

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Unknown error rendering diagram",
    };
  } finally {
    // Cleanup temp file
    try {
      await unlink(tempInput);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Render all diagrams from a .mmd file
 */
export async function renderMermaidFile(
  inputPath: string,
  outputDir: string,
  format: DiagramFormat = "svg"
): Promise<RenderResult> {
  const result: RenderResult = {
    inputFile: inputPath,
    outputFiles: [],
    success: true,
  };

  try {
    const content = await readFile(inputPath, "utf-8");
    const diagrams = parseMermaidFile(content);

    if (diagrams.length === 0) {
      result.error = "No diagrams found in file";
      result.success = false;
      return result;
    }

    const errors: string[] = [];

    for (let i = 0; i < diagrams.length; i++) {
      const diagram = diagrams[i];
      const outputName =
        diagrams.length === 1
          ? `diagrams.${format}`
          : `diagram-${diagram.title || i + 1}.${format}`;
      const outputPath = join(outputDir, outputName);

      const renderResult = await renderDiagram(diagram.code, outputPath, format);

      if (renderResult.success) {
        result.outputFiles.push(outputPath);
      } else {
        errors.push(`${diagram.title}: ${renderResult.error}`);
      }
    }

    if (errors.length > 0) {
      result.error = errors.join("; ");
      if (result.outputFiles.length === 0) {
        result.success = false;
      }
    }
  } catch (error: any) {
    result.success = false;
    result.error = error.message;
  }

  return result;
}

/**
 * Render diagrams.mmd in an output directory
 * Returns info about what was rendered
 */
export async function renderOutputDiagrams(
  outputDir: string,
  format: DiagramFormat = "svg"
): Promise<{
  rendered: boolean;
  files: string[];
  error?: string;
}> {
  const mmdPath = join(outputDir, "diagrams.mmd");

  // Check if diagrams.mmd exists
  try {
    await access(mmdPath);
  } catch {
    return {
      rendered: false,
      files: [],
      error: "diagrams.mmd not found",
    };
  }

  // Check if mmdc is available
  const mmdcAvailable = await isMermaidCliAvailable();
  if (!mmdcAvailable) {
    return {
      rendered: false,
      files: [],
      error:
        "mermaid-cli not found. Install with: npm install -g @mermaid-js/mermaid-cli",
    };
  }

  const result = await renderMermaidFile(mmdPath, outputDir, format);

  return {
    rendered: result.success,
    files: result.outputFiles,
    error: result.error,
  };
}
