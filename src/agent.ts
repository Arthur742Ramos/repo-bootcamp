/**
 * Copilot SDK Agent for Repo Analysis
 * Uses GitHub Copilot SDK with agentic tool-calling to analyze repositories
 */

import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import type {
  AnalyzeRepoDependencies,
  BootcampOptions,
  LlmClient,
  LlmSession,
  LlmSessionEvent,
  RepoFacts,
  RepoInfo,
  ScanResult,
} from "./types.js";
import { getStyleConfig, type StyleConfig } from "./plugins.js";
import { getRepoTools } from "./tools.js";
import { validateRepoFacts, getMissingFieldsSummary, type ValidatedRepoFacts } from "./schema.js";

/**
 * System prompt for the repo analysis agent
 */
const CUSTOM_PROMPT_FILE = ".bootcamp-prompts.md";
const CUSTOM_PROMPT_MAX_CHARS = 8000;
const MAX_FILE_LIST_ITEMS = 50;
const MAX_FAST_FILE_LIST_ITEMS = 30;
const DEFAULT_MAX_KEY_FILE_CHARS = 5000;
const DEFAULT_MAX_ENTRY_POINT_CHARS = 3000;
const STREAM_PROGRESS_INTERVAL_MS = 250;
const STREAM_PROGRESS_BATCH_CHARS = 180;
const STREAM_PROGRESS_PREVIEW_CHARS = 140;
const FAST_MODE_TIMEOUT_MS = 300_000; // 5 minutes
const STANDARD_MODE_TIMEOUT_MS = 600_000; // 10 minutes
const TIMEOUT_ERROR_CODES = new Set(["ETIMEDOUT", "ESOCKETTIMEDOUT", "ERR_TIMEOUT", "ABORT_ERR"]);
const TIMEOUT_ERROR_PATTERNS = ["timeout", "timed out", "deadline exceeded", "request timed out"];
export const TEST_LLM_RESPONSE_FILE_ENV = "REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE";

interface PromptCharBudget {
  maxKeyFileChars: number;
  maxEntryPointChars: number;
}

interface ResponseStreamHandler {
  onDelta: (delta: string) => void;
  onFallbackMessage: (content: string) => void;
  flushProgress: () => void;
}

function getModelContextWindow(model?: string): number {
  if (!model) return 128_000;
  const normalized = model.toLowerCase();
  if (normalized.includes("1m")) return 1_000_000;
  if (
    normalized.includes("claude-opus") ||
    normalized.includes("claude-sonnet") ||
    normalized.includes("claude-haiku")
  ) {
    return 200_000;
  }
  if (
    normalized.includes("gpt-5") ||
    normalized.includes("gpt-4") ||
    normalized.includes("gpt-4o") ||
    normalized.includes("o1") ||
    normalized.includes("o3")
  ) {
    return 128_000;
  }
  return 64_000;
}

function getPromptCharBudget(model?: string): PromptCharBudget {
  const contextWindow = getModelContextWindow(model);
  if (contextWindow >= 1_000_000) {
    return { maxKeyFileChars: 12_000, maxEntryPointChars: 7_000 };
  }
  if (contextWindow >= 200_000) {
    return { maxKeyFileChars: 8_000, maxEntryPointChars: 4_500 };
  }
  if (contextWindow >= 128_000) {
    return {
      maxKeyFileChars: DEFAULT_MAX_KEY_FILE_CHARS,
      maxEntryPointChars: DEFAULT_MAX_ENTRY_POINT_CHARS,
    };
  }
  return { maxKeyFileChars: 3_500, maxEntryPointChars: 2_500 };
}

function createResponseStreamHandler(
  verbose: boolean,
  onProgress?: (message: string) => void
): ResponseStreamHandler {
  let progressBuffer = "";
  let lastProgressAt = 0;

  const emitProgress = (force = false): void => {
    if (!onProgress || progressBuffer.length === 0) return;

    const now = Date.now();
    if (
      !force &&
      now - lastProgressAt < STREAM_PROGRESS_INTERVAL_MS &&
      progressBuffer.length < STREAM_PROGRESS_BATCH_CHARS
    ) {
      return;
    }

    const compact = progressBuffer.replace(/\s+/g, " ").trim();
    progressBuffer = "";
    if (!compact) return;

    const preview =
      compact.length > STREAM_PROGRESS_PREVIEW_CHARS
        ? compact.slice(-STREAM_PROGRESS_PREVIEW_CHARS)
        : compact;
    onProgress(`LLM: ${preview}`);
    lastProgressAt = now;
  };

  return {
    onDelta: (delta: string) => {
      if (!delta) return;
      if (verbose) {
        process.stdout.write(delta);
        return;
      }
      if (onProgress) {
        progressBuffer += delta;
        emitProgress();
      }
    },
    onFallbackMessage: (content: string) => {
      if (!content) return;
      if (verbose) {
        process.stdout.write(content);
        return;
      }
      if (onProgress) {
        progressBuffer += content;
        emitProgress(true);
      }
    },
    flushProgress: () => {
      emitProgress(true);
    },
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isTimeoutError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  if (TIMEOUT_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) {
    return true;
  }

  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return typeof code === "string" && TIMEOUT_ERROR_CODES.has(code.toUpperCase());
  }

  if (error && typeof error === "object") {
    const maybeError = error as { code?: unknown; name?: unknown };
    if (
      typeof maybeError.code === "string" &&
      TIMEOUT_ERROR_CODES.has(maybeError.code.toUpperCase())
    ) {
      return true;
    }
    return typeof maybeError.name === "string" && maybeError.name.toLowerCase() === "aborterror";
  }

  return false;
}

async function sendAndWaitWithTimeoutBoundary(
  session: LlmSession,
  prompt: string,
  timeoutMs: number,
  operation: string
): Promise<void> {
  try {
    await session.sendAndWait({ prompt }, timeoutMs);
  } catch (error: unknown) {
    if (isTimeoutError(error)) {
      throw new Error(`${operation} timed out after ${Math.round(timeoutMs / 1000)}s`, {
        cause: error,
      });
    }
    throw error;
  }
}

function getSectionDepthGuidance(depth: StyleConfig["sectionDepth"]): string {
  const guidance: Record<StyleConfig["sectionDepth"], string> = {
    minimal: "Keep sections concise, with only high-signal details.",
    standard: "Use balanced detail with practical examples and quick context.",
    deep: "Provide deeper context, rationale, and implementation details where useful.",
  };
  return guidance[depth];
}

function styleSectionLists(styleConfig: StyleConfig): { enabled: string[]; disabled: string[] } {
  const sectionNames = [
    { enabled: styleConfig.sections.showRunbook, name: "runbook" },
    { enabled: styleConfig.sections.showSecurityDetails, name: "security analysis" },
    { enabled: styleConfig.sections.showDependencyGraph, name: "dependency graph" },
    { enabled: styleConfig.sections.showRadar, name: "technology radar" },
    { enabled: styleConfig.sections.showImpact, name: "change impact" },
  ];

  return {
    enabled: sectionNames.filter((s) => s.enabled).map((s) => s.name),
    disabled: sectionNames.filter((s) => !s.enabled).map((s) => s.name),
  };
}

function buildSystemPrompt(styleConfig: StyleConfig, fastMode = false): string {
  const { enabled, disabled } = styleSectionLists(styleConfig);
  const toolSection = fastMode
    ? ""
    : `

You have access to tools to explore the repository:
- read_file: Read contents of any file
- list_files: List files and directories
- search: Search for patterns in code using ripgrep
- get_repo_metadata: Get repository statistics

EFFICIENCY GUIDELINES:
1. Make ONE batch of tool calls to gather key info (README, package.json, entry point, one source file)
2. Make at most 2-3 additional targeted tool calls if needed
3. Then IMMEDIATELY produce your JSON output
4. DO NOT exhaustively read every file - sample intelligently`;

  return `You are an expert software architect and technical writer. Your job is to analyze codebases and produce comprehensive onboarding documentation.

STYLE PACK (${styleConfig.name}):
- Write in a ${styleConfig.tone} tone.
- ${getSectionDepthGuidance(styleConfig.sectionDepth)}
- Target exactly ${styleConfig.firstTasksCount} firstTasks.
- Prefer sections: ${enabled.length > 0 ? enabled.join(", ") : "core onboarding essentials only"}.
${disabled.length > 0 ? `- Avoid over-emphasizing: ${disabled.join(", ")}.` : ""}
${toolSection}

IMPORTANT:
- ${fastMode ? "No tools are available in this mode; rely on provided context only." : "Limit yourself to 10-15 total tool calls maximum."}
- Prioritize: README > package.json/config > main entry point > 1-2 source files
- After gathering basics, produce output - don't over-research
- Always return valid JSON as the final output`;
}

function formatStylePromptSection(styleConfig: StyleConfig): string {
  const { enabled, disabled } = styleSectionLists(styleConfig);
  return `## Style Pack Requirements (${styleConfig.name})
- Tone: ${styleConfig.tone}
- Section depth: ${styleConfig.sectionDepth}
- Intro direction: ${styleConfig.introText}
- First tasks target: exactly ${styleConfig.firstTasksCount}
- Prioritize sections: ${enabled.length > 0 ? enabled.join(", ") : "core onboarding essentials only"}
${disabled.length > 0 ? `- Keep these lightweight or omitted when not useful: ${disabled.join(", ")}` : ""}`;
}

export function readCustomPrompt(repoPath: string, overridePath?: string): string | null {
  const promptPath = overridePath
    ? path.resolve(overridePath)
    : path.join(repoPath, CUSTOM_PROMPT_FILE);
  if (!fs.existsSync(promptPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(promptPath, "utf-8").trim();
    if (!content) {
      return null;
    }
    return content.substring(0, CUSTOM_PROMPT_MAX_CHARS);
  } catch (err: unknown) {
    // Log and return null on failure
    if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
    return null;
  }
}

export function formatCustomPromptSection(customPrompt?: string | null): string {
  if (!customPrompt) {
    return "";
  }
  return `\n## Repository Guidance (.bootcamp-prompts.md)\n${customPrompt}\n`;
}

function getAudiencePromptGuidance(audience: BootcampOptions["audience"]): string {
  const guidance: Record<BootcampOptions["audience"], string> = {
    all: `## Audience Guidance (general)
- Cover the full codebase without bias toward any particular role.
- In firstTasks, include a mix of categories accessible to various skill levels.
- In architecture, focus on the overall system design and key abstractions.`,
    backend: `## Audience Guidance (backend)
- Prioritize API, service, worker, database, and backend config files.
- In firstTasks, emphasize endpoint behavior, data validation/persistence, and integration tests.
- In architecture, focus on request/data flows, service boundaries, and backend reliability concerns.`,
    frontend: `## Audience Guidance (frontend)
- Prioritize UI/component, routing, state management, styling, and frontend build files.
- In firstTasks, emphasize component improvements, UI bugs, accessibility, and frontend tests.
- In architecture, focus on UI composition, client-side data flow, and rendering boundaries.`,
    sre: `## Audience Guidance (sre)
- Prioritize deployment, infra, CI/CD, observability, and runtime config files.
- In firstTasks, emphasize runbook quality, alerts/metrics coverage, incident drills, and release safety.
- In architecture, focus on production topology, operational dependencies, and failure recovery paths.`,
  };
  return guidance[audience];
}

function buildRepoHeader(repoInfo: RepoInfo, scanResult: ScanResult): string {
  const monorepoSummary = scanResult.monorepo?.isMonorepo
    ? `\nMonorepo: true\nMonorepo Managers: ${scanResult.monorepo.managers.join(", ") || "Unknown"}\nWorkspace Packages: ${scanResult.monorepo.workspacePackages.length}`
    : "";
  return `## Repository
- Name: ${repoInfo.fullName}
- URL: ${repoInfo.url}
- Branch: ${repoInfo.branch}

## Pre-detected Information
Languages: ${scanResult.stack.languages.join(", ") || "Unknown"}
Frameworks: ${scanResult.stack.frameworks.join(", ") || "None detected"}
Build System: ${scanResult.stack.buildSystem || "Unknown"}
Has CI: ${scanResult.stack.hasCi}
Has Docker: ${scanResult.stack.hasDocker}${monorepoSummary}`;
}

function buildCommandList(scanResult: ScanResult): string {
  return scanResult.commands.map((c) => `- ${c.name}: ${c.command}`).join("\n");
}

function buildPromptFooter(
  options: BootcampOptions,
  resolvedStyle: StyleConfig,
  customPrompt?: string | null
): string {
  const audienceSection = getAudiencePromptGuidance(options.audience);
  const styleSection = formatStylePromptSection(resolvedStyle);
  const customSection = formatCustomPromptSection(customPrompt);
  return `Focus: ${options.focus}
Target audience: ${options.audience}
${audienceSection}
${styleSection}
${customSection}`;
}

function buildJsonSchema(repoInfo: RepoInfo): string {
  return `Return a JSON object with this exact structure. Include "sources" arrays citing which files informed each section:

\`\`\`json
{
  "repoName": "${repoInfo.fullName}",
  "purpose": "one-line description",
  "description": "2-3 sentence technical description (NO welcome/intro text — just describe the project)",
  "sources": ["README.md", "package.json"],
  "confidence": "high|medium|low",
  "stack": {
    "languages": [],
    "frameworks": [],
    "buildSystem": "",
    "packageManager": "",
    "hasDocker": false,
    "hasCi": true
  },
  "quickstart": {
    "prerequisites": [],
    "steps": [],
    "commands": [{"name": "", "command": "", "source": ""}],
    "commonErrors": [{"error": "", "fix": ""}],
    "sources": []
  },
  "structure": {
    "keyDirs": [{"path": "", "purpose": "", "keyFiles": []}],
    "entrypoints": [{"path": "", "type": "main|cli|server|library", "description": ""}],
    "testDirs": [],
    "docsDirs": [],
    "sources": []
  },
  "ci": {
    "workflows": [{"name": "", "file": "", "triggers": [], "mainSteps": []}],
    "mainChecks": [],
    "sources": []
  },
  "contrib": {
    "howToAddFeature": [],
    "howToAddTest": [],
    "codeStyle": "",
    "sources": []
  },
  "architecture": {
    "overview": "",
    "components": [{"name": "", "description": "", "directory": ""}],
    "dataFlow": "",
    "keyAbstractions": [{"name": "", "description": ""}],
    "codeExamples": [{"title": "", "file": "", "code": "", "explanation": ""}],
    "sources": []
  },
  "firstTasks": [
    {
      "title": "",
      "description": "",
      "difficulty": "beginner|intermediate|advanced",
      "category": "test|docs|refactor|feature|bug-fix",
      "files": [],
      "why": ""
    }
  ],
  "runbook": {
    "applicable": true,
    "deploySteps": [],
    "observability": [],
    "incidents": [{"name": "", "check": ""}],
    "sources": []
  }
}
\`\`\``;
}

/**
 * Create the analysis prompt with scan results
 */
function createAnalysisPrompt(
  repoInfo: RepoInfo,
  scanResult: ScanResult,
  options: BootcampOptions,
  customPrompt?: string | null,
  styleConfig?: StyleConfig
): string {
  const resolvedStyle = styleConfig || getStyleConfig(options.style);
  const fileList = scanResult.files
    .filter((f) => !f.isDirectory)
    .slice(0, MAX_FILE_LIST_ITEMS)
    .map((f) => f.path)
    .join("\n");

  const repoHeader = buildRepoHeader(repoInfo, scanResult);
  const cmdList = buildCommandList(scanResult);
  const jsonSchema = buildJsonSchema(repoInfo);
  const promptFooter = buildPromptFooter(options, resolvedStyle, customPrompt);

  return `Analyze this GitHub repository and produce a comprehensive onboarding kit.

${repoHeader}

## File Tree Preview (first 50 files)
${fileList}

## Detected Commands
${cmdList || "None detected"}

---

## Your Task

Quickly explore this repository using tools, then produce JSON output.

**Step 1: Quick Exploration** (max 10-15 tool calls total)
- Read README and package.json/pyproject.toml/Cargo.toml
- Glance at the main entry point
- Optionally check 1-2 source files if architecture is unclear

**Step 2: Produce Output Immediately**

${jsonSchema}

${promptFooter}

Provide exactly ${resolvedStyle.firstTasksCount} firstTasks spread across difficulty levels when possible. Be specific about file paths.
Set runbook.applicable = false for libraries/tools that aren't deployed as services.
Include 2-4 codeExamples showing key patterns/usage (short snippets of 5-15 lines with explanations).

REMEMBER: Limit tool calls. After reading key files, produce output immediately. Don't over-research.`;
}

/**
 * Create a fast analysis prompt with inline file contents (no tools needed)
 */
function createFastAnalysisPrompt(
  repoPath: string,
  repoInfo: RepoInfo,
  scanResult: ScanResult,
  options: BootcampOptions,
  customPrompt?: string | null,
  styleConfig?: StyleConfig,
  model?: string
): string {
  const resolvedStyle = styleConfig || getStyleConfig(options.style);
  const promptBudget = getPromptCharBudget(model);
  // Read key files inline
  const keyFiles = [
    "README.md",
    "readme.md",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
  ];
  const inlineContents: string[] = [];

  for (const filename of keyFiles) {
    const filePath = path.join(repoPath, filename);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs
          .readFileSync(filePath, "utf-8")
          .substring(0, promptBudget.maxKeyFileChars);
        inlineContents.push(`### ${filename}\n\`\`\`\n${content}\n\`\`\``);
      } catch (err: unknown) {
        // Skip unreadable files
        if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
      }
    }
  }

  // Also try to read main entry point
  const entryPoints = [
    "index.ts",
    "index.js",
    "src/index.ts",
    "src/index.js",
    "main.py",
    "lib.rs",
    "main.go",
  ];
  for (const entry of entryPoints) {
    const filePath = path.join(repoPath, entry);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs
          .readFileSync(filePath, "utf-8")
          .substring(0, promptBudget.maxEntryPointChars);
        inlineContents.push(`### ${entry}\n\`\`\`\n${content}\n\`\`\``);
        break; // Only include first found entry point
      } catch (err: unknown) {
        // Skip
        if (process.env.DEBUG) console.error("[debug]", (err as Error).message);
      }
    }
  }

  const fileList = scanResult.files
    .filter((f) => !f.isDirectory)
    .slice(0, MAX_FAST_FILE_LIST_ITEMS)
    .map((f) => f.path)
    .join("\n");

  const repoHeader = buildRepoHeader(repoInfo, scanResult);
  const cmdList = buildCommandList(scanResult);
  const promptFooter = buildPromptFooter(options, resolvedStyle, customPrompt);

  return `Analyze this repository and produce a comprehensive onboarding kit.

${repoHeader}

## File Tree (first 30 files)
${fileList}

## Detected Commands
${cmdList || "None detected"}

## Key File Contents (READ THESE - no tools available)
${inlineContents.join("\n\n")}

---

Based on the above information, produce a JSON object. Follow this EXACT structure with these EXACT field names and enum values:

## CRITICAL SCHEMA REQUIREMENTS:

### Enum Values (use EXACTLY these strings):
- confidence: "high", "medium", or "low"
- entrypoints[].type: "main", "binary", "server", "cli", "web", or "library"
- firstTasks[].difficulty: "beginner", "intermediate", or "advanced"
- firstTasks[].category: "bug-fix", "test", "docs", "refactor", or "feature"

### Required Fields:
- repoName, purpose, description (all strings)
- stack.languages, stack.frameworks (arrays of strings)
- stack.buildSystem (string), stack.packageManager (string or null)
- stack.hasDocker, stack.hasCi (booleans)
- quickstart.prerequisites, quickstart.steps (arrays of strings)
- quickstart.commands (array of {name, command, source})
- structure.keyDirs (array of {path, purpose})
- structure.entrypoints (array of {path, type, description})
- structure.testDirs, structure.docsDirs (arrays of strings)
- ci.workflows (array of {name, file, triggers, mainSteps})
- ci.mainChecks (array of strings)
- contrib.howToAddFeature, contrib.howToAddTest (arrays of strings)
- architecture.overview (string)
- architecture.components (array of {name, description, directory})
- firstTasks (array with title, description, difficulty, category, files, why)

\`\`\`json
{
  "repoName": "${repoInfo.fullName}",
  "purpose": "one-line description of what this repo does",
  "description": "2-3 sentence technical description (NO welcome/intro text — just describe the project)",
  "sources": ["README.md", "package.json"],
  "confidence": "high",
  "stack": {
    "languages": ["TypeScript"],
    "frameworks": ["Node.js"],
    "buildSystem": "npm",
    "packageManager": "npm",
    "hasDocker": false,
    "hasCi": true
  },
  "quickstart": {
    "prerequisites": ["Node.js >= 18"],
    "steps": ["Clone the repository", "Run npm install", "Run npm test"],
    "commands": [{"name": "install", "command": "npm install", "source": "package.json"}],
    "commonErrors": [{"error": "Missing dependencies", "fix": "Run npm install"}],
    "sources": ["README.md"]
  },
  "structure": {
    "keyDirs": [{"path": "src", "purpose": "Source code", "keyFiles": ["index.ts"]}],
    "entrypoints": [{"path": "src/index.ts", "type": "library", "description": "Main export"}],
    "testDirs": ["test"],
    "docsDirs": [],
    "sources": ["package.json"]
  },
  "ci": {
    "workflows": [{"name": "CI", "file": ".github/workflows/main.yml", "triggers": ["push", "pull_request"], "mainSteps": ["test", "lint"]}],
    "mainChecks": ["Tests must pass"],
    "sources": [".github/workflows/main.yml"]
  },
  "contrib": {
    "howToAddFeature": ["Create a new file in src/", "Export from index.ts", "Add tests"],
    "howToAddTest": ["Add test file in test/ directory", "Run npm test"],
    "codeStyle": "Standard JavaScript style",
    "sources": ["README.md"]
  },
  "architecture": {
    "overview": "Simple single-purpose utility library",
    "components": [{"name": "Core", "description": "Main functionality", "directory": "src"}],
    "dataFlow": "Input -> Process -> Output",
    "keyAbstractions": [{"name": "Main function", "description": "Primary export"}],
    "codeExamples": [{"title": "Basic usage", "file": "src/index.ts", "code": "import x from 'lib'", "explanation": "Import and use"}],
    "sources": ["src/index.ts"]
  },
  "firstTasks": [
    {
      "title": "Add a test case",
      "description": "Add a new test case for edge cases",
      "difficulty": "beginner",
      "category": "test",
      "files": ["test/test.js"],
      "why": "Good first contribution to understand the codebase"
    }
  ],
  "runbook": {
    "applicable": false,
    "deploySteps": [],
    "observability": [],
    "incidents": [],
    "sources": []
  }
}
\`\`\`

${promptFooter}

INSTRUCTIONS:
1. Replace the example values above with actual data from this repository
2. Provide exactly ${resolvedStyle.firstTasksCount} firstTasks with varying difficulty levels when possible
3. Set runbook.applicable = false for libraries that aren't deployed as services
4. Use ONLY the exact enum values listed in the CRITICAL SCHEMA REQUIREMENTS section

IMPORTANT: Return ONLY the JSON object, no other text or markdown.`;
}

/**
 * Parse the JSON response from Copilot and validate against schema
 */
function parseAndValidateRepoFacts(
  response: string,
  verbose: boolean = false
): { facts: ValidatedRepoFacts | null; errors?: string[]; warnings?: string[] } {
  if (verbose) {
    console.log("\n[DEBUG] Raw response length:", response.length);
    console.log("[DEBUG] Response preview:", response.substring(0, 500));
  }

  if (!response || response.trim().length === 0) {
    return { facts: null, errors: ["Empty response received from Copilot"] };
  }

  let parsed: unknown = null;

  // Try to find JSON in markdown code block
  const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch (e: unknown) {
      if (verbose) {
        console.error("Failed to parse JSON from code block:", (e as Error).message);
      }
    }
  }

  // Try to find any JSON object in the response
  if (!parsed) {
    const jsonObjectMatch = response.match(/\{[\s\S]*"repoName"[\s\S]*\}/);
    if (jsonObjectMatch) {
      try {
        parsed = JSON.parse(jsonObjectMatch[0]);
      } catch (e: unknown) {
        if (verbose) {
          console.error("Failed to parse extracted JSON object:", (e as Error).message);
        }
      }
    }
  }

  // Try to parse entire response as JSON
  if (!parsed) {
    try {
      parsed = JSON.parse(response);
    } catch (e: unknown) {
      if (verbose) {
        console.error("Failed to parse response as JSON:", (e as Error).message);
      }
      return { facts: null, errors: ["Could not find valid JSON in response"] };
    }
  }

  // Validate against schema
  const validation = validateRepoFacts(parsed);

  if (validation.success && validation.data) {
    return {
      facts: validation.data,
      warnings: validation.warnings,
    };
  }

  return {
    facts: null,
    errors: validation.errors || ["Schema validation failed"],
  };
}

/**
 * Models to try in order of preference
 */
export const PREFERRED_MODELS = [
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-sonnet-4-20250514",
];

async function createDefaultLlmClient(): Promise<LlmClient> {
  const { CopilotClient } = await import("@github/copilot-sdk");
  return new CopilotClient() as unknown as LlmClient;
}

function createFixtureLlmClient(response: string): LlmClient {
  return {
    async createSession() {
      const listeners: Array<(event: LlmSessionEvent) => void> = [];

      return {
        on(handler) {
          listeners.push(handler);
          return undefined;
        },
        async sendAndWait() {
          for (const listener of listeners) {
            listener({
              type: "assistant.message",
              data: {
                content: response,
              },
            });
          }
        },
      };
    },
    async stop() {
      return undefined;
    },
  };
}

export function readTestLlmFixtureResponse(): string | null {
  if (process.env.NODE_ENV !== "test") {
    return null;
  }

  const responsePath = process.env[TEST_LLM_RESPONSE_FILE_ENV];
  if (!responsePath) {
    return null;
  }

  try {
    return fs.readFileSync(responsePath, "utf-8");
  } catch (error: unknown) {
    throw new Error(`Failed to read ${TEST_LLM_RESPONSE_FILE_ENV}: ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
}

function resolveFixtureLlmClient(): LlmClient | null {
  const response = readTestLlmFixtureResponse();
  if (response === null) {
    return null;
  }

  return createFixtureLlmClient(response);
}

async function resolveLlmClient(dependencies?: AnalyzeRepoDependencies): Promise<LlmClient> {
  if (dependencies?.client) {
    return dependencies.client;
  }
  if (dependencies?.createClient) {
    return await dependencies.createClient();
  }
  const fixtureClient = resolveFixtureLlmClient();
  if (fixtureClient) {
    return fixtureClient;
  }
  return await createDefaultLlmClient();
}

/**
 * Try to create a session with the preferred model, falling back to alternatives
 */
export async function createSessionWithFallback<TConfig extends Record<string, unknown>, TSession>(
  client: { createSession(config: TConfig): Promise<TSession> },
  config: TConfig,
  verbose: boolean = false,
  overrideModel?: string
): Promise<{ session: TSession; model: string }> {
  // If a specific model is requested, try it first
  const modelsToTry = overrideModel ? [overrideModel, ...PREFERRED_MODELS] : PREFERRED_MODELS;

  for (const model of modelsToTry) {
    try {
      if (verbose) {
        console.log(chalk.gray(`Trying model: ${model}`));
      }
      const session = await client.createSession({
        ...config,
        model,
      } as TConfig);
      return { session, model };
    } catch (error: unknown) {
      // If model not available, try next one
      const errorMessage = getErrorMessage(error).toLowerCase();
      if (errorMessage.includes("model") || errorMessage.includes("not available")) {
        continue;
      }
      // For other errors, throw immediately
      throw error;
    }
  }

  // If all models failed, throw error
  throw new Error(`No available models. Tried: ${PREFERRED_MODELS.join(", ")}`);
}

/**
 * Statistics tracked during analysis
 */
export interface AnalysisStats {
  model: string;
  toolCalls: { name: string; args: string; duration?: number }[];
  totalEvents: number;
  responseLength: number;
  startTime: number;
  endTime?: number;
}

/**
 * Analyze a repository using Copilot SDK with agentic tool-calling
 */
export async function analyzeRepo(
  repoPath: string,
  repoInfo: RepoInfo,
  scanResult: ScanResult,
  options: BootcampOptions,
  onProgress?: (message: string) => void,
  styleConfigOverride?: StyleConfig,
  dependencies?: AnalyzeRepoDependencies
): Promise<{ facts: RepoFacts; stats: AnalysisStats }> {
  const stats: AnalysisStats = {
    model: "",
    toolCalls: [],
    totalEvents: 0,
    responseLength: 0,
    startTime: Date.now(),
  };

  const client = await resolveLlmClient(dependencies);
  const customPrompt = readCustomPrompt(repoPath, options.repoPrompts);
  const resolvedStyleConfig = styleConfigOverride || getStyleConfig(options.style);
  const configuredSystemPrompt = options.systemPrompt?.trim();
  const standardSystemPrompt = configuredSystemPrompt || buildSystemPrompt(resolvedStyleConfig);
  const fastSystemPrompt = configuredSystemPrompt || buildSystemPrompt(resolvedStyleConfig, true);

  if (customPrompt) {
    const source = options.repoPrompts || path.join(repoPath, CUSTOM_PROMPT_FILE);
    console.log(
      chalk.cyan(`📋 Custom prompts loaded from ${source} (${customPrompt.length} chars)`)
    );
  }

  // Fast mode: no tools, inline file contents
  if (options.fast) {
    try {
      const { session, model } = await createSessionWithFallback(
        client,
        {
          streaming: true,
          systemMessage: { content: fastSystemPrompt },
          // No tools in fast mode
        },
        options.verbose,
        options.model
      );

      stats.model = model;
      console.log(chalk.blue(`\nUsing model: ${model}`));
      console.log(chalk.yellow(`⚡ Fast mode: no tools, inline file contents\n`));

      const prompt = createFastAnalysisPrompt(
        repoPath,
        repoInfo,
        scanResult,
        options,
        customPrompt,
        resolvedStyleConfig,
        model
      );
      let fullResponse = "";
      const responseStream = createResponseStreamHandler(options.verbose, onProgress);

      session.on((event: LlmSessionEvent) => {
        stats.totalEvents++;
        const eventAny = event as Record<string, unknown>;
        if (event.type === "assistant.message_delta") {
          const delta = event.data.deltaContent;
          if (delta) {
            fullResponse += delta;
            responseStream.onDelta(delta);
          }
        }

        if (event.type === "assistant.message") {
          const data = eventAny.data as Record<string, unknown> | undefined;
          const content = data?.content as string | undefined;
          if (content && !fullResponse) {
            fullResponse = content;
            responseStream.onFallbackMessage(content);
          }
        }
      });

      await sendAndWaitWithTimeoutBoundary(
        session,
        prompt,
        FAST_MODE_TIMEOUT_MS,
        "Fast analysis request"
      );
      responseStream.flushProgress();
      stats.responseLength = fullResponse.length;
      stats.endTime = Date.now();

      const { facts, errors, warnings } = parseAndValidateRepoFacts(fullResponse, options.verbose);

      if (!facts) {
        throw new Error(`Analysis failed: ${errors?.join(", ") || "Unknown error"}`);
      }

      if (warnings?.length) {
        console.log(chalk.yellow("\n[Warnings]"));
        warnings.forEach((w) => console.log(chalk.yellow(`  - ${w}`)));
      }

      return { facts: facts as RepoFacts, stats };
    } catch (error: unknown) {
      throw new Error(`Fast analysis failed: ${getErrorMessage(error)}`, { cause: error });
    }
  }

  // Standard mode with tools
  const tools = getRepoTools({
    repoPath,
    verbose: options.verbose,
    onToolCall: (name, args) => {
      const argsStr = JSON.stringify(args).substring(0, 100);
      stats.toolCalls.push({ name, args: argsStr });
      if (options.verbose) {
        console.log(chalk.cyan(`\n[Tool Call] ${name}`), chalk.gray(argsStr));
      } else if (onProgress) {
        onProgress(`Tool: ${name}`);
      }
    },
    onToolResult: (name, result) => {
      if (options.verbose) {
        console.log(chalk.green(`[Tool Result] ${name}:`), chalk.gray(result.substring(0, 100)));
      }
    },
  });

  try {
    // Create session with best available model and tools
    const { session, model } = await createSessionWithFallback(
      client,
      {
        streaming: true,
        systemMessage: { content: standardSystemPrompt },
        tools,
      },
      options.verbose,
      options.model
    );

    stats.model = model;
    console.log(chalk.blue(`\nUsing model: ${model}`));
    console.log(chalk.gray(`Tools available: ${tools.map((t) => t.name).join(", ")}\n`));

    const prompt = createAnalysisPrompt(
      repoInfo,
      scanResult,
      options,
      customPrompt,
      resolvedStyleConfig
    );
    let fullResponse = "";
    const responseStream = createResponseStreamHandler(options.verbose, onProgress);

    // Set up event handlers
    session.on((event: LlmSessionEvent) => {
      stats.totalEvents++;
      const eventAny = event as Record<string, unknown>;

      // Stream deltas (actual response text)
      if (event.type === "assistant.message_delta") {
        const delta = event.data.deltaContent;
        if (delta) {
          fullResponse += delta;
          responseStream.onDelta(delta);
        }
      }

      // Reasoning updates
      if (event.type === "assistant.reasoning_delta") {
        if (options.verbose) {
          const reasoning = event.data?.deltaContent || "";
          process.stdout.write(chalk.gray(reasoning));
        } else if (onProgress) {
          onProgress("thinking...");
        }
      }

      // Log tool calls (handled by our tool handlers too)
      if (eventAny.type === "tool.call" && options.verbose) {
        const data = eventAny.data as Record<string, unknown> | undefined;
        const toolName = data?.name || "unknown";
        console.log(chalk.yellow(`\n[SDK Tool Call] ${toolName}`));
      }

      // Final message (fallback if no deltas)
      if (event.type === "assistant.message") {
        const data = eventAny.data as Record<string, unknown> | undefined;
        const content = data?.content as string | undefined;
        if (content && !fullResponse) {
          fullResponse = content;
          responseStream.onFallbackMessage(content);
        }
      }
    });

    // Send the analysis prompt
    await sendAndWaitWithTimeoutBoundary(
      session,
      prompt,
      STANDARD_MODE_TIMEOUT_MS,
      "Analysis request"
    ); // 10 minute timeout for tool-calling
    responseStream.flushProgress();

    stats.endTime = Date.now();
    stats.responseLength = fullResponse.length;

    if (options.verbose) {
      console.log(
        chalk.gray(`\n[Stats] Events: ${stats.totalEvents}, Tool calls: ${stats.toolCalls.length}`)
      );
      console.log(chalk.gray(`[Stats] Response length: ${stats.responseLength}`));
      console.log(
        chalk.gray(`[Stats] Duration: ${((stats.endTime - stats.startTime) / 1000).toFixed(1)}s`)
      );
    }

    // Parse and validate the response
    let result = parseAndValidateRepoFacts(fullResponse, options.verbose);
    let retryCount = 0;
    const maxRetries = 2;

    // Retry with targeted prompts if validation fails
    while (!result.facts && retryCount < maxRetries) {
      retryCount++;
      const errorSummary = result.errors
        ? getMissingFieldsSummary(result.errors)
        : "Invalid JSON structure";

      console.log(chalk.yellow(`\nRetrying (${retryCount}/${maxRetries}): ${errorSummary}`));

      const retryPrompt =
        retryCount === 1
          ? `Your previous response had validation issues: ${errorSummary}
           
Please return ONLY a valid JSON object with the complete repo analysis structure.
Make sure all required fields are present: repoName, purpose, description, stack, quickstart, structure, ci, contrib, architecture, firstTasks.
No markdown, no explanations, just the JSON object starting with { and ending with }.`
          : `Return ONLY valid JSON. Start with { and end with }. Include these required fields:
- repoName (string)
- purpose (string) 
- description (string)
- stack: { languages: [], frameworks: [], buildSystem: "", packageManager: null, hasDocker: false, hasCi: false }
- quickstart: { prerequisites: [], steps: [], commands: [] }
- structure: { keyDirs: [], entrypoints: [], testDirs: [], docsDirs: [] }
- ci: { workflows: [], mainChecks: [] }
- contrib: { howToAddFeature: [], howToAddTest: [] }
- architecture: { overview: "", components: [] }
- firstTasks: [{ title, description, difficulty, category, files, why }]`;

      fullResponse = "";
      await sendAndWaitWithTimeoutBoundary(
        session,
        retryPrompt,
        FAST_MODE_TIMEOUT_MS,
        `Analysis retry ${retryCount}`
      );
      responseStream.flushProgress();
      result = parseAndValidateRepoFacts(fullResponse, options.verbose);
    }

    if (!result.facts) {
      console.error(chalk.red("\n[ERROR] Could not parse/validate response after retries."));
      if (result.errors) {
        console.error(chalk.red("Validation errors:"));
        result.errors.forEach((e) => console.error(chalk.red(`  - ${e}`)));
      }
      console.error(chalk.gray("\nResponse preview:"), fullResponse.substring(0, 1000));
      throw new Error("Failed to parse repo facts from Copilot response");
    }

    // Log any warnings
    if (result.warnings && options.verbose) {
      console.log(chalk.yellow("\n[Warnings]"));
      result.warnings.forEach((w) => console.log(chalk.yellow(`  - ${w}`)));
    }

    // Cast to RepoFacts (ValidatedRepoFacts is compatible)
    const facts = result.facts as unknown as RepoFacts;

    // Merge with detected stack info (trust deterministic detection)
    facts.stack = {
      ...facts.stack,
      ...scanResult.stack,
      frameworks: [
        ...new Set([...scanResult.stack.frameworks, ...(facts.stack?.frameworks || [])]),
      ],
    };

    await client.stop();

    return { facts, stats };
  } catch (error) {
    await client.stop();
    throw error;
  }
}
