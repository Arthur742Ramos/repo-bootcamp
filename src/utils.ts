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

/**
 * Coerce a possibly-invalid number to a safe fallback.
 *
 * Returns `value` when it is a finite number (i.e. not `NaN` or `±Infinity`)
 * and — when `opts.min` is provided — at least `opts.min`. Otherwise returns
 * `fallback`. Intended for sanitising numeric CLI flags such as `--max-files`,
 * where `Number(flag)` can yield `NaN` and silently poison later comparisons.
 */
export function finiteOr(value: unknown, fallback: number, opts?: { min?: number }): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (opts?.min !== undefined && value < opts.min) return fallback;
  return value;
}

/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * Returns `error.message` for `Error` instances, otherwise `String(error)`.
 * Falls back to `fallback` when the resulting message is empty or whitespace,
 * so callers always have something non-empty to surface to the user.
 */
export function getErrorMessage(error: unknown, fallback = "Unknown error"): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().length > 0 ? message : fallback;
}

/**
 * Canonical, case-insensitive predicate for whether a path denotes a test (or
 * mock) file. This is the single source of truth shared by the metrics, health,
 * cycles and radar commands so they all classify test code identically.
 *
 * It is a superset of every former per-module variant and recognises:
 *  - `.test.` / `.spec.` filename infixes (`foo.test.ts`, `foo.spec.tsx`)
 *  - `_test` filename suffix for any extension (`foo_test.go`, `foo_test.py`),
 *    kept extension-agnostic to stay a superset of the original cycles.ts check
 *  - `_spec` filename suffix for the Ruby/Go/Python conventions (`foo_spec.rb`)
 *  - Python `test_*.py` files
 *  - `test` / `tests` / `spec` / `specs` / `__tests__` / `__mocks__` path segments
 *
 * Backslashes are normalised and matching is case-insensitive, so mixed-case or
 * Windows-style paths (`Tests\Foo.Test.ts`) are classified consistently.
 */
export function isTestFile(path: string): boolean {
  const normalized = toPosixPath(path).toLowerCase();
  // `.test.` / `.spec.` infix in the filename (JS/TS and friends).
  if (/\.(test|spec)\.[^./]+$/.test(normalized)) return true;
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  // `_test` suffix (Go, Python, Rust, …); extension-agnostic on purpose so this
  // remains a superset of the former cycles.ts predicate.
  if (/_test\.[^.]+$/.test(base)) return true;
  // `_spec` suffix for the Ruby (RSpec)/Go/Python underscore conventions.
  if (/_spec\.(go|py|rb)$/.test(base)) return true;
  // Python `test_*.py` naming convention.
  if (/^test_.+\.py$/.test(base)) return true;
  // Directory segments that denote test/mock trees.
  return normalized
    .split("/")
    .some(
      (segment) =>
        segment === "test" ||
        segment === "tests" ||
        segment === "spec" ||
        segment === "specs" ||
        segment === "__tests__" ||
        segment === "__mocks__",
    );
}
