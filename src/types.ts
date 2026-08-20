/**
 * Types for Repo Bootcamp Generator
 */

import type { OutputFormat } from "./formatter.js";

// CLI Options
/** CLI options for the bootcamp generator command. */
export interface BootcampOptions {
  branch: string;
  focus: "onboarding" | "architecture" | "contributing" | "all";
  audience: "all" | "backend" | "frontend" | "sre";
  output: string;
  maxFiles: number;
  /** When true, the main command expects a local repository path input instead of cloning. */
  noClone: boolean;
  verbose: boolean;
  /** When true, suppress decorative output (banner, phase overview, spinners, file tree) for scripting/CI. */
  quiet?: boolean;
  model?: string;
  keepTemp?: boolean;
  jsonOnly?: boolean;
  stats?: boolean;
  fast?: boolean;
  // New features
  interactive?: boolean;
  transcript?: boolean;
  compare?: string;
  createIssues?: boolean;
  dryRun?: boolean;
  format?: OutputFormat;
  renderDiagrams?: boolean;
  diagramFormat?: "svg" | "png" | "pdf";
  style?: "corporate" | "startup" | "oss" | "academic" | "minimal";
  web?: boolean;
  fullClone?: boolean;
  watch?: boolean;
  watchInterval?: number;
  watchForce?: boolean;
  noCache?: boolean;
  repoPrompts?: string;
  systemPrompt?: string;
  /** Extra glob patterns to drop from the file scan (in addition to the built-in ignores). */
  exclude?: string[];
  /** Restrict the scan to a sub-path of the repository (e.g. a single monorepo package). */
  subdir?: string;
  optionSource?: Partial<
    Record<"audience" | "focus" | "maxFiles" | "model" | "style", "cli" | "default">
  >;
}

/** Generic prompt payload used by LLM sessions. */
export interface LlmPrompt {
  prompt: string;
}

/** Generic session creation config used by injectable LLM clients. */
export interface LlmSessionConfig {
  streaming?: boolean;
  model?: string;
  systemMessage?: { content: string };
  tools?: unknown[];
}

/** Generic event shape emitted by LLM sessions. */
export interface LlmSessionEvent {
  type: string;
  data: {
    deltaContent?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Injectable LLM session interface used by analysis code. */
export interface LlmSession {
  on(handler: (event: LlmSessionEvent) => void): unknown;
  sendAndWait(input: LlmPrompt, timeoutMs?: number): Promise<unknown>;
}

/** Injectable LLM client interface used by analysis code. */
export interface LlmClient {
  createSession(config: LlmSessionConfig): Promise<LlmSession>;
  stop(): Promise<unknown>;
}

/** Optional dependency injection hooks for analyzeRepo. */
export interface AnalyzeRepoDependencies {
  client?: LlmClient;
  createClient?: () => LlmClient | Promise<LlmClient>;
}

export type RepoProvider = "github" | "gitlab" | "bitbucket";

// Template style pack
/** Available template style packs for output formatting. */
export type StylePack = "corporate" | "startup" | "oss" | "academic" | "minimal";

// Tech Radar signal
/** A single technology radar signal indicating adoption status. */
export interface RadarSignal {
  name: string;
  category: "modern" | "stable" | "legacy" | "risky";
  reason: string;
}

// Tech Radar result
/** Aggregated technology radar categorizing dependencies by adoption stage. */
export interface TechRadar {
  modern: RadarSignal[];
  stable: RadarSignal[];
  legacy: RadarSignal[];
  risky: RadarSignal[];
  onboardingRisk: {
    score: number; // 0-100, lower is better (less risky)
    grade: string; // A-F
    factors: string[];
  };
}

// Change impact result
/** Impact analysis result for a changed file, listing affected dependents. */
export interface ChangeImpact {
  file: string;
  affectedFiles: string[];
  affectedTests: string[];
  affectedDocs: string[];
  importedBy: string[];
  imports: string[];
}

// Diff summary
/** Summary of changes between two git refs with onboarding-relevant deltas. */
export interface DiffSummary {
  baseRef: string;
  headRef: string;
  filesChanged: number;
  filesAdded: string[];
  filesRemoved: string[];
  filesModified: string[];
  onboardingDeltas: {
    newDependencies: string[];
    removedDependencies: string[];
    newEnvVars: string[];
    newCommands: string[];
    breakingChanges: string[];
  };
  prNumber?: number;
  prTitle?: string;
  prUrl?: string;
}

// Interactive session message
/** A single message in an interactive Q&A session about the repository. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: string[];
  timestamp: Date;
}

// Interactive session transcript
/** Full transcript of an interactive session including all messages. */
export interface Transcript {
  repoName: string;
  startedAt: Date;
  messages: ChatMessage[];
}

// Parsed repo URL
/** Parsed repository URL information including owner, name, and branch. */
export interface RepoInfo {
  owner: string;
  repo: string;
  url: string;
  branch: string;
  fullName: string;
  provider?: RepoProvider;
  host?: string;
  commitSha?: string;
}

export type MonorepoManager = "lerna" | "nx" | "turborepo" | "pnpm" | "npm-workspaces";

export interface MonorepoWorkspace {
  name: string;
  path: string;
}

export interface MonorepoInfo {
  isMonorepo: boolean;
  managers: MonorepoManager[];
  workspaceGlobs: string[];
  workspacePackages: MonorepoWorkspace[];
}

// Stack detection results
/** Detected technology stack information for a repository. */
export interface StackInfo {
  languages: string[];
  frameworks: string[];
  buildSystem: string;
  packageManager: string | null;
  hasDocker: boolean;
  hasCi: boolean;
}

// Entrypoint detection
/** A detected application entrypoint with its type classification. */
export interface Entrypoint {
  path: string;
  type: "main" | "binary" | "server" | "cli" | "web" | "library";
  description?: string;
}

// Command discovery
/** A discovered runnable command from package.json scripts, Makefile, etc. */
export interface Command {
  name: string;
  command: string;
  source: string; // e.g., "package.json", "Makefile"
  description?: string;
}

// CI workflow info
/** Parsed CI/CD workflow information from GitHub Actions or similar. */
export interface CIWorkflow {
  name: string;
  file: string;
  triggers: string[];
  mainSteps: string[];
}

// Directory info
/** Information about a key directory in the repository structure. */
export interface DirectoryInfo {
  path: string;
  purpose: string;
  keyFiles?: string[];
}

// First task suggestion
/** A suggested first task for new contributors with difficulty rating. */
export interface FirstTask {
  title: string;
  description: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  category: "bug-fix" | "test" | "docs" | "refactor" | "feature";
  files: string[];
  why: string;
}

// The main repo facts structure (generated by LLM)
/** The main repository facts structure generated by LLM analysis. */
export interface RepoFacts {
  repoName: string;
  purpose: string;
  description: string;
  confidence?: "high" | "medium" | "low";
  sources?: string[];
  stack: StackInfo;
  quickstart: {
    prerequisites: string[];
    steps: string[];
    commands: Command[];
    commonErrors?: { error: string; fix: string }[];
    sources?: string[];
  };
  structure: {
    keyDirs: DirectoryInfo[];
    entrypoints: Entrypoint[];
    testDirs: string[];
    docsDirs: string[];
    sources?: string[];
  };
  ci: {
    workflows: CIWorkflow[];
    mainChecks: string[];
    sources?: string[];
  };
  contrib: {
    howToAddFeature: string[];
    howToAddTest: string[];
    codeStyle?: string;
    sources?: string[];
  };
  architecture: {
    overview: string;
    components: { name: string; description: string; directory: string }[];
    dataFlow?: string;
    keyAbstractions?: { name: string; description: string }[];
    codeExamples?: { title: string; file: string; code: string; explanation: string }[];
    sources?: string[];
  };
  firstTasks: FirstTask[];
  runbook?: {
    applicable?: boolean;
    deploySteps?: string[];
    observability?: string[];
    incidents?: { name: string; check: string }[];
    sources?: string[];
  };
}

// File info collected during scanning
/** File metadata collected during repository scanning. */
export interface FileInfo {
  path: string;
  size: number;
  isDirectory: boolean;
}

// Scan results
/** Complete scan results including files, stack info, and key contents. */
export interface ScanResult {
  files: FileInfo[];
  stack: StackInfo;
  monorepo?: MonorepoInfo | null;
  commands: Command[];
  ciWorkflows: CIWorkflow[];
  readme: string | null;
  contributing: string | null;
  keySourceFiles: Map<string, string>;
}
