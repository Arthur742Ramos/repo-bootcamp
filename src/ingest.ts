/**
 * Repo Ingestion Module
 * Handles cloning repos and scanning files
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, rm } from "fs/promises";
import { join, basename, resolve, relative, isAbsolute, dirname } from "path";
import fg from "fast-glob";
import type {
  RepoInfo,
  FileInfo,
  StackInfo,
  Command,
  CIWorkflow,
  ScanResult,
  MonorepoInfo,
  MonorepoManager,
  RepoProvider,
} from "./types.js";
import { SKIP_DIRS, isPathInsideDir } from "./utils.js";
import frameworkMaps from "./data/framework-maps.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const REPO_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const SUPPORTED_REPOSITORY_HOSTS: Record<string, RepoProvider> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "bitbucket.org": "bitbucket",
};

function isSafeBranchName(branch: string): boolean {
  return (
    /^[A-Za-z0-9._/-]+$/.test(branch) &&
    !branch.startsWith("-") &&
    !branch.includes("..") &&
    !branch.includes("@{") &&
    !branch.endsWith(".lock") &&
    !branch.includes("\\")
  );
}

function parseSegmentsForOwnerRepo(host: string, allSegments: string[]): { owner: string; repo: string } {
  let segments = allSegments;

  if (host === "gitlab.com") {
    const markerIndex = segments.findIndex((segment, index) =>
      index >= 2 && (segment === "-" || segment === "tree" || segment === "blob")
    );
    if (markerIndex > 0) {
      segments = segments.slice(0, markerIndex);
    }
  } else {
    segments = segments.slice(0, 2);
  }

  if (segments.length < 2) {
    throw new Error("Repository URL must include owner and repository name");
  }

  const ownerSegments = segments.slice(0, -1).map((segment) => decodeURIComponent(segment.trim()));
  const repoSegment = decodeURIComponent(segments[segments.length - 1].trim()).replace(/\.git$/, "");

  if (!repoSegment) {
    throw new Error("Repository name is missing");
  }

  for (const segment of [...ownerSegments, repoSegment]) {
    if (!segment || segment === "." || segment === ".." || !REPO_SEGMENT_PATTERN.test(segment)) {
      throw new Error(`Invalid repository segment: ${segment || "(empty)"}`);
    }
  }

  return {
    owner: ownerSegments.join("/"),
    repo: repoSegment,
  };
}

function parseSshRepositoryUrl(url: string): { host: string; pathSegments: string[] } | null {
  const sshMatch = url.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/]([^?#]+?)(?:\.git)?\/?$/i);
  if (!sshMatch) {
    return null;
  }

  const host = sshMatch[1].toLowerCase();
  const pathSegments = sshMatch[2]
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  return { host, pathSegments };
}

/**
 * Parse a repository URL (GitHub, GitLab, or Bitbucket) into owner/repo components
 */
export function parseGitHubUrl(url: string): RepoInfo {
  const trimmedUrl = url?.trim();
  if (!trimmedUrl || /[\r\n\t]/.test(trimmedUrl)) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }

  try {
    const sshParsed = parseSshRepositoryUrl(trimmedUrl);
    if (sshParsed) {
      const provider = SUPPORTED_REPOSITORY_HOSTS[sshParsed.host];
      if (!provider) {
        throw new Error(`Unsupported repository host: ${sshParsed.host}`);
      }
      const { owner, repo } = parseSegmentsForOwnerRepo(sshParsed.host, sshParsed.pathSegments);
      return {
        owner,
        repo,
        url: `https://${sshParsed.host}/${owner}/${repo}`,
        branch: "main",
        fullName: `${owner}/${repo}`,
        provider,
        host: sshParsed.host,
      };
    }

    const normalizedUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmedUrl)
      ? trimmedUrl
      : `https://${trimmedUrl}`;
    const parsed = new URL(normalizedUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
    }
    const host = parsed.hostname.toLowerCase();
    const provider = SUPPORTED_REPOSITORY_HOSTS[host];
    if (!provider) {
      throw new Error(`Unsupported repository host: ${host}`);
    }

    const pathSegments = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    const { owner, repo } = parseSegmentsForOwnerRepo(host, pathSegments);

    return {
      owner,
      repo,
      url: `https://${host}/${owner}/${repo}`,
      branch: "main", // will be updated later
      fullName: `${owner}/${repo}`,
      provider,
      host,
    };
  } catch (error: unknown) {
    throw new Error(`Invalid GitHub URL: ${url}`, { cause: error });
  }
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
  if (!repoInfo?.url || typeof repoInfo.url !== "string") {
    throw new Error("Invalid repository URL");
  }
  if (repoInfo.url.startsWith("-") || /[\r\n\t]/.test(repoInfo.url)) {
    throw new Error("Unsafe repository URL");
  }
  if (!/^(https?:\/\/|file:\/\/)/i.test(repoInfo.url)) {
    throw new Error("Unsupported repository URL protocol");
  }
  if (branch && !isSafeBranchName(branch)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }

  const tempRoot = resolve(targetDir, ".tmp");
  const safeOwner = repoInfo.owner.replace(/[^A-Za-z0-9._/-]/g, "_").replaceAll("/", "__");
  const safeRepo = repoInfo.repo.replace(/[^A-Za-z0-9._-]/g, "_");
  const clonePath = resolve(tempRoot, `${safeOwner}__${safeRepo}`);
  if (!isPathInsideDir(tempRoot, clonePath)) {
    throw new Error("Unsafe clone path");
  }

  const cloneUrl = repoInfo.url.endsWith(".git") ? repoInfo.url : `${repoInfo.url}.git`;
  const cloneArgs = ["clone"];
  if (!fullClone) {
    cloneArgs.push("--filter=blob:none", "--depth", "1");
  }
  if (branch) {
    cloneArgs.push("--branch", branch);
  }
  cloneArgs.push("--", cloneUrl, clonePath);

  /** Timeout for git clone operations (2 minutes) */
  const CLONE_TIMEOUT_MS = 120_000;

  const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  };

  const getCloneErrorMessage = (error: unknown): string => {
    if (!(error instanceof Error)) {
      return "Failed to clone repository: Unknown clone error";
    }
    const execError = error as Error & {
      code?: number | string;
      signal?: NodeJS.Signals | null;
      killed?: boolean;
      stderr?: string;
      name?: string;
    };
    const code = typeof execError.code === "string" ? execError.code.toUpperCase() : execError.code;
    const isTimeout =
      (execError.killed && /timed out/i.test(error.message)) ||
      (typeof code === "string" &&
        (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || code === "ERR_TIMEOUT")) ||
      execError.name === "AbortError" ||
      /timeout|timed out/i.test(error.message);
    if (isTimeout) {
      return `Failed to clone repository: git clone timed out after ${CLONE_TIMEOUT_MS / 1000}s`;
    }
    const stderr = typeof execError.stderr === "string"
      ? execError.stderr.trim().split(/\r?\n/, 1)[0]
      : "";
    if (execError.code !== undefined) {
      const signalSuffix = execError.signal ? ` (signal: ${execError.signal})` : "";
      const stderrSuffix = stderr ? `: ${stderr}` : "";
      return `Failed to clone repository: git clone exited with code ${String(execError.code)}${signalSuffix}${stderrSuffix}`;
    }
    return `Failed to clone repository: ${error.message}`;
  };

  await rm(clonePath, { recursive: true, force: true });

  try {
    await execFileAsync("git", cloneArgs, { timeout: CLONE_TIMEOUT_MS });
  } catch (error: unknown) {
    throw new Error(getCloneErrorMessage(error), { cause: error });
  }

  try {
    // Get the actual branch name
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: clonePath,
    });
    repoInfo.branch = stdout.trim();

    // Get the commit SHA for caching
    const { stdout: sha } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: clonePath,
    });
    repoInfo.commitSha = sha.trim();

    return clonePath;
  } catch (error: unknown) {
    throw new Error(`Failed to read cloned repository metadata: ${getErrorMessage(error)}`, { cause: error });
  }
}

/**
 * Scan directory tree using fast-glob
 */
async function scanDirectory(basePath: string, maxFiles: number): Promise<FileInfo[]> {
  const ignorePatterns = Array.from(SKIP_DIRS).flatMap((dir) => [`**/${dir}`, `**/${dir}/**`]);
  const entries = await fg("**/*", {
    cwd: basePath,
    onlyFiles: false,
    stats: true,
    dot: true,
    unique: true,
    objectMode: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: ignorePatterns,
  });

  const files: FileInfo[] = [];
  for (const entry of entries) {
    if (files.length >= maxFiles) break;
    const isDirectory = entry.dirent?.isDirectory() ?? false;
    files.push({
      path: entry.path,
      size: isDirectory ? 0 : entry.stats?.size ?? 0,
      isDirectory,
    });
  }

  return files;
}

/**
 * Detect stack from file patterns
 */
function detectStack(files: FileInfo[]): StackInfo {
  const filePaths = files.map((f) => f.path);
  const fileNames = filePaths.map((p) => basename(p));
  const fileNameSet = new Set(fileNames);

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
        ? fileNameSet.has(file)
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
  stack.hasDocker = fileNameSet.has("Dockerfile") || fileNameSet.has("docker-compose.yml") || fileNameSet.has("docker-compose.yaml");

  // CI detection
  stack.hasCi = filePaths.some(
    (p) => p.startsWith(".github/workflows/") || p === ".gitlab-ci.yml" || p.startsWith(".circleci/")
  );

  // Set build system based on package.json if not set
  if (!stack.buildSystem && fileNameSet.has("package.json")) {
    stack.buildSystem = "npm";
  }

  // Infer package manager from package.json if not detected from lock files
  if (!stack.packageManager && fileNameSet.has("package.json")) {
    stack.packageManager = "npm";
  }
  if (!stack.packageManager && fileNameSet.has("pyproject.toml")) {
    stack.packageManager = "pip";
  }
  if (!stack.packageManager && fileNameSet.has("Cargo.toml")) {
    stack.packageManager = "cargo";
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
  } catch (err: unknown) {
    // No package.json or parse error
    if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
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
  } catch (err: unknown) {
    // No Makefile
    if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
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
    } catch (err: unknown) {
      // Skip unparseable workflow
      if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
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
    } catch (err: unknown) {
      // Try next
      if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
    }
  }

  return null;
}

function extractWorkspaceGlobsFromPackageJson(pkg: unknown): string[] {
  if (!pkg || typeof pkg !== "object") {
    return [];
  }
  const candidate = (pkg as Record<string, unknown>).workspaces;
  if (!candidate) {
    return [];
  }
  if (Array.isArray(candidate)) {
    return candidate.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  if (typeof candidate === "object" && candidate !== null) {
    const packages = (candidate as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      return packages.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    }
  }
  return [];
}

function extractWorkspaceGlobsFromPnpmWorkspaceYaml(content: string): string[] {
  const patterns: string[] = [];
  const lines = content.split("\n");
  let inPackagesSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed === "packages:") {
      inPackagesSection = true;
      continue;
    }
    if (!inPackagesSection) {
      continue;
    }
    const match = trimmed.match(/^-\s*['"]?([^'"]+)['"]?$/);
    if (!match) {
      if (/^[a-zA-Z]/.test(trimmed)) {
        break;
      }
      continue;
    }
    if (match[1].trim().length > 0) {
      patterns.push(match[1].trim());
    }
  }

  return patterns;
}

function normalizeWorkspacePattern(pattern: string): string {
  return pattern.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

async function detectMonorepo(repoPath: string, files: FileInfo[]): Promise<MonorepoInfo | null> {
  const filePaths = new Set(files.filter((file) => !file.isDirectory).map((file) => file.path));
  const managers = new Set<MonorepoManager>();
  const workspaceGlobSet = new Set<string>();

  if (filePaths.has("lerna.json")) managers.add("lerna");
  if (filePaths.has("nx.json")) managers.add("nx");
  if (filePaths.has("turbo.json")) managers.add("turborepo");
  if (filePaths.has("pnpm-workspace.yaml") || filePaths.has("pnpm-workspace.yml")) managers.add("pnpm");

  if (filePaths.has("package.json")) {
    try {
      const rootPackageJson = JSON.parse(await readFile(join(repoPath, "package.json"), "utf-8"));
      for (const workspacePattern of extractWorkspaceGlobsFromPackageJson(rootPackageJson)) {
        workspaceGlobSet.add(normalizeWorkspacePattern(workspacePattern));
      }
      if (workspaceGlobSet.size > 0) {
        managers.add("npm-workspaces");
      }
    } catch (err: unknown) {
      if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
    }
  }

  for (const pnpmFile of ["pnpm-workspace.yaml", "pnpm-workspace.yml"]) {
    if (!filePaths.has(pnpmFile)) {
      continue;
    }
    try {
      const pnpmWorkspace = await readFile(join(repoPath, pnpmFile), "utf-8");
      for (const workspacePattern of extractWorkspaceGlobsFromPnpmWorkspaceYaml(pnpmWorkspace)) {
        workspaceGlobSet.add(normalizeWorkspacePattern(workspacePattern));
      }
    } catch (err: unknown) {
      if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
    }
  }

  if (managers.size === 0 && workspaceGlobSet.size === 0) {
    return null;
  }

  const workspaceGlobs = Array.from(workspaceGlobSet);
  const effectiveWorkspaceGlobs = workspaceGlobs.length > 0
    ? workspaceGlobs
    : ["packages/*", "apps/*"];

  const workspacePackagePaths = new Set<string>();
  for (const workspaceGlob of effectiveWorkspaceGlobs) {
    const packagePattern = `${workspaceGlob}/package.json`;
    for (const matchedPath of listFilesByPattern(files, packagePattern)) {
      workspacePackagePaths.add(matchedPath);
    }
  }

  const workspacePackages: MonorepoInfo["workspacePackages"] = [];
  for (const packagePath of Array.from(workspacePackagePaths).sort()) {
    try {
      const pkg = JSON.parse(await readFile(join(repoPath, packagePath), "utf-8")) as { name?: string };
      workspacePackages.push({
        name: typeof pkg.name === "string" && pkg.name.trim() ? pkg.name : basename(dirname(packagePath)),
        path: dirname(packagePath),
      });
    } catch {
      workspacePackages.push({
        name: basename(dirname(packagePath)),
        path: dirname(packagePath),
      });
    }
  }

  return {
    isMonorepo: true,
    managers: Array.from(managers),
    workspaceGlobs: effectiveWorkspaceGlobs,
    workspacePackages,
  };
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
  maxBytes: number = 100_000 // 100KB default budget
): Promise<Map<string, string>> {
  /** Maximum bytes from a single file to prevent one large file from dominating */
  const MAX_BYTES_PER_FILE = 15_000;
  const sourceFiles = new Map<string, string>();
  let totalBytes = 0;

  // Score and sort all files
  const scoredFiles = files
    .filter((f) => !f.isDirectory && f.size < 100000 && f.size > 0)
    .map((f) => ({ ...f, ...scoreFile(f.path, f.size) }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score);

  // Read files in parallel with concurrency limiter, then assemble in priority order
  const CONCURRENCY = 8;
  const readResults: { path: string; content: string | null; size: number }[] = [];

  for (let i = 0; i < scoredFiles.length; i += CONCURRENCY) {
    const batch = scoredFiles.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        try {
          const raw = await readFile(join(repoPath, file.path), "utf-8");
          const maxFileBytes = Math.min(file.size, MAX_BYTES_PER_FILE);
          const truncated = raw.substring(0, maxFileBytes);
          return { path: file.path, content: truncated, size: truncated.length };
        } catch (err: unknown) {
          if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
          return { path: file.path, content: null, size: 0 };
        }
      })
    );
    readResults.push(...batchResults);
  }

  // Assemble in priority order until budget exhausted
  for (const result of readResults) {
    if (totalBytes >= maxBytes) break;
    if (!result.content) continue;

    const remainingBudget = maxBytes - totalBytes;
    if (result.size > remainingBudget * 2 && totalBytes > maxBytes * 0.5) {
      continue;
    }

    sourceFiles.set(result.path, result.content);
    totalBytes += result.size;
  }

  return sourceFiles;
}

/**
 * Full scan of a cloned repository
 */
export async function scanRepo(repoPath: string, maxFiles: number): Promise<ScanResult> {
  // Scan files
  const files = await scanDirectory(repoPath, maxFiles);

  // Detect stack
  const stack = detectStack(files);
  const monorepo = await detectMonorepo(repoPath, files);

  // Extract commands
  const pkgCommands = await extractPackageJsonCommands(repoPath);
  const makeCommands = await extractMakefileCommands(repoPath);
  const commands = [...pkgCommands, ...makeCommands];

  // Parse CI workflows
  const ciWorkflows = await parseWorkflows(repoPath, files);

  // Read docs in parallel
  const [readme, contributing] = await Promise.all([
    readDocFile(repoPath, "README"),
    readDocFile(repoPath, "CONTRIBUTING"),
  ]);

  // Read key source files
  const keySourceFiles = await readKeySourceFiles(repoPath, files);

  return {
    files,
    stack,
    monorepo,
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
  // Prevent path traversal attacks
  const resolvedRepo = resolve(repoPath);
  const fullPath = resolve(resolvedRepo, filePath);
  const rel = relative(resolvedRepo, fullPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path escapes repository root");
  }
  return await readFile(fullPath, "utf-8");
}

/**
 * List files matching a glob pattern (simplified)
 */
export function listFilesByPattern(files: FileInfo[], pattern: string): string[] {
  // Escape regex special chars, then convert glob syntax
  const DOUBLE_STAR_TOKEN = "__DOUBLE_STAR__";
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, DOUBLE_STAR_TOKEN)
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(new RegExp(DOUBLE_STAR_TOKEN, "g"), ".*");

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
