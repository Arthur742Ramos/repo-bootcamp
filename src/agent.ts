/**
 * Copilot SDK Agent for Repo Analysis
 * Uses GitHub Copilot SDK with agentic tool-calling to analyze repositories
 */

import { CopilotClient, SessionEvent } from "@github/copilot-sdk";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import type { RepoFacts, ScanResult, RepoInfo, BootcampOptions } from "./types.js";
import { getRepoTools } from "./tools.js";
import { validateRepoFacts, getMissingFieldsSummary, type ValidatedRepoFacts } from "./schema.js";

/**
 * System prompt for the repo analysis agent
 */
const SYSTEM_PROMPT = `You are an expert software architect and technical writer. Your job is to analyze codebases and produce comprehensive onboarding documentation.

You have access to tools to explore the repository:
- read_file: Read contents of any file
- list_files: List files and directories
- search: Search for patterns in code using ripgrep
- get_repo_metadata: Get repository statistics

EFFICIENCY GUIDELINES:
1. Make ONE batch of tool calls to gather key info (README, package.json, entry point, one source file)
2. Make at most 2-3 additional targeted tool calls if needed
3. Then IMMEDIATELY produce your JSON output
4. DO NOT exhaustively read every file - sample intelligently

IMPORTANT:
- Limit yourself to 10-15 total tool calls maximum
- Prioritize: README > package.json/config > main entry point > 1-2 source files
- After gathering basics, produce output - don't over-research
- Always return valid JSON as the final output`;

const CUSTOM_PROMPT_FILE = ".bootcamp-prompts.md";
const CUSTOM_PROMPT_MAX_CHARS = 8000;

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
  } catch {
    return null;
  }
}

export function formatCustomPromptSection(customPrompt?: string | null): string {
  if (!customPrompt) {
    return "";
  }
  return `\n## Repository Guidance (.bootcamp-prompts.md)\n${customPrompt}\n`;
}

/**
 * Create the analysis prompt with scan results
 */
function createAnalysisPrompt(
  repoInfo: RepoInfo,
  scanResult: ScanResult,
  options: BootcampOptions,
  customPrompt?: string | null
): string {
  const fileList = scanResult.files
    .filter((f) => !f.isDirectory)
    .slice(0, 50)
    .map((f) => f.path)
    .join("\n");

  const cmdList = scanResult.commands.map((c) => `- ${c.name}: ${c.command}`).join("\n");

  const customSection = formatCustomPromptSection(customPrompt);

  return `Analyze this GitHub repository and produce a comprehensive onboarding kit.

## Repository
- Name: ${repoInfo.fullName}
- URL: ${repoInfo.url}
- Branch: ${repoInfo.branch}

## Pre-detected Information
Languages: ${scanResult.stack.languages.join(", ") || "Unknown"}
Frameworks: ${scanResult.stack.frameworks.join(", ") || "None detected"}
Build System: ${scanResult.stack.buildSystem || "Unknown"}
Has CI: ${scanResult.stack.hasCi}
Has Docker: ${scanResult.stack.hasDocker}

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

Return a JSON object with this exact structure. Include "sources" arrays citing which files informed each section:

\`\`\`json
{
  "repoName": "${repoInfo.fullName}",
  "purpose": "one-line description",
  "description": "2-3 sentence description",
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
\`\`\`

Focus: ${options.focus}
Target audience: ${options.audience}
${customSection}

Provide at least 8-10 first tasks of varying difficulty. Be specific about file paths.
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
  customPrompt?: string | null
): string {
  // Read key files inline
  const keyFiles = ["README.md", "readme.md", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"];
  const inlineContents: string[] = [];
  
  for (const filename of keyFiles) {
    const filePath = path.join(repoPath, filename);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8").substring(0, 5000);
        inlineContents.push(`### ${filename}\n\`\`\`\n${content}\n\`\`\``);
      } catch {
        // Skip unreadable files
      }
    }
  }
  
  // Also try to read main entry point
  const entryPoints = ["index.ts", "index.js", "src/index.ts", "src/index.js", "main.py", "lib.rs", "main.go"];
  for (const entry of entryPoints) {
    const filePath = path.join(repoPath, entry);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8").substring(0, 3000);
        inlineContents.push(`### ${entry}\n\`\`\`\n${content}\n\`\`\``);
        break; // Only include first found entry point
      } catch {
        // Skip
      }
    }
  }

  const fileList = scanResult.files
    .filter((f) => !f.isDirectory)
    .slice(0, 30)
    .map((f) => f.path)
    .join("\n");

  const cmdList = scanResult.commands.map((c) => `- ${c.name}: ${c.command}`).join("\n");

  const customSection = formatCustomPromptSection(customPrompt);

  return `Analyze this repository and produce a comprehensive onboarding kit.

## Repository
- Name: ${repoInfo.fullName}
- URL: ${repoInfo.url}
- Branch: ${repoInfo.branch}

## Pre-detected Information
Languages: ${scanResult.stack.languages.join(", ") || "Unknown"}
Frameworks: ${scanResult.stack.frameworks.join(", ") || "None detected"}
Build System: ${scanResult.stack.buildSystem || "Unknown"}
Has CI: ${scanResult.stack.hasCi}

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
  "description": "2-3 sentence detailed description",
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

Focus: ${options.focus}
Target audience: ${options.audience}
${customSection}

INSTRUCTIONS:
1. Replace the example values above with actual data from this repository
2. Provide at least 3-5 firstTasks with varying difficulty levels
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
      warnings: validation.warnings 
    };
  }

  return { 
    facts: null, 
    errors: validation.errors || ["Schema validation failed"] 
  };
}

/**
 * Models to try in order of preference
 */
const PREFERRED_MODELS = [
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-sonnet-4-20250514",
];

/**
 * Try to create a session with the preferred model, falling back to alternatives
 */
async function createSessionWithFallback(
  client: CopilotClient,
  config: Parameters<CopilotClient["createSession"]>[0],
  verbose: boolean = false,
  overrideModel?: string
): Promise<{ session: Awaited<ReturnType<CopilotClient["createSession"]>>; model: string }> {
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
      });
      return { session, model };
    } catch (error: unknown) {
      // If model not available, try next one
      if ((error as Error).message?.includes("model") || (error as Error).message?.includes("not available")) {
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
  onProgress?: (message: string) => void
): Promise<{ facts: RepoFacts; stats: AnalysisStats }> {
  const stats: AnalysisStats = {
    model: "",
    toolCalls: [],
    totalEvents: 0,
    responseLength: 0,
    startTime: Date.now(),
  };

  const client = new CopilotClient();
  const customPrompt = readCustomPrompt(repoPath, options.repoPrompts);

  if (customPrompt) {
    const source = options.repoPrompts || path.join(repoPath, CUSTOM_PROMPT_FILE);
    console.log(chalk.cyan(`📋 Custom prompts loaded from ${source} (${customPrompt.length} chars)`));
  }

  // Fast mode: no tools, inline file contents
  if (options.fast) {
    try {
      const { session, model } = await createSessionWithFallback(
        client,
        {
          streaming: true,
          systemMessage: { content: "You are an expert software architect. Analyze repositories and produce JSON output." },
          // No tools in fast mode
        },
        options.verbose,
        options.model
      );

      stats.model = model;
      console.log(chalk.blue(`\nUsing model: ${model}`));
      console.log(chalk.yellow(`⚡ Fast mode: no tools, inline file contents\n`));

      const prompt = createFastAnalysisPrompt(repoPath, repoInfo, scanResult, options, customPrompt);
      let fullResponse = "";

      session.on((event: SessionEvent) => {
        stats.totalEvents++;
        if (event.type === "assistant.message_delta") {
          const delta = event.data.deltaContent;
          if (delta) {
            fullResponse += delta;
            if (options.verbose) {
              process.stdout.write(delta);
            }
          }
        }
      });

      await session.sendAndWait({ prompt }, 300000);
      stats.responseLength = fullResponse.length;
      stats.endTime = Date.now();

      const { facts, errors, warnings } = parseAndValidateRepoFacts(fullResponse, options.verbose);
      
      if (!facts) {
        throw new Error(`Analysis failed: ${errors?.join(", ") || "Unknown error"}`);
      }

      if (warnings?.length) {
        console.log(chalk.yellow("\n[Warnings]"));
        warnings.forEach(w => console.log(chalk.yellow(`  - ${w}`)));
      }

      return { facts: facts as RepoFacts, stats };
    } catch (error: unknown) {
      throw new Error(`Fast analysis failed: ${(error as Error).message}`);
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
        systemMessage: { content: SYSTEM_PROMPT },
        tools,
      },
      options.verbose,
      options.model
    );

    stats.model = model;
    console.log(chalk.blue(`\nUsing model: ${model}`));
    console.log(chalk.gray(`Tools available: ${tools.map((t) => t.name).join(", ")}\n`));

    const prompt = createAnalysisPrompt(repoInfo, scanResult, options, customPrompt);
    let fullResponse = "";

    // Set up event handlers
    session.on((event: SessionEvent) => {
      stats.totalEvents++;
      const eventAny = event as Record<string, unknown>;

      // Stream deltas (actual response text)
      if (event.type === "assistant.message_delta") {
        const delta = event.data.deltaContent;
        if (delta) {
          fullResponse += delta;
          if (options.verbose) {
            process.stdout.write(delta);
          }
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
        }
      }
    });

    // Send the analysis prompt
    await session.sendAndWait({ prompt }, 600000); // 10 minute timeout for tool-calling

    stats.endTime = Date.now();
    stats.responseLength = fullResponse.length;

    if (options.verbose) {
      console.log(chalk.gray(`\n[Stats] Events: ${stats.totalEvents}, Tool calls: ${stats.toolCalls.length}`));
      console.log(chalk.gray(`[Stats] Response length: ${stats.responseLength}`));
      console.log(chalk.gray(`[Stats] Duration: ${((stats.endTime - stats.startTime) / 1000).toFixed(1)}s`));
    }

    // Parse and validate the response
    let result = parseAndValidateRepoFacts(fullResponse, options.verbose);
    let retryCount = 0;
    const maxRetries = 2;

    // Retry with targeted prompts if validation fails
    while (!result.facts && retryCount < maxRetries) {
      retryCount++;
      const errorSummary = result.errors ? getMissingFieldsSummary(result.errors) : "Invalid JSON structure";
      
      console.log(chalk.yellow(`\nRetrying (${retryCount}/${maxRetries}): ${errorSummary}`));

      const retryPrompt = retryCount === 1
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
      await session.sendAndWait({ prompt: retryPrompt }, 300000);
      result = parseAndValidateRepoFacts(fullResponse, options.verbose);
    }

    if (!result.facts) {
      console.error(chalk.red("\n[ERROR] Could not parse/validate response after retries."));
      if (result.errors) {
        console.error(chalk.red("Validation errors:"));
        result.errors.forEach(e => console.error(chalk.red(`  - ${e}`)));
      }
      console.error(chalk.gray("\nResponse preview:"), fullResponse.substring(0, 1000));
      throw new Error("Failed to parse repo facts from Copilot response");
    }

    // Log any warnings
    if (result.warnings && options.verbose) {
      console.log(chalk.yellow("\n[Warnings]"));
      result.warnings.forEach(w => console.log(chalk.yellow(`  - ${w}`)));
    }

    // Cast to RepoFacts (ValidatedRepoFacts is compatible)
    let facts = result.facts as unknown as RepoFacts;

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
