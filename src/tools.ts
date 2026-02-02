/**
 * Copilot SDK Tools for Repo Bootcamp
 * 
 * Provides agentic tools that the model can use to explore the repository.
 */

import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import { readFile, readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { exec, execFile } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Context for tool execution
 */
export interface ToolContext {
  repoPath: string;
  verbose: boolean;
  onToolCall?: (name: string, args: unknown) => void;
  onToolResult?: (name: string, result: string) => void;
}

/**
 * Read a file from the repository
 */
function createReadFileTool(context: ToolContext): Tool<any> {
  return defineTool("read_file", {
    description: "Read the contents of a file from the repository. Use this to examine source code, configuration files, and documentation.",
    parameters: {
      type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file relative to repository root (e.g., 'src/index.ts', 'package.json')",
      },
      maxLines: {
        type: "number",
        description: "Maximum number of lines to return (default: 500)",
      },
    },
    required: ["path"],
  },
  handler: async (args: { path: string; maxLines?: number }) => {
    const { path, maxLines = 500 } = args;
    const fullPath = join(context.repoPath, path);

    context.onToolCall?.("read_file", { path });

    try {
      const content = await readFile(fullPath, "utf-8");
      const lines = content.split("\n");
      const truncated = lines.slice(0, maxLines).join("\n");
      const result = lines.length > maxLines
        ? `${truncated}\n\n... (truncated, showing ${maxLines} of ${lines.length} lines)`
        : truncated;

      context.onToolResult?.("read_file", `Read ${lines.length} lines from ${path}`);
      return { textResultForLlm: result, resultType: "success" as const };
    } catch (error: any) {
      const errorMsg = `Error reading file ${path}: ${error.message}`;
      context.onToolResult?.("read_file", errorMsg);
      return { textResultForLlm: errorMsg, resultType: "failure" as const };
    }
  },
  });
}

/**
 * List files in a directory
 */
function createListFilesTool(context: ToolContext): Tool<any> {
  return defineTool("list_files", {
  description: "List files and directories in a path. Use this to explore the repository structure.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path relative to repository root (default: root directory)",
      },
      pattern: {
        type: "string",
        description: "Optional glob pattern to filter files (e.g., '*.ts', '*.py')",
      },
      recursive: {
        type: "boolean",
        description: "Whether to list files recursively (default: false)",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results (default: 100)",
      },
    },
  },
  handler: async (args: { path?: string; pattern?: string; recursive?: boolean; maxResults?: number }) => {
    const { path = "", pattern, recursive = false, maxResults = 100 } = args;
    const fullPath = join(context.repoPath, path);

    context.onToolCall?.("list_files", { path, pattern, recursive });

    try {
      const results: string[] = [];

      async function scanDir(dir: string, depth: number = 0): Promise<void> {
        if (results.length >= maxResults) return;

        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (results.length >= maxResults) break;

          // Skip common unimportant directories
          if (entry.isDirectory() && [
            "node_modules", ".git", "dist", "build", "out", ".next",
            "__pycache__", ".venv", "venv", "vendor", ".idea", ".vscode",
            "coverage", ".nyc_output", "target", ".gradle",
          ].includes(entry.name)) {
            continue;
          }

          const entryPath = join(dir, entry.name);
          const relativePath = relative(context.repoPath, entryPath);

          // Apply pattern filter if specified
          if (pattern) {
            const regex = new RegExp(pattern.replace(/\*/g, ".*").replace(/\?/g, "."));
            if (!regex.test(entry.name)) {
              if (entry.isDirectory() && recursive) {
                await scanDir(entryPath, depth + 1);
              }
              continue;
            }
          }

          const prefix = entry.isDirectory() ? "[dir]  " : "[file] ";
          results.push(`${prefix}${relativePath}`);

          if (entry.isDirectory() && recursive) {
            await scanDir(entryPath, depth + 1);
          }
        }
      }

      await scanDir(fullPath);

      const result = results.length > 0
        ? results.join("\n")
        : "No files found matching criteria";

      context.onToolResult?.("list_files", `Found ${results.length} items`);
      return { textResultForLlm: result, resultType: "success" as const };
    } catch (error: any) {
      const errorMsg = `Error listing files in ${path}: ${error.message}`;
      context.onToolResult?.("list_files", errorMsg);
      return { textResultForLlm: errorMsg, resultType: "failure" as const };
    }
  },
  });
}

/**
 * Search for text in files
 */
function createSearchTool(context: ToolContext): Tool<any> {
  return defineTool("search", {
  description: "Search for a pattern in repository files using ripgrep. Use this to find specific code patterns, function definitions, imports, etc.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Search pattern (regex supported)",
      },
      path: {
        type: "string",
        description: "Path to search in (default: entire repository)",
      },
      filePattern: {
        type: "string",
        description: "File pattern to filter (e.g., '*.ts', '*.py')",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results (default: 50)",
      },
    },
    required: ["pattern"],
  },
  handler: async (args: { pattern: string; path?: string; filePattern?: string; maxResults?: number }) => {
    const { pattern, path = "", filePattern, maxResults = 50 } = args;
    const searchPath = join(context.repoPath, path);

    context.onToolCall?.("search", { pattern, path, filePattern });

    try {
      const rgArgs = ["--line-number", "--no-heading", "--max-count", String(maxResults)];
      if (filePattern) {
        rgArgs.push("--glob", filePattern);
      }
      rgArgs.push(pattern, searchPath);

      const { stdout } = await execFileAsync("rg", rgArgs, { timeout: 30000 });

      // Make paths relative
      const lines = stdout.split("\n").filter(Boolean).map(line => {
        const relativeLine = line.replace(context.repoPath + "/", "");
        return relativeLine;
      });

      const result = lines.length > 0
        ? lines.join("\n")
        : `No matches found for pattern: ${pattern}`;

      context.onToolResult?.("search", `Found ${lines.length} matches`);
      return { textResultForLlm: result, resultType: "success" as const };
    } catch (error: any) {
      // ripgrep returns exit code 1 when no matches found
      if (error.code === 1) {
        context.onToolResult?.("search", "No matches found");
        return { textResultForLlm: `No matches found for pattern: ${pattern}`, resultType: "success" as const };
      }
      const errorMsg = `Error searching: ${error.message}`;
      context.onToolResult?.("search", errorMsg);
      return { textResultForLlm: errorMsg, resultType: "failure" as const };
    }
  },
  });
}

/**
 * Get repository metadata
 */
function createRepoMetadataTool(context: ToolContext): Tool<any> {
  return defineTool("get_repo_metadata", {
  description: "Get metadata about the repository including detected stack, available commands, and file statistics.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    context.onToolCall?.("get_repo_metadata", {});

    try {
      // Count files by extension
      const extCounts: Record<string, number> = {};
      let totalFiles = 0;
      let totalSize = 0;

      async function countFiles(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!["node_modules", ".git", "dist", "build", "vendor"].includes(entry.name)) {
              await countFiles(join(dir, entry.name));
            }
          } else {
            totalFiles++;
            const ext = entry.name.includes(".") ? entry.name.split(".").pop()! : "no-ext";
            extCounts[ext] = (extCounts[ext] || 0) + 1;
            try {
              const stats = await stat(join(dir, entry.name));
              totalSize += stats.size;
            } catch { }
          }
        }
      }

      await countFiles(context.repoPath);

      // Get git info
      let gitInfo = "";
      try {
        const { stdout: branch } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: context.repoPath });
        const { stdout: commits } = await execAsync("git rev-list --count HEAD", { cwd: context.repoPath });
        const { stdout: remotes } = await execAsync("git remote -v", { cwd: context.repoPath });
        gitInfo = `Branch: ${branch.trim()}\nCommits: ${commits.trim()}\nRemotes:\n${remotes.trim()}`;
      } catch {
        gitInfo = "Git info not available";
      }

      // Top extensions
      const topExts = Object.entries(extCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([ext, count]) => `  .${ext}: ${count}`)
        .join("\n");

      const result = `Repository Statistics:
Total files: ${totalFiles}
Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB

File types:
${topExts}

${gitInfo}`;

      context.onToolResult?.("get_repo_metadata", `Collected metadata for ${totalFiles} files`);
      return { textResultForLlm: result, resultType: "success" as const };
    } catch (error: any) {
      const errorMsg = `Error getting metadata: ${error.message}`;
      context.onToolResult?.("get_repo_metadata", errorMsg);
      return { textResultForLlm: errorMsg, resultType: "failure" as const };
    }
  },
  });
}

/**
 * Get all tools for session creation
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRepoTools(context: ToolContext): Tool<any>[] {
  return [
    createReadFileTool(context),
    createListFilesTool(context),
    createSearchTool(context),
    createRepoMetadataTool(context),
  ];
}
