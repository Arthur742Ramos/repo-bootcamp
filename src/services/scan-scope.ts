import { realpath } from "fs/promises";
import { relative, resolve, sep } from "path";

import type { RepoInfo } from "../types.js";

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
