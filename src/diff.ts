/**
 * Diff/Compare Mode Module
 * Compares two refs to generate onboarding deltas
 */

import { exec } from "child_process";
import { promisify } from "util";
import type { DiffSummary, RepoInfo } from "./types.js";

const execAsync = promisify(exec);

/**
 * Get list of changed files between two refs
 */
async function getChangedFiles(
  repoPath: string,
  baseRef: string,
  headRef: string
): Promise<{ added: string[]; removed: string[]; modified: string[] }> {
  try {
    const { stdout } = await execAsync(
      `git diff --name-status ${baseRef}...${headRef}`,
      { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
    );

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      const [status, ...pathParts] = line.split("\t");
      const path = pathParts.join("\t"); // Handle paths with tabs

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
    const { stdout } = await execAsync(
      `git diff ${baseRef}...${headRef} -- "${filePath}"`,
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 }
    );
    return stdout;
  } catch {
    return "";
  }
}

/**
 * Extract new dependencies from package.json diff
 */
async function extractDependencyChanges(
  repoPath: string,
  baseRef: string,
  headRef: string
): Promise<{ added: string[]; removed: string[] }> {
  const added: string[] = [];
  const removed: string[] = [];

  try {
    // Get package.json at both refs
    let basePkg: Record<string, unknown> = {};
    let headPkg: Record<string, unknown> = {};

    try {
      const { stdout: baseContent } = await execAsync(
        `git show ${baseRef}:package.json`,
        { cwd: repoPath }
      );
      basePkg = JSON.parse(baseContent);
    } catch {
      // No package.json at base
    }

    try {
      const { stdout: headContent } = await execAsync(
        `git show ${headRef}:package.json`,
        { cwd: repoPath }
      );
      headPkg = JSON.parse(headContent);
    } catch {
      // No package.json at head
    }

    const baseDeps = new Set([
      ...Object.keys(basePkg.dependencies || {}),
      ...Object.keys(basePkg.devDependencies || {}),
    ]);

    const headDeps = new Set([
      ...Object.keys(headPkg.dependencies || {}),
      ...Object.keys(headPkg.devDependencies || {}),
    ]);

    // Find added
    for (const dep of headDeps) {
      if (!baseDeps.has(dep)) {
        added.push(dep);
      }
    }

    // Find removed
    for (const dep of baseDeps) {
      if (!headDeps.has(dep)) {
        removed.push(dep);
      }
    }
  } catch {
    // Ignore errors
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

  for (const file of envFiles) {
    try {
      const diff = await getFileDiff(repoPath, baseRef, headRef, file);
      
      // Find added lines with env var definitions
      const addedLines = diff
        .split("\n")
        .filter(line => line.startsWith("+") && !line.startsWith("+++"));

      for (const line of addedLines) {
        const match = line.match(/^\+([A-Z][A-Z0-9_]+)\s*=/);
        if (match) {
          newEnvVars.add(match[1]);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Also scan code for new process.env references
  const codeFiles = changedFiles.filter(f => 
    /\.(ts|js|tsx|jsx)$/.test(f)
  );

  for (const file of codeFiles.slice(0, 20)) { // Limit to 20 files
    try {
      const diff = await getFileDiff(repoPath, baseRef, headRef, file);
      
      const addedLines = diff
        .split("\n")
        .filter(line => line.startsWith("+") && !line.startsWith("+++"));

      for (const line of addedLines) {
        const matches = line.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g);
        for (const match of matches) {
          newEnvVars.add(match[1]);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return Array.from(newEnvVars);
}

/**
 * Extract new npm scripts/commands
 */
async function extractCommandChanges(
  repoPath: string,
  baseRef: string,
  headRef: string
): Promise<string[]> {
  const newCommands: string[] = [];

  try {
    let baseScripts: Record<string, string> = {};
    let headScripts: Record<string, string> = {};

    try {
      const { stdout: baseContent } = await execAsync(
        `git show ${baseRef}:package.json`,
        { cwd: repoPath }
      );
      baseScripts = JSON.parse(baseContent).scripts || {};
    } catch {
      // No package.json at base
    }

    try {
      const { stdout: headContent } = await execAsync(
        `git show ${headRef}:package.json`,
        { cwd: repoPath }
      );
      headScripts = JSON.parse(headContent).scripts || {};
    } catch {
      // No package.json at head
    }

    for (const name of Object.keys(headScripts)) {
      if (!baseScripts[name]) {
        newCommands.push(`npm run ${name}`);
      }
    }
  } catch {
    // Ignore errors
  }

  return newCommands;
}

/**
 * Detect potential breaking changes
 */
async function detectBreakingChanges(
  repoPath: string,
  baseRef: string,
  headRef: string,
  changedFiles: string[]
): Promise<string[]> {
  const breakingChanges: string[] = [];

  // Check for major version bumps in package.json
  try {
    const { stdout: baseContent } = await execAsync(
      `git show ${baseRef}:package.json`,
      { cwd: repoPath }
    );
    const { stdout: headContent } = await execAsync(
      `git show ${headRef}:package.json`,
      { cwd: repoPath }
    );

    const basePkg = JSON.parse(baseContent);
    const headPkg = JSON.parse(headContent);

    if (basePkg.version && headPkg.version) {
      const [baseMajor] = basePkg.version.split(".");
      const [headMajor] = headPkg.version.split(".");
      if (parseInt(headMajor) > parseInt(baseMajor)) {
        breakingChanges.push(`Major version bump: ${basePkg.version} → ${headPkg.version}`);
      }
    }
  } catch {
    // Ignore
  }

  // Check for removed exports in index files
  const indexFiles = changedFiles.filter(f => 
    /index\.(ts|js)$/.test(f) || /^src\/[^/]+\.(ts|js)$/.test(f)
  );

  for (const file of indexFiles.slice(0, 5)) {
    try {
      const diff = await getFileDiff(repoPath, baseRef, headRef, file);
      
      const removedExports = diff
        .split("\n")
        .filter(line => line.startsWith("-") && !line.startsWith("---"))
        .filter(line => /export\s+(const|function|class|type|interface)/.test(line));

      for (const line of removedExports.slice(0, 3)) {
        const match = line.match(/export\s+(?:const|function|class|type|interface)\s+(\w+)/);
        if (match) {
          breakingChanges.push(`Removed export: ${match[1]} in ${file}`);
        }
      }
    } catch {
      // Ignore
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
  const response = await fetch(
    `https://api.github.com/repos/${repoInfo.fullName}/pulls/${prNumber}`,
    {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "repo-bootcamp",
      },
    }
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

  const baseRef = `pr-${prNumber}-base`;
  const headRef = `pr-${prNumber}-head`;

  try {
    await execAsync(`git fetch --quiet origin ${baseSha}:${baseRef}`, {
      cwd: repoPath,
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch (error: unknown) {
    throw new Error(`Failed to fetch PR base ref: ${(error as Error).message}`);
  }

  try {
    await execAsync(`git fetch --quiet origin pull/${prNumber}/head:${headRef}`, {
      cwd: repoPath,
      maxBuffer: 5 * 1024 * 1024,
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
 * Analyze diff between two refs
 */
export async function analyzeDiff(
  repoPath: string,
  baseRef: string,
  headRef: string = "HEAD"
): Promise<DiffSummary> {
  // Get changed files
  const { added, removed, modified } = await getChangedFiles(repoPath, baseRef, headRef);
  const allChanged = [...added, ...modified];

  // Extract onboarding-relevant changes
  const depChanges = await extractDependencyChanges(repoPath, baseRef, headRef);
  const newEnvVars = await extractEnvVarChanges(repoPath, baseRef, headRef, allChanged);
  const newCommands = await extractCommandChanges(repoPath, baseRef, headRef);
  const breakingChanges = await detectBreakingChanges(repoPath, baseRef, headRef, allChanged);

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
    for (const file of diff.filesAdded.slice(0, 30)) {
      lines.push(`- \`${file}\``);
    }
    if (diff.filesAdded.length > 30) {
      lines.push(`- ... and ${diff.filesAdded.length - 30} more`);
    }
    lines.push("");
  }

  if (diff.filesRemoved.length > 0) {
    lines.push("## Files Removed");
    lines.push("");
    for (const file of diff.filesRemoved.slice(0, 30)) {
      lines.push(`- \`${file}\``);
    }
    if (diff.filesRemoved.length > 30) {
      lines.push(`- ... and ${diff.filesRemoved.length - 30} more`);
    }
    lines.push("");
  }

  if (diff.filesModified.length > 0) {
    lines.push("## Files Modified");
    lines.push("");
    for (const file of diff.filesModified.slice(0, 50)) {
      lines.push(`- \`${file}\``);
    }
    if (diff.filesModified.length > 50) {
      lines.push(`- ... and ${diff.filesModified.length - 50} more`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
