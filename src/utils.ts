/**
 * Shared utility functions and constants
 */

import { readFile, access } from "fs/promises";
import { isAbsolute, relative, resolve } from "path";

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

/**
 * Convert a filesystem path to POSIX form (forward slashes).
 *
 * Use for paths that are surfaced to LLMs, written to JSON outputs,
 * or compared against repo-relative path strings — anywhere the
 * native Windows backslash separator would cause inconsistency.
 *
 * Does not perform path resolution; callers should resolve/normalize first
 * if needed.
 */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Test whether `child` is the same path as `parent` or strictly inside it.
 *
 * Resolves both inputs internally so callers can pass relative or absolute
 * paths in any normalized form. Cross-platform: works correctly on Windows
 * where the path separator is `\` and on POSIX where it is `/`.
 *
 * NOTE: This is a lexical check only — it does not resolve symlinks. If a
 * path inside `parent` is a symlink pointing outside, this still returns
 * true. Use `fs.realpath` first if symlink containment matters.
 */
export function isPathInsideDir(parent: string, child: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  const rel = relative(resolvedParent, resolvedChild);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
