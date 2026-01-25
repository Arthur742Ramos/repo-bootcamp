/**
 * Copilot SDK Agent for Repo Analysis
 * Uses GitHub Copilot SDK with agentic tool-calling to analyze repositories
 */

import { CopilotClient, SessionEvent } from "@github/copilot-sdk";
import chalk from "chalk";
import type { RepoFacts, ScanResult, RepoInfo, BootcampOptions } from "./types.js";
import { getRepoTools, setToolContext, clearToolContext } from "./tools.js";
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

/**
 * Create the analysis prompt with scan results
 */
function createAnalysisPrompt(
  repoInfo: RepoInfo,
  scanResult: ScanResult,
  options: BootcampOptions
): string {
  const fileList = scanResult.files
    .filter((f) => !f.isDirectory)
    .slice(0, 50)
    .map((f) => f.path)
    .join("\n");

  const cmdList = scanResult.commands.map((c) => `- ${c.name}: ${c.command}`).join("\n");

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

Provide at least 8-10 first tasks of varying difficulty. Be specific about file paths.
Set runbook.applicable = false for libraries/tools that aren't deployed as services.
Include 2-4 codeExamples showing key patterns/usage (short snippets of 5-15 lines with explanations).

REMEMBER: Limit tool calls. After reading key files, produce output immediately. Don't over-research.`;
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
    } catch (e: any) {
      if (verbose) {
        console.error("Failed to parse JSON from code block:", e.message);
      }
    }
  }

  // Try to find any JSON object in the response
  if (!parsed) {
    const jsonObjectMatch = response.match(/\{[\s\S]*"repoName"[\s\S]*\}/);
    if (jsonObjectMatch) {
      try {
        parsed = JSON.parse(jsonObjectMatch[0]);
      } catch (e: any) {
        if (verbose) {
          console.error("Failed to parse extracted JSON object:", e.message);
        }
      }
    }
  }

  // Try to parse entire response as JSON
  if (!parsed) {
    try {
      parsed = JSON.parse(response);
    } catch (e: any) {
      if (verbose) {
        console.error("Failed to parse response as JSON:", e.message);
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
  verbose: boolean = false
): Promise<{ session: Awaited<ReturnType<CopilotClient["createSession"]>>; model: string }> {
  for (const model of PREFERRED_MODELS) {
    try {
      if (verbose) {
        console.log(chalk.gray(`Trying model: ${model}`));
      }
      const session = await client.createSession({
        ...config,
        model,
      });
      return { session, model };
    } catch (error: any) {
      // If model not available, try next one
      if (error.message?.includes("model") || error.message?.includes("not available")) {
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

  // Set up tool context
  setToolContext({
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

  const client = new CopilotClient();

  try {
    // Get tools for the session
    const tools = getRepoTools();

    // Create session with best available model and tools
    const { session, model } = await createSessionWithFallback(
      client,
      {
        streaming: true,
        systemMessage: { content: SYSTEM_PROMPT },
        tools,
      },
      options.verbose
    );

    stats.model = model;
    console.log(chalk.blue(`\nUsing model: ${model}`));
    console.log(chalk.gray(`Tools available: ${tools.map((t) => t.name).join(", ")}\n`));

    const prompt = createAnalysisPrompt(repoInfo, scanResult, options);
    let fullResponse = "";

    // Set up event handlers
    session.on((event: SessionEvent) => {
      stats.totalEvents++;
      const eventAny = event as any;

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
        const toolName = eventAny.data?.name || "unknown";
        console.log(chalk.yellow(`\n[SDK Tool Call] ${toolName}`));
      }

      // Final message (fallback if no deltas)
      if (event.type === "assistant.message") {
        const content = eventAny.data?.content;
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
      await session.sendAndWait({ prompt: retryPrompt }, 120000);
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
    clearToolContext();

    return { facts, stats };
  } catch (error) {
    await client.stop();
    clearToolContext();
    throw error;
  }
}
