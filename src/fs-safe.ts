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
import { open, realpath, stat } from "fs/promises";
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, type Stats } from "fs";
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
  const realTarget = await resolveContainedPath(repoPath, relPath);
  const file = await open(realTarget, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    checkReadableMetadata(await file.stat(), relPath);
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(64 * 1024);
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      total += bytesRead;
      checkReadSize(total, relPath);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks).toString("utf-8");
  } finally {
    await file.close();
  }
}

/** Optional metadata follows the same boundary, returning null when unavailable. */
export async function readContainedFileOrNull(
  repoPath: string,
  relPath: string
): Promise<string | null> {
  try {
    return await readContainedFile(repoPath, relPath);
  } catch {
    return null;
  }
}

function checkReadableMetadata(metadata: Stats, relPath: string): void {
  if (!metadata.isFile()) {
    throw new Error(`Refusing to read '${relPath}': not a regular file`);
  }
  checkReadSize(metadata.size, relPath);
}

function checkReadSize(size: number, relPath: string): void {
  if (size > MAX_CONTAINED_FILE_BYTES) {
    throw new Error(`Refusing to read '${relPath}': ${size} bytes exceeds cap`);
  }
}

/** Synchronous counterpart for the public repository-prompt reader. */
export function readContainedFileSync(repoPath: string, relPath: string): string {
  const realRoot = realpathSync(repoPath);
  const realTarget = realpathSync(join(repoPath, relPath));
  if (!isPathInsideDir(realRoot, realTarget)) {
    throw new Error(`Refusing to read '${relPath}': symlink escapes repository root`);
  }
  const fd = openSync(realTarget, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    checkReadableMetadata(fstatSync(fd), relPath);
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(64 * 1024);
      const bytesRead = readSync(fd, chunk);
      if (!bytesRead) break;
      total += bytesRead;
      checkReadSize(total, relPath);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks).toString("utf-8");
  } finally {
    closeSync(fd);
  }
}

/** Resolve a fixed-name file while retaining the reader's containment guard. */
async function resolveContainedPath(repoPath: string, relPath: string): Promise<string> {
  const fullPath = join(repoPath, relPath);
  const [realRoot, realTarget] = await Promise.all([realpath(repoPath), realpath(fullPath)]);
  if (!isPathInsideDir(realRoot, realTarget)) {
    throw new Error(`Refusing to read '${relPath}': symlink escapes repository root`);
  }
  return realTarget;
}

/** Check for a regular contained file without buffering its contents. */
export async function hasContainedFile(repoPath: string, relPath: string): Promise<boolean> {
  try {
    return (await stat(await resolveContainedPath(repoPath, relPath))).isFile();
  } catch {
    return false;
  }
}
