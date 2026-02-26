import { rm } from "fs/promises";

import { cloneRepo, scanRepo } from "../ingest.js";
import type { RepoInfo, ScanResult } from "../types.js";

export async function cloneRepository(
  repoInfo: RepoInfo,
  branch?: string,
  fullClone?: boolean
): Promise<string> {
  return cloneRepo(repoInfo, process.cwd(), branch, fullClone);
}

export async function scanRepositoryFiles(repoPath: string, maxFiles: number): Promise<ScanResult> {
  return scanRepo(repoPath, maxFiles);
}

export async function cleanupRepository(repoPath: string): Promise<void> {
  await rm(repoPath, { recursive: true, force: true });
}
