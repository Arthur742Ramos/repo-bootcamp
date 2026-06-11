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
 * Read the value of a CLI flag directly from a raw argument list.
 *
 * Supports both `--flag value` and `--flag=value` forms. This exists to work
 * around Commander routing options whose flag names collide with the root
 * command (e.g. `--branch`, `--max-files`, `--style`) to the root rather than
 * the subcommand. Pure (takes `args`) so it is easy to test.
 */
export function getFlagValue(args: string[], flags: string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (flags.includes(arg)) {
      return args[index + 1];
    }
    for (const flag of flags) {
      if (arg.startsWith(`${flag}=`)) {
        return arg.slice(flag.length + 1);
      }
    }
  }
  return undefined;
}

/**
 * Whether any of the given boolean flags is present in a raw argument list.
 *
 * Companion to {@link getFlagValue} for boolean options (e.g. `--full-clone`)
 * that collide with root-command flags. Pure (takes `args`) for testability.
 */
export function hasFlag(args: string[], flags: string[]): boolean {
  return args.some((arg) => flags.includes(arg) || flags.some((flag) => arg.startsWith(`${flag}=`)));
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
