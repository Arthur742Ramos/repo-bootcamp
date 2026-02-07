/**
 * Repo Ingestion Module
 * Handles cloning repos and scanning files
 */

import { exec, execFile } from "child_process";
import { promisify } from "util";
import { readdir, stat, readFile, rm } from "fs/promises";
import { join, basename } from "path";
import type { RepoInfo, FileInfo, StackInfo, Command, CIWorkflow, ScanResult } from "./types.js";
import frameworkMaps from "./data/framework-maps.json" with { type: "json" };

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Parse a GitHub URL into owner/repo components
 */
export function parseGitHubUrl(url: string): RepoInfo {
  // Handle various GitHub URL formats
  const patterns = [
    /github\.com\/([^/]+)\/([^/.]+)/,
    /github\.com:([^/]+)\/([^/.]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ""),
        url: `https://github.com/${match[1]}/${match[2].replace(/\.git$/, "")}`,
        branch: "main", // will be updated later
        fullName: `${match[1]}/${match[2].replace(/\.git$/, "")}`,
      };
    }
  }

  throw new Error(`Invalid GitHub URL: ${url}`);
}

/**
 * Clone a repository to a temporary directory
 */
export async function cloneRepo(
  repoInfo: RepoInfo,
  targetDir: string,
  branch?: string,
  fullClone?: boolean
): Promise<string> {
  const clonePath = join(targetDir, ".tmp", repoInfo.repo);
  const cloneArgs = ["clone"];
  if (!fullClone) {
    cloneArgs.push("--filter=blob:none", "--depth", "1");
  }
  if (branch) {
    cloneArgs.push("--branch", branch);
  }
  cloneArgs.push(`${repoInfo.url}.git`, clonePath);

  try {
    await rm(clonePath, { recursive: true, force: true });
    await execFileAsync("git", cloneArgs, { timeout: 120000 });

    // Get the actual branch name
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
      cwd: clonePath,
    });
    repoInfo.branch = stdout.trim();

    // Get the commit SHA for caching
    const { stdout: sha } = await execAsync("git rev-parse HEAD", {
      cwd: clonePath,
    });
    repoInfo.commitSha = sha.trim();

    return clonePath;
  } catch (error: unknown) {
    throw new Error(`Failed to clone repository: ${(error as Error).message}`);
  }
}

/**
 * Recursively scan directory for files
 */
async function scanDirectory(
  dir: string,
  basePath: string,
  maxFiles: number,
  files: FileInfo[] = []
): Promise<FileInfo[]> {
  if (files.length >= maxFiles) return files;

  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (files.length >= maxFiles) break;

    const fullPath = join(dir, entry.name);
    const relativePath = fullPath.replace(basePath + "/", "");

    // Skip common unimportant directories
    if (
      entry.isDirectory() &&
      [
        "node_modules",
        ".git",
        "dist",
        "build",
        "out",
        ".next",
        "__pycache__",
        ".venv",
        "venv",
        "vendor",
        ".idea",
        ".vscode",
        "coverage",
        ".nyc_output",
      ].includes(entry.name)
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push({ path: relativePath, size: 0, isDirectory: true });
      await scanDirectory(fullPath, basePath, maxFiles, files);
    } else {
      const stats = await stat(fullPath);
      files.push({
        path: relativePath,
        size: stats.size,
        isDirectory: false,
      });
    }
  }

  return files;
}

/**
 * Detect stack from file patterns
 */
function detectStack(files: FileInfo[]): StackInfo {
  const filePaths = files.map((f) => f.path);
  const fileNames = filePaths.map((p) => basename(p));

  const stack: StackInfo = {
    languages: [],
    frameworks: [],
    buildSystem: "",
    packageManager: null,
    hasDocker: false,
    hasCi: false,
  };

  // Language detection
  const langPatterns: Record<string, RegExp> = Object.fromEntries(
    Object.entries(frameworkMaps.langPatterns).map(([lang, pat]) => [lang, new RegExp(pat)])
  );

  for (const [lang, pattern] of Object.entries(langPatterns)) {
    if (filePaths.some((p) => pattern.test(p))) {
      stack.languages.push(lang);
    }
  }

  // Framework/build system detection from config files
  // NOTE: Frameworks like React, Express, Flask are NOT detected by file path patterns
  // as that causes false positives. They should be detected via dependency analysis (deps.ts).
  // Only config files that definitively indicate framework usage are listed here.
  const configPatterns: Record<string, { file: RegExp | string; type: "framework" | "build" | "pm" }> =
    Object.fromEntries(
      Object.entries(frameworkMaps.configPatterns).map(([name, entry]) => {
        const e = entry as { file: string; type: string; isRegex?: boolean };
        return [
          name,
          {
            file: e.isRegex ? new RegExp(e.file) : e.file,
            type: e.type as "framework" | "build" | "pm",
          },
        ];
      })
    );

  for (const [name, { file, type }] of Object.entries(configPatterns)) {
    const matches =
      typeof file === "string"
        ? fileNames.includes(file)
        : filePaths.some((p) => file.test(p));

    if (matches) {
      // Normalize framework names by removing variant suffixes like (mjs), (ts), etc.
      const normalizedName = name.replace(/\s*\([^)]+\)$/, "");
      if (type === "framework" && !stack.frameworks.includes(normalizedName)) {
        stack.frameworks.push(normalizedName);
      } else if (type === "build" && !stack.buildSystem) {
        stack.buildSystem = normalizedName;
      } else if (type === "pm" && !stack.packageManager) {
        stack.packageManager = normalizedName;
      }
    }
  }

  // Docker detection
  stack.hasDocker = fileNames.some(
    (f) => f === "Dockerfile" || f === "docker-compose.yml" || f === "docker-compose.yaml"
  );

  // CI detection
  stack.hasCi = filePaths.some(
    (p) => p.startsWith(".github/workflows/") || p === ".gitlab-ci.yml" || p.startsWith(".circleci/")
  );

  // Set build system based on package.json if not set
  if (!stack.buildSystem && fileNames.includes("package.json")) {
    stack.buildSystem = "npm";
  }

  return stack;
}

/**
 * Extract commands from package.json scripts
 */
async function extractPackageJsonCommands(repoPath: string): Promise<Command[]> {
  const commands: Command[] = [];

  try {
    const content = await readFile(join(repoPath, "package.json"), "utf-8");
    const pkg = JSON.parse(content);

    if (pkg.scripts) {
      for (const [name, cmd] of Object.entries(pkg.scripts)) {
        commands.push({
          name,
          command: `npm run ${name}`,
          source: "package.json",
          description: cmd as string,
        });
      }
    }
  } catch {
    // No package.json or parse error
  }

  return commands;
}

/**
 * Extract commands from Makefile
 */
async function extractMakefileCommands(repoPath: string): Promise<Command[]> {
  const commands: Command[] = [];

  try {
    const content = await readFile(join(repoPath, "Makefile"), "utf-8");
    const targetPattern = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/gm;
    let match;

    while ((match = targetPattern.exec(content)) !== null) {
      commands.push({
        name: match[1],
        command: `make ${match[1]}`,
        source: "Makefile",
      });
    }
  } catch {
    // No Makefile
  }

  return commands;
}

/**
 * Parse GitHub Actions workflows
 */
async function parseWorkflows(repoPath: string, files: FileInfo[]): Promise<CIWorkflow[]> {
  const workflows: CIWorkflow[] = [];
  const workflowFiles = files.filter((f) =>
    f.path.startsWith(".github/workflows/") && (f.path.endsWith(".yml") || f.path.endsWith(".yaml"))
  );

  for (const wf of workflowFiles) {
    try {
      const content = await readFile(join(repoPath, wf.path), "utf-8");

      // Simple YAML parsing for workflow name and triggers
      const nameMatch = content.match(/^name:\s*['"]?([^'"\n]+)/m);
      const onMatch = content.match(/^on:\s*\[?([^\]\n]+)/m);

      workflows.push({
        name: nameMatch ? nameMatch[1].trim() : basename(wf.path, ".yml"),
        file: wf.path,
        triggers: onMatch ? onMatch[1].split(",").map((t) => t.trim()) : [],
        mainSteps: [],
      });
    } catch {
      // Skip unparseable workflow
    }
  }

  return workflows;
}

/**
 * Read important documentation files
 */
async function readDocFile(repoPath: string, filename: string): Promise<string | null> {
  const possibleNames = [
    filename,
    filename.toLowerCase(),
    filename.toUpperCase(),
    `${filename}.md`,
    `${filename.toLowerCase()}.md`,
  ];

  for (const name of possibleNames) {
    try {
      return await readFile(join(repoPath, name), "utf-8");
    } catch {
      // Try next
    }
  }

  return null;
}

/**
 * File priority scoring for intelligent sampling
 */
interface FilePriority {
  path: string;
  score: number;
  category: "config" | "entry" | "source" | "test" | "docs" | "other";
}

/**
 * Score a file for priority-based sampling
 * Higher score = more important to read
 */
function scoreFile(filePath: string, size: number): FilePriority {
  const fileName = basename(filePath);
  const ext = filePath.split(".").pop() || "";
  let score = 0;
  let category: FilePriority["category"] = "other";

  // Config files (highest priority - small and information-dense)
  const configFiles = [
    "package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml",
    "go.mod", "build.gradle", "pom.xml", "Gemfile", "composer.json",
    ".eslintrc", ".prettierrc", "jest.config.js", "vitest.config.ts",
  ];
  if (configFiles.some(c => fileName === c || fileName.startsWith(c))) {
    score = 100;
    category = "config";
  }

  // Entry points (very high priority)
  const entryPatterns = [
    /^(src\/)?index\.(ts|js|tsx|jsx|py|go|rs)$/,
    /^(src\/)?main\.(ts|js|py|go|rs)$/,
    /^(src\/)?app\.(ts|js|tsx|jsx|py)$/,
    /^(src\/)?server\.(ts|js)$/,
    /^(src\/)?cli\.(ts|js)$/,
    /^(lib\/)?[^/]+\.(ts|js|py|go|rs)$/, // top-level lib files
    /^(source\/)?index\.(ts|js)$/,
  ];
  if (entryPatterns.some(p => p.test(filePath))) {
    score = Math.max(score, 90);
    category = "entry";
  }

  // Core source files (high priority)
  const corePatterns = [
    /^(src|lib|source)\/[^/]+\.(ts|js|py|go|rs)$/, // Top-level src
    /^(src|lib|source)\/core\/[^/]+\.(ts|js|py|go|rs)$/, // Core modules
    /^(src|lib|source)\/utils?\/[^/]+\.(ts|js|py|go|rs)$/, // Utils
  ];
  if (corePatterns.some(p => p.test(filePath)) && score < 80) {
    score = 80;
    category = "source";
  }

  // Type definitions (useful for understanding API)
  if (/types?\.(ts|d\.ts)$/.test(filePath) || filePath.includes("/types/")) {
    score = Math.max(score, 75);
    category = "source";
  }

  // Test files (medium priority - good for understanding behavior)
  if (/\.(test|spec)\.(ts|js|py)$/.test(filePath) || filePath.includes("__tests__")) {
    score = Math.max(score, 50);
    category = "test";
  }

  // CI/CD files
  if (filePath.startsWith(".github/workflows/") || filePath === ".gitlab-ci.yml") {
    score = Math.max(score, 60);
    category = "config";
  }

  // Docs
  if (/\.(md|rst|txt)$/.test(filePath) && !filePath.includes("node_modules")) {
    score = Math.max(score, 40);
    category = "docs";
  }

  // Regular source files
  if (score === 0 && /\.(ts|js|tsx|jsx|py|go|rs|java|cs|rb|php)$/.test(filePath)) {
    score = 30;
    category = "source";
  }

  // Penalize deeply nested files
  const depth = filePath.split("/").length;
  score -= Math.max(0, (depth - 3) * 5);

  // Penalize very large files (less likely to be useful for quick understanding)
  if (size > 20000) score -= 10;
  if (size > 50000) score -= 20;

  return { path: filePath, score: Math.max(0, score), category };
}

/**
 * Read key source files for context with intelligent byte budget
 */
async function readKeySourceFiles(
  repoPath: string,
  files: FileInfo[],
  maxBytes: number = 100000 // 100KB default budget
): Promise<Map<string, string>> {
  const sourceFiles = new Map<string, string>();
  let totalBytes = 0;

  // Score and sort all files
  const scoredFiles = files
    .filter((f) => !f.isDirectory && f.size < 100000 && f.size > 0)
    .map((f) => ({ ...f, ...scoreFile(f.path, f.size) }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score);

  // Read files in priority order until budget exhausted
  for (const file of scoredFiles) {
    if (totalBytes >= maxBytes) break;

    // Skip if adding this file would exceed budget by too much
    const remainingBudget = maxBytes - totalBytes;
    if (file.size > remainingBudget * 2 && totalBytes > maxBytes * 0.5) {
      continue; // Skip large files when we're past 50% budget
    }

    try {
      const content = await readFile(join(repoPath, file.path), "utf-8");
      // Truncate very long files
      const maxFileBytes = Math.min(file.size, 15000); // 15KB max per file
      const truncated = content.substring(0, maxFileBytes);
      
      sourceFiles.set(file.path, truncated);
      totalBytes += truncated.length;
    } catch {
      // Skip unreadable files
    }
  }

  return sourceFiles;
}

/**
 * Full scan of a cloned repository
 */
export async function scanRepo(repoPath: string, maxFiles: number): Promise<ScanResult> {
  // Scan files
  const files = await scanDirectory(repoPath, repoPath, maxFiles);

  // Detect stack
  const stack = detectStack(files);

  // Extract commands
  const pkgCommands = await extractPackageJsonCommands(repoPath);
  const makeCommands = await extractMakefileCommands(repoPath);
  const commands = [...pkgCommands, ...makeCommands];

  // Parse CI workflows
  const ciWorkflows = await parseWorkflows(repoPath, files);

  // Read docs
  const readme = await readDocFile(repoPath, "README");
  const contributing = await readDocFile(repoPath, "CONTRIBUTING");

  // Read key source files
  const keySourceFiles = await readKeySourceFiles(repoPath, files);

  return {
    files,
    stack,
    commands,
    ciWorkflows,
    readme,
    contributing,
    keySourceFiles,
  };
}

/**
 * Read a file from the cloned repo (for agent use)
 */
export async function readRepoFile(repoPath: string, filePath: string): Promise<string> {
  const fullPath = join(repoPath, filePath);
  return await readFile(fullPath, "utf-8");
}

/**
 * List files matching a glob pattern (simplified)
 */
export function listFilesByPattern(files: FileInfo[], pattern: string): string[] {
  // Simple glob matching
  const regexPattern = pattern
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\//g, "\\/");

  const regex = new RegExp(`^${regexPattern}$`);
  return files.filter((f) => !f.isDirectory && regex.test(f.path)).map((f) => f.path);
}

/**
 * Known frameworks that can be detected from dependencies
 * Maps dependency name to display name
 */
const DEPENDENCY_FRAMEWORKS: Record<string, string> = frameworkMaps.dependencyFrameworks;

/**
 * Detect frameworks from dependency list
 * This is more accurate than file path matching
 */
export function detectFrameworksFromDeps(depNames: string[]): string[] {
  const frameworks = new Set<string>();
  
  for (const dep of depNames) {
    const normalized = dep.toLowerCase();
    if (DEPENDENCY_FRAMEWORKS[normalized]) {
      frameworks.add(DEPENDENCY_FRAMEWORKS[normalized]);
    }
    // Also check the full dep name (for Go modules, etc.)
    if (DEPENDENCY_FRAMEWORKS[dep]) {
      frameworks.add(DEPENDENCY_FRAMEWORKS[dep]);
    }
  }
  
  return Array.from(frameworks);
}

/**
 * Merge frameworks detected from dependencies into stack info
 * Should be called after extractDependencies() in the main flow
 */
export function mergeFrameworksFromDeps(
  stack: StackInfo,
  depNames: string[]
): StackInfo {
  const depFrameworks = detectFrameworksFromDeps(depNames);
  const existingNormalized = new Set(
    stack.frameworks.map(f => f.toLowerCase())
  );
  
  for (const framework of depFrameworks) {
    if (!existingNormalized.has(framework.toLowerCase())) {
      stack.frameworks.push(framework);
    }
  }
  
  return stack;
}
