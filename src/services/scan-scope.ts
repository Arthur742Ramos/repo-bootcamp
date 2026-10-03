import { realpath, stat } from "fs/promises";
import { relative, resolve, sep } from "path";

import type { RepoInfo } from "../types.js";
import { isPathInsideDir } from "../utils.js";

/** Validate the scanner's contained directory boundary without walking files. */
export async function resolveScanRoot(basePath: string, subdir?: string): Promise<string> {
  const realBasePath = await realpath(basePath);
  const requestedScanRoot = subdir ? resolve(basePath, subdir) : basePath;
  let scanRoot: string;
  try {
    scanRoot = await realpath(requestedScanRoot);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && subdir) {
      throw new Error(`Scan subdir does not exist: ${subdir}`, { cause: error });
    }
    throw error;
  }
  if (!isPathInsideDir(realBasePath, scanRoot)) {
    throw new Error(`Scan subdir escapes repository root: ${subdir}`);
  }
  const scanRootStats = await stat(scanRoot);
  if (!scanRootStats.isDirectory()) {
    throw new Error(`Scan subdir is not a directory: ${subdir}`);
  }
  return scanRoot;
}

/** Derive Git source paths after the contained scanner validated the selected directory. */
export async function updateSourcePathPrefix(
  repoPath: string,
  subdir: string | undefined,
  repoInfo: RepoInfo
): Promise<void> {
  if (!subdir) return;
  // Contained aliases are valid scan roots; source URLs need the actual Git
  // path. Recompute after each scan because watch updates can retarget them.
  const [root, selected] = await Promise.all([
    realpath(repoPath),
    realpath(resolve(repoPath, subdir)),
  ]);
  repoInfo.sourcePathPrefix = relative(root, selected).split(sep).join("/");
}
