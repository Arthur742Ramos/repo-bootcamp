/**
 * Repo Resolver Module
 * Handles resolving repository sources - both local paths and GitHub URLs
 */

import { resolve, basename } from "path";
import { stat, rm, access } from "fs/promises";
import { homedir } from "os";
import { parseGitHubUrl, cloneRepo } from "./ingest.js";
import type { RepoInfo } from "./types.js";

/**
 * Represents a resolved repository source
 */
export interface RepoSource {
  path: string;
  isLocal: boolean;
  repoName: string;
  repoInfo: RepoInfo;
  cleanup: () => Promise<void>;
}

/**
 * Check if the input looks like a local filesystem path
 */
export function isLocalPath(input: string): boolean {
  if (!input || typeof input !== "string") {
    return false;
  }
  
  const trimmed = input.trim();
  
  // Explicit local path patterns
  if (trimmed === ".") return true;
  if (trimmed === "..") return true;
  if (trimmed.startsWith("/")) return true;
  if (trimmed.startsWith("./")) return true;
  if (trimmed.startsWith("../")) return true;
  if (trimmed.startsWith("~/")) return true;
  if (trimmed === "~") return true;
  
  // Windows-style paths (C:\, D:\, etc.)
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;
  
  // Not a URL pattern (no protocol)
  if (trimmed.includes("://")) return false;
  if (trimmed.includes("github.com")) return false;
  if (trimmed.includes("@")) return false; // git@github.com style
  
  return false;
}

/**
 * Resolve a local path to an absolute path
 * Expands ~ to home directory and resolves relative paths
 */
export function resolveLocalPath(input: string): string {
  let resolved = input.trim();
  
  // Expand home directory
  if (resolved === "~") {
    resolved = homedir();
  } else if (resolved.startsWith("~/")) {
    resolved = resolve(homedir(), resolved.slice(2));
  } else {
    resolved = resolve(process.cwd(), resolved);
  }
  
  return resolved;
}

/**
 * Get repository name from a local path
 */
export function getRepoNameFromPath(localPath: string): string {
  const absolutePath = resolve(localPath);
  const name = basename(absolutePath);
  return name || "local-repo";
}

/**
 * Check if a path is a git repository
 */
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    await access(resolve(path, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create RepoInfo for a local path
 */
function createLocalRepoInfo(localPath: string, repoName: string): RepoInfo {
  return {
    owner: "local",
    repo: repoName,
    url: `file://${localPath}`,
    branch: "local",
    fullName: `local/${repoName}`,
  };
}

/**
 * Resolve a repository source from either a local path or GitHub URL
 * 
 * @param input - Either a local filesystem path or a GitHub URL
 * @param outputDir - Output directory (used for cloning GitHub repos)
 * @returns A RepoSource with path, metadata, and cleanup function
 */
export async function resolveRepo(
  input: string,
  outputDir: string = process.cwd()
): Promise<RepoSource> {
  if (isLocalPath(input)) {
    // Handle local path
    const absolutePath = resolveLocalPath(input);
    
    // Verify the path exists
    try {
      const stats = await stat(absolutePath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${absolutePath}`);
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Path does not exist: ${absolutePath}`);
      }
      throw error;
    }
    
    // Check if it's a git repo and warn if not
    const isGit = await isGitRepo(absolutePath);
    if (!isGit) {
      console.warn(`⚠️  Warning: ${absolutePath} is not a git repository`);
    }
    
    const repoName = getRepoNameFromPath(absolutePath);
    const repoInfo = createLocalRepoInfo(absolutePath, repoName);
    
    return {
      path: absolutePath,
      isLocal: true,
      repoName,
      repoInfo,
      cleanup: async () => {
        // No cleanup needed for local paths - we don't delete user's code!
      },
    };
  } else {
    // Handle GitHub URL
    const repoInfo = parseGitHubUrl(input);
    const clonePath = await cloneRepo(repoInfo, outputDir);
    
    return {
      path: clonePath,
      isLocal: false,
      repoName: repoInfo.repo,
      repoInfo,
      cleanup: async () => {
        // Clean up cloned repository
        try {
          await rm(clonePath, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      },
    };
  }
}
