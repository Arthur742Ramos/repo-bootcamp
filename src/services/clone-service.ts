import { rm } from "fs/promises";

import { cloneRepo, scanRepo } from "../ingest.js";
import type { RepoInfo, ScanResult } from "../types.js";

function validateCloneRequest(repoInfo: RepoInfo, branch?: string): void {
  if (!repoInfo?.url || typeof repoInfo.url !== "string") {
    throw new Error("Repository URL is required");
  }
  if (repoInfo.url.startsWith("-") || /[\r\n\t]/.test(repoInfo.url)) {
    throw new Error("Repository URL contains unsafe characters");
  }
  if (!/^(https?:\/\/|file:\/\/)/i.test(repoInfo.url)) {
    throw new Error("Unsupported repository URL protocol");
  }
  if (!repoInfo.owner || !repoInfo.repo) {
    throw new Error("Repository owner and name are required");
  }
  if (branch) {
    if (
      /[\r\n\t]/.test(branch) ||
      branch.startsWith("-") ||
      branch.includes("..") ||
      branch.includes("@{") ||
      branch.includes("\\") ||
      !/^[A-Za-z0-9._/-]+$/.test(branch)
    ) {
      throw new Error("Branch contains unsafe characters");
    }
  }
}

export async function cloneRepository(
  repoInfo: RepoInfo,
  branch?: string,
  fullClone?: boolean
): Promise<string> {
  validateCloneRequest(repoInfo, branch);
  return cloneRepo(repoInfo, process.cwd(), branch, fullClone);
}

export async function scanRepositoryFiles(
  repoPath: string,
  maxFiles: number,
  options?: { exclude?: string[]; subdir?: string }
): Promise<ScanResult> {
  // Only forward the scope object when set so the common call stays two-argument.
  return options ? scanRepo(repoPath, maxFiles, options) : scanRepo(repoPath, maxFiles);
}

export async function cleanupRepository(repoPath: string): Promise<void> {
  await rm(repoPath, { recursive: true, force: true });
}
