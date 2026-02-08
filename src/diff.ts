/**
 * Diff/Compare Mode Module
 * Compares two refs to generate onboarding deltas
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type { DiffSummary, RepoInfo } from "./types.js";

const execFileAsync = promisify(execFile);

/** Maximum buffer size for git diff operations (10 MB) */
const DIFF_MAX_BUFFER = 10 * 1024 * 1024;
/** Maximum buffer size for individual file diffs (5 MB) */
const FILE_DIFF_MAX_BUFFER = 5 * 1024 * 1024;
/** Maximum number of code files to scan for environment variable changes */
const MAX_CODE_FILES_FOR_ENV_SCAN = 20;
/** Maximum index files to check for removed exports */
const MAX_INDEX_FILES_FOR_BREAKING_SCAN = 5;
/** Maximum removed export lines to report per file */
const MAX_REMOVED_EXPORTS_PER_FILE = 3;
/** Maximum files shown in diff docs listings */
const MAX_DIFF_DOC_FILES = 30;
const MAX_DIFF_DOC_MODIFIED = 50;

/**
 * Read package.json content at a specific git ref.
 * Shared helper to avoid duplicated git-show logic across functions.
 * @param repoPath - Path to the git repository
 * @param ref - Git ref (tag, branch, commit hash)
 * @returns Parsed package.json object, or empty object if unavailable
 */
async function getPackageJsonAtRef(
  repoPath: string,
  ref: string
): Promise<Record<string, unknown>> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["show", `${ref}:package.json`],
      { cwd: repoPath }
    );
    return JSON.parse(stdout);
  } catch (err) {
    console.debug?.(`package.json not available at ref ${ref}: ${err instanceof Error ? err.message : err}`);
    return {};
  }
}

/**
 * Get list of changed files between two refs
 */
async function getChangedFiles(
  repoPath: string,
  baseRef: string,
  headRef: string
): Promise<{ added: string[]; removed: string[]; modified: string[] }> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-status", `${baseRef}...${headRef}`],
      { cwd: repoPath, maxBuffer: DIFF_MAX_BUFFER }
    );

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      const [status, ...pathParts] = line.split("\t");
      const path = pathParts.join("\t");

      switch (status[0]) {
        case "A":
          added.push(path);
          break;
        case "D":
          removed.push(path);
          break;
        case "M":
        case "R":
        case "C":
          modified.push(path);
          break;
      }
    }

    return { added, removed, modified };
  } catch (error: unknown) {
    throw new Error(`Failed to get diff: ${(error as Error).message}`);
  }
}

/**
 * Get diff content for a specific file
 */
async function getFileDiff(
  repoPath: string,
  baseRef: string,
  headRef: string,
  filePath: string
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", `${baseRef}...${headRef}`, "--", filePath],
      { cwd: repoPath, maxBuffer: FILE_DIFF_MAX_BUFFER }
    );
    return stdout;
  } catch (err) {
    console.debug?.(`git diff failed for ${filePath}: ${err instanceof Error ? err.message : err}`);
    return "";
  }
}

/**
 * Extract dependency changes from pre-read package.json objects.
 * Synchronous — no git calls needed when basePkg/headPkg are pre-read.
 * @param basePkg - Package.json at the base ref
 * @param headPkg - Package.json at the head ref
 * @returns Added and removed dependency names
 */
function extractDependencyChanges(
  basePkg: Record<string, unknown>,
  headPkg: Record<string, unknown>
): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];

  try {
    const baseDeps = new Set([
      ...Object.keys((basePkg.dependencies as Record<string, unknown>) || {}),
      ...Object.keys((basePkg.devDependencies as Record<string, unknown>) || {}),
    ]);

    const headDeps = new Set([
      ...Object.keys((headPkg.dependencies as Record<string, unknown>) || {}),
      ...Object.keys((headPkg.devDependencies as Record<string, unknown>) || {}),
    ]);

    for (const dep of headDeps) {
      if (!baseDeps.has(dep)) added.push(dep);
    }
    for (const dep of baseDeps) {
      if (!headDeps.has(dep)) removed.push(dep);
    }
  } catch (err) {
    console.debug?.(`Dependency comparison failed: ${err instanceof Error ? err.message : err}`);
  }

  return { added, removed };
}

/**
 * Extract new environment variables from .env files or code
 */
async function extractEnvVarChanges(
  repoPath: string,
  baseRef: string,
  headRef: string,
  changedFiles: string[]
): Promise<string[]> {
  const newEnvVars: Set<string> = new Set();

  // Check for .env.example changes
  const envFiles = changedFiles.filter(f =>
    f.includes(".env") || f.endsWith(".env.example")
  );

  // Fetch all env file diffs in parallel
  const envDiffResults = await Promise.all(
    envFiles.map(async (file) => {
      try {
        return await getFileDiff(repoPath, baseRef, headRef, file);
      } catch (err) {
        console.debug?.(`Env scan diff failed for ${file}: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    })
  );

  for (const diff of envDiffResults) {
    if (!diff) continue;
    const addedLines = diff
      .split("\n")
      .filter(line => line.startsWith("+") && !line.startsWith("+++"));

    for (const line of addedLines) {
      const match = line.match(/^\+([A-Z][A-Z0-9_]+)\s*=/);
      if (match) {
        newEnvVars.add(match[1]);
      }
    }
  }

  // Also scan code for new process.env references
  const codeFiles = changedFiles.filter(f =>
    /\.(ts|js|tsx|jsx)$/.test(f)
  );

  // Fetch all code file diffs in parallel
  const codeDiffResults = await Promise.all(
    codeFiles.slice(0, MAX_CODE_FILES_FOR_ENV_SCAN).map(async (file) => {
      try {
        return await getFileDiff(repoPath, baseRef, headRef, file);
      } catch (err) {
        console.debug?.(`Code env scan failed for ${file}: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    })
  );

  for (const diff of codeDiffResults) {
    if (!diff) continue;
    const addedLines = diff
      .split("\n")
      .filter(line => line.startsWith("+") && !line.startsWith("+++"));

    for (const line of addedLines) {
      const matches = line.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g);
      for (const match of matches) {
        newEnvVars.add(match[1]);
      }
    }
  }

  return Array.from(newEnvVars);
}

/**
 * Extract new npm scripts/commands from pre-read package.json objects.
 * Synchronous — no git calls needed when basePkg/headPkg are pre-read.
 * @param basePkg - Package.json at the base ref
 * @param headPkg - Package.json at the head ref
 * @returns Array of new command strings
 */
function extractCommandChanges(
  basePkg: Record<string, unknown>,
  headPkg: Record<string, unknown>
): string[] {
  const newCommands: string[] = [];

  try {
    const baseScripts = (basePkg.scripts as Record<string, string>) || {};
    const headScripts = (headPkg.scripts as Record<string, string>) || {};

    for (const name of Object.keys(headScripts)) {
      if (!baseScripts[name]) {
        newCommands.push(`npm run ${name}`);
      }
    }
  } catch (err) {
    console.debug?.(`Command extraction failed: ${err instanceof Error ? err.message : err}`);
  }

  return newCommands;
}

/**
 * Detect potential breaking changes.
 * Uses pre-read package.json for version checks, git only for export removal scan.
 * @param basePkg - Package.json at the base ref
 * @param headPkg - Package.json at the head ref
 * @param repoPath - Path to the git repository
 * @param baseRef - Base git ref
 * @param headRef - Head git ref
 * @param changedFiles - List of changed file paths
 * @returns Array of breaking change descriptions
 */
async function detectBreakingChanges(
  basePkg: Record<string, unknown>,
  headPkg: Record<string, unknown>,
  repoPath: string,
  baseRef: string,
  headRef: string,
  changedFiles: string[]
): Promise<string[]> {
  const breakingChanges: string[] = [];

  // Check for major version bumps (uses pre-read pkg data)
  try {
    const baseVersion = basePkg.version as string | undefined;
    const headVersion = headPkg.version as string | undefined;

    if (baseVersion && headVersion) {
      const [baseMajor] = baseVersion.split(".");
      const [headMajor] = headVersion.split(".");
      if (parseInt(headMajor) > parseInt(baseMajor)) {
        breakingChanges.push(`Major version bump: ${baseVersion} → ${headVersion}`);
      }
    }
  } catch (err) {
    console.debug?.(`Version comparison failed: ${err instanceof Error ? err.message : err}`);
  }

  // Check for removed exports in index files
  const indexFiles = changedFiles.filter(f =>
    /index\.(ts|js)$/.test(f) || /^src\/[^/]+\.(ts|js)$/.test(f)
  );

  for (const file of indexFiles.slice(0, MAX_INDEX_FILES_FOR_BREAKING_SCAN)) {
    try {
      const diff = await getFileDiff(repoPath, baseRef, headRef, file);

      const removedExports = diff
        .split("\n")
        .filter(line => line.startsWith("-") && !line.startsWith("---"))
        .filter(line => /export\s+(const|function|class|type|interface)/.test(line));

      for (const line of removedExports.slice(0, MAX_REMOVED_EXPORTS_PER_FILE)) {
        const match = line.match(/export\s+(?:const|function|class|type|interface)\s+(\w+)/);
        if (match) {
          breakingChanges.push(`Removed export: ${match[1]} in ${file}`);
        }
      }
    } catch (err) {
      console.debug?.(`Export removal check failed for ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return breakingChanges;
}

/**
 * Parse a PR target string into repo URL and PR number.
 * Supports: owner/repo#123, owner/repo/pull/123, https://github.com/owner/repo/pull/123
 */
export function parsePullRequestTarget(target: string): { repoUrl: string; prNumber: number } {
  const urlMatch = target.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (urlMatch) {
    return {
      repoUrl: `https://github.com/${urlMatch[1]}/${urlMatch[2].replace(/\.git$/, "")}`,
      prNumber: parseInt(urlMatch[3], 10),
    };
  }

  const shortMatch = target.match(/^([^/\s#]+)\/([^/\s#]+)#(\d+)$/);
  if (shortMatch) {
    return {
      repoUrl: `https://github.com/${shortMatch[1]}/${shortMatch[2].replace(/\.git$/, "")}`,
      prNumber: parseInt(shortMatch[3], 10),
    };
  }

  const pathMatch = target.match(/^([^/\s#]+)\/([^/\s#]+)\/pull\/(\d+)$/);
  if (pathMatch) {
    return {
      repoUrl: `https://github.com/${pathMatch[1]}/${pathMatch[2].replace(/\.git$/, "")}`,
      prNumber: parseInt(pathMatch[3], 10),
    };
  }

  throw new Error("Invalid PR reference. Use owner/repo#123 or https://github.com/owner/repo/pull/123");
}

interface PullRequestApiResponse {
  base?: { ref?: string; sha?: string };
  head?: { ref?: string; sha?: string };
  title?: string;
  html_url?: string;
}

export interface PullRequestRefs {
  baseRef: string;
  headRef: string;
  baseName: string;
  headName: string;
  title?: string;
  url?: string;
}

async function fetchPullRequestInfo(repoInfo: RepoInfo, prNumber: number): Promise<PullRequestApiResponse> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "repo-bootcamp",
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${repoInfo.fullName}/pulls/${prNumber}`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error (${response.status}): ${response.statusText}`);
  }

  return await response.json() as PullRequestApiResponse;
}

/**
 * Fetch GitHub PR base/head refs into the local repo.
 */
export async function fetchPullRequestRefs(
  repoPath: string,
  repoInfo: RepoInfo,
  prNumber: number
): Promise<PullRequestRefs> {
  const prInfo = await fetchPullRequestInfo(repoInfo, prNumber);
  const baseRefName = prInfo.base?.ref;
  const headRefName = prInfo.head?.ref;
  const baseSha = prInfo.base?.sha;

  if (!baseRefName || !headRefName || !baseSha) {
    throw new Error("GitHub API response missing pull request refs.");
  }

  if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    throw new Error("Invalid base SHA format.");
  }

  const baseRef = `pr-${prNumber}-base`;
  const headRef = `pr-${prNumber}-head`;

  const token = process.env.GITHUB_TOKEN;
  const fetchEnv = token
    ? { ...process.env, GIT_ASKPASS: "echo", GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_0: `Authorization: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` }
    : undefined;

  try {
    await execFileAsync("git", ["fetch", "--quiet", "origin", `${baseSha}:${baseRef}`], {
      cwd: repoPath,
      maxBuffer: FILE_DIFF_MAX_BUFFER,
      env: fetchEnv,
    });
  } catch (error: unknown) {
    throw new Error(`Failed to fetch PR base ref: ${(error as Error).message}`);
  }

  try {
    await execFileAsync("git", ["fetch", "--quiet", "origin", `pull/${prNumber}/head:${headRef}`], {
      cwd: repoPath,
      maxBuffer: FILE_DIFF_MAX_BUFFER,
      env: fetchEnv,
    });
  } catch (error: unknown) {
    throw new Error(`Failed to fetch PR head ref: ${(error as Error).message}`);
  }

  return {
    baseRef,
    headRef,
    baseName: baseRefName,
    headName: headRefName,
    title: prInfo.title,
    url: prInfo.html_url,
  };
}

/**
 * Analyze diff between two refs.
 * Reads package.json once at each ref and shares with all consumers.
 * @param repoPath - Path to the git repository
 * @param baseRef - Base git ref to compare from
 * @param headRef - Head git ref to compare to (default: "HEAD")
 * @returns Full diff summary with onboarding-relevant changes
 */
export async function analyzeDiff(
  repoPath: string,
  baseRef: string,
  headRef: string = "HEAD"
): Promise<DiffSummary> {
  // Get changed files
  const { added, removed, modified } = await getChangedFiles(repoPath, baseRef, headRef);
  const allChanged = [...added, ...modified];

  // Read package.json at both refs ONCE (shared by dep, command, and breaking change analysis)
  const [basePkg, headPkg] = await Promise.all([
    getPackageJsonAtRef(repoPath, baseRef),
    getPackageJsonAtRef(repoPath, headRef),
  ]);

  // Extract onboarding-relevant changes (using pre-read package.json)
  const depChanges = extractDependencyChanges(basePkg, headPkg);
  const newCommands = extractCommandChanges(basePkg, headPkg);
  const [newEnvVars, breakingChanges] = await Promise.all([
    extractEnvVarChanges(repoPath, baseRef, headRef, allChanged),
    detectBreakingChanges(basePkg, headPkg, repoPath, baseRef, headRef, allChanged),
  ]);

  return {
    baseRef,
    headRef,
    filesChanged: added.length + removed.length + modified.length,
    filesAdded: added,
    filesRemoved: removed,
    filesModified: modified,
    onboardingDeltas: {
      newDependencies: depChanges.added,
      removedDependencies: depChanges.removed,
      newEnvVars,
      newCommands,
      breakingChanges,
    },
  };
}

/**
 * Generate DIFF.md documentation
 */
export function generateDiffDocs(diff: DiffSummary, projectName: string): string {
  const lines: string[] = [];

  lines.push("# Change Summary");
  lines.push("");

  if (diff.prNumber) {
    const titlePart = diff.prTitle ? ` — ${diff.prTitle}` : "";
    const linkPart = diff.prUrl
      ? `[PR #${diff.prNumber}](${diff.prUrl})`
      : `PR #${diff.prNumber}`;
    lines.push(`${linkPart}${titlePart}`);
    lines.push("");
  }

  lines.push(`Comparison for **${projectName}**: \`${diff.baseRef}\` → \`${diff.headRef}\``);
  lines.push("");

  // Overview
  lines.push("## Overview");
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Files Changed | ${diff.filesChanged} |`);
  lines.push(`| Files Added | ${diff.filesAdded.length} |`);
  lines.push(`| Files Modified | ${diff.filesModified.length} |`);
  lines.push(`| Files Removed | ${diff.filesRemoved.length} |`);
  lines.push("");

  // Onboarding Impact
  lines.push("## Onboarding Impact");
  lines.push("");
  lines.push("Changes that affect new developer setup:");
  lines.push("");

  const deltas = diff.onboardingDeltas;
  let hasImpact = false;

  if (deltas.newDependencies.length > 0) {
    hasImpact = true;
    lines.push("### New Dependencies");
    lines.push("");
    lines.push("Run `npm install` to get these new packages:");
    lines.push("");
    for (const dep of deltas.newDependencies) {
      lines.push(`- \`${dep}\``);
    }
    lines.push("");
  }

  if (deltas.removedDependencies.length > 0) {
    hasImpact = true;
    lines.push("### Removed Dependencies");
    lines.push("");
    for (const dep of deltas.removedDependencies) {
      lines.push(`- \`${dep}\``);
    }
    lines.push("");
  }

  if (deltas.newEnvVars.length > 0) {
    hasImpact = true;
    lines.push("### New Environment Variables");
    lines.push("");
    lines.push("Add these to your `.env` file:");
    lines.push("");
    for (const envVar of deltas.newEnvVars) {
      lines.push(`- \`${envVar}\``);
    }
    lines.push("");
  }

  if (deltas.newCommands.length > 0) {
    hasImpact = true;
    lines.push("### New Commands");
    lines.push("");
    for (const cmd of deltas.newCommands) {
      lines.push(`- \`${cmd}\``);
    }
    lines.push("");
  }

  if (deltas.breakingChanges.length > 0) {
    hasImpact = true;
    lines.push("### ⚠️ Breaking Changes");
    lines.push("");
    for (const change of deltas.breakingChanges) {
      lines.push(`- ${change}`);
    }
    lines.push("");
  }

  if (!hasImpact) {
    lines.push("No significant onboarding changes detected.");
    lines.push("");
  }

  // File changes
  if (diff.filesAdded.length > 0) {
    lines.push("## Files Added");
    lines.push("");
    for (const file of diff.filesAdded.slice(0, MAX_DIFF_DOC_FILES)) {
      lines.push(`- \`${file}\``);
    }
    if (diff.filesAdded.length > MAX_DIFF_DOC_FILES) {
      lines.push(`- ... and ${diff.filesAdded.length - MAX_DIFF_DOC_FILES} more`);
    }
    lines.push("");
  }

  if (diff.filesRemoved.length > 0) {
    lines.push("## Files Removed");
    lines.push("");
    for (const file of diff.filesRemoved.slice(0, MAX_DIFF_DOC_FILES)) {
      lines.push(`- \`${file}\``);
    }
    if (diff.filesRemoved.length > MAX_DIFF_DOC_FILES) {
      lines.push(`- ... and ${diff.filesRemoved.length - MAX_DIFF_DOC_FILES} more`);
    }
    lines.push("");
  }

  if (diff.filesModified.length > 0) {
    lines.push("## Files Modified");
    lines.push("");
    for (const file of diff.filesModified.slice(0, MAX_DIFF_DOC_MODIFIED)) {
      lines.push(`- \`${file}\``);
    }
    if (diff.filesModified.length > MAX_DIFF_DOC_MODIFIED) {
      lines.push(`- ... and ${diff.filesModified.length - MAX_DIFF_DOC_MODIFIED} more`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
