/**
 * Shared utility functions and constants
 */

import { readFile, access } from "fs/promises";

/**
 * Common directory names to skip during repository traversal
 */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
  ".idea",
  ".vscode",
  "coverage",
  ".nyc_output",
  "target",
  ".gradle",
]);

/** Common README filename variants */
export const README_NAMES = ["README.md", "readme.md", "README.MD", "Readme.md"];

/**
 * Read file safely, returning null if not found or unreadable
 */
export async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    await access(filePath);
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
