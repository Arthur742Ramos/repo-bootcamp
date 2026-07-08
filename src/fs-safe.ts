/**
 * Symlink-safe fixed-name file reader.
 *
 * A malicious repo can commit a fixed-name file (README.md, package.json,
 * Makefile, justfile, …) as a symlink to an arbitrary host path (~/.ssh/id_rsa,
 * .env). scanDirectory already drops symlink entries, but the fixed-name readers
 * used by ingest/impact/tasks bypass the scan set, so this module resolves the
 * real path and verifies repo containment before reading. Kept dependency-free
 * (only node builtins + the shared containment check) so any engine can reuse it
 * without pulling in the ingest module — and without risking an import cycle.
 */
import { readFile, realpath, stat } from "fs/promises";
import { join } from "path";

import { isPathInsideDir } from "./utils.js";

/** Cap for a fixed-name metadata/doc file read via {@link readContainedFile} —
 *  guards against a committed huge file (or a /dev/zero-style device symlink)
 *  buffering unbounded memory. */
export const MAX_CONTAINED_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Read a repo-relative file, refusing to follow a symlink that escapes the repo.
 * Both sides are realpath'd so macOS's /var -> /private/var alias (or a symlinked
 * parent of the clone dir) doesn't cause a false rejection.
 */
export async function readContainedFile(repoPath: string, relPath: string): Promise<string> {
  const fullPath = join(repoPath, relPath);
  const [realRoot, realTarget] = await Promise.all([realpath(repoPath), realpath(fullPath)]);
  if (!isPathInsideDir(realRoot, realTarget)) {
    throw new Error(`Refusing to read '${relPath}': symlink escapes repository root`);
  }
  const { size } = await stat(realTarget);
  if (size > MAX_CONTAINED_FILE_BYTES) {
    throw new Error(`Refusing to read '${relPath}': ${size} bytes exceeds cap`);
  }
  return readFile(realTarget, "utf-8");
}
