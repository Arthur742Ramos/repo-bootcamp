import { createHash } from "crypto";
import { lstat, realpath } from "fs/promises";
import { join, relative, sep } from "path";
import { JSON_SCHEMA, load } from "js-yaml";
import picomatch from "picomatch";

import { hasContainedFile, readContainedFile } from "./fs-safe.js";
import { createFileExclusionMatcher } from "./scan-walk.js";
import { detectPackageManager, type PackageManager } from "./tasks.js";
import { isPathInsideDir } from "./utils.js";

interface ScopedManagerOptions {
  /** Explicit original input/clone boundary, never inferred from ancestors. */
  repositoryRoot: string;
  selectedRoot: string;
  selectedFiles?: ReadonlySet<string>;
  exclude?: readonly string[];
}

interface ScopedManagerResult {
  packageManager: PackageManager;
  packageManagerContextFingerprint?: string;
}

const LOCKS = [
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
];

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function manifest(root: string): Promise<Record<string, unknown> | null> {
  if (!(await hasContainedFile(root, "package.json"))) return null;
  const value: unknown = JSON.parse(await readContainedFile(root, "package.json"));
  return object(value) ? value : null;
}

// Deliberately support a bounded literal/common-glob subset. Unsupported patterns
// reject the whole declaration, so exclusions are never silently discarded.
function workspacePatterns(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 256) return null;
  let bytes = 0;
  for (const pattern of value) {
    if (typeof pattern !== "string" || !pattern || pattern.length > 1024) return null;
    bytes += pattern.length;
    if (bytes > 64 * 1024 || /[\0\\?$[\]{}()]/.test(pattern)) return null;
    const path = pattern.replace(/^!/, "").replace(/^(?:\.\/)+/, "");
    if (!path || path.startsWith("/") || path.includes("!") || /^[A-Za-z]:/.test(path)) return null;
    if (
      path
        .split("/")
        .some(
          (part) => !part || part === "." || part === ".." || (part.includes("**") && part !== "**")
        )
    )
      return null;
  }
  return value;
}

/** Resolve only a proven manager context; all other file consumers stay selected. */
export async function resolveScopedPackageManager({
  repositoryRoot,
  selectedRoot,
  selectedFiles,
  exclude = [],
}: ScopedManagerOptions): Promise<ScopedManagerResult> {
  const packageManager = await detectPackageManager(selectedRoot);
  const fallback = { packageManager };
  if (packageManager !== "npm" || (selectedFiles && !selectedFiles.has("package.json")))
    return fallback;
  try {
    const [root, selected] = await Promise.all([realpath(repositoryRoot), realpath(selectedRoot)]);
    if (root === selected || !isPathInsideDir(root, selected)) return fallback;
    const path = relative(root, selected).split(sep).join("/");
    const parts = path.split("/");
    if (parts.length > 64) return fallback;
    const child = await manifest(selected);
    if (!child || (child.packageManager !== undefined && child.packageManager !== ""))
      return fallback;
    for (const lock of LOCKS) {
      try {
        await lstat(join(selected, lock));
        return fallback;
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return fallback;
      }
    }

    // New context evidence observes conservative root-relative and absolute
    // exclusions without changing selected walk or fixed-name reader policy.
    const excluded = createFileExclusionMatcher(repositoryRoot, exclude);
    const realExcluded = createFileExclusionMatcher(root, exclude);
    for (const name of ["package.json", "pnpm-workspace.yaml", ...LOCKS]) {
      if (excluded(name) || realExcluded(name)) return fallback;
    }
    // A nearer workspace is a blocker only, never a source of inherited fields.
    // Even an unreadable/symlink/directory marker makes outer attribution unsafe.
    for (let i = 1; i <= parts.length; i++) {
      const marker = join(root, ...parts.slice(0, i), "pnpm-workspace.yaml");
      try {
        await lstat(marker);
        return fallback;
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return fallback;
      }
    }
    const parent = await manifest(root);
    if (!parent || !(await hasContainedFile(root, "pnpm-workspace.yaml"))) return fallback;
    const rootManager = await detectPackageManager(root);
    if (rootManager !== "pnpm") return fallback;
    const yaml: unknown = load(await readContainedFile(root, "pnpm-workspace.yaml"), {
      schema: JSON_SCHEMA,
    });
    const patterns = object(yaml) ? workspacePatterns(yaml.packages) : null;
    if (!patterns) return fallback;
    const matches = (pattern: string) =>
      picomatch(pattern.replace(/^(?:\.\/)+/, ""), {
        dot: false,
        nonegate: true,
        nobrace: true,
        noext: true,
        posix: true,
        windows: false,
      })(path);
    if (
      !patterns.some((p) => !p.startsWith("!") && matches(p)) ||
      patterns.some((p) => p.startsWith("!") && matches(p.slice(1)))
    )
      return fallback;
    // Relevant normalized projection only: no absolute paths, root scripts,
    // credentials/settings, lock contents, sibling dependencies or env expansion.
    const rootLocks = [];
    for (const lock of LOCKS) {
      try {
        await lstat(join(root, lock));
        if (!(await hasContainedFile(root, lock))) return fallback;
        rootLocks.push(lock);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return fallback;
      }
    }
    const identity = {
      version: 1,
      path,
      packageManager: "pnpm",
      rootManagerField: typeof parent.packageManager === "string" ? parent.packageManager : null,
      rootLocks,
      patterns,
    };
    return {
      packageManager: "pnpm",
      packageManagerContextFingerprint: createHash("sha256")
        .update(JSON.stringify(identity))
        .digest("hex"),
    };
  } catch {
    return fallback;
  }
}
