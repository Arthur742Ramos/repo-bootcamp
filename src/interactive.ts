/**
 * Interactive Q&A Module
 * REPL-style chat with the repo using Copilot SDK
 */

import * as readline from "readline";
import chalk from "chalk";
import type { LlmClient, LlmSession, LlmSessionEvent, RepoFacts, RepoInfo, ScanResult, Transcript } from "./types.js";
import { getRepoTools } from "./tools.js";
import {
  createSessionWithFallback,
  formatCustomPromptSection,
  readCustomPrompt,
  readTestLlmFixtureResponse,
} from "./agent.js";
import { writeFile } from "fs/promises";
import { join } from "path";

/**
 * System prompt for interactive mode
 */
const INTERACTIVE_SYSTEM_PROMPT = `You are an expert assistant helping developers understand and navigate a codebase.

You have access to tools to explore the repository:
- read_file: Read contents of any file
- list_files: List files and directories  
- search: Search for patterns in code using ripgrep
- get_repo_metadata: Get repository statistics

GUIDELINES:
1. Answer questions concisely and accurately
2. Always cite specific files when referencing code
3. Use tools to verify information before answering
4. Provide file paths and line numbers when helpful
5. If you're unsure, say so and suggest how to find the answer

When citing files, use the format: \`path/to/file.ts:lineNumber\``;

/**
 * Create context message with repo info
 */
function createContextMessage(
  repoInfo: RepoInfo,
  scanResult: ScanResult,
  facts?: RepoFacts
): string {
  const fileList = scanResult.files
    .filter((f) => !f.isDirectory)
    .slice(0, 30)
    .map((f) => f.path)
    .join("\n");

  let context = `## Repository Context
- Name: ${repoInfo.fullName}
- Branch: ${repoInfo.branch}
- Languages: ${scanResult.stack.languages.join(", ") || "Unknown"}
- Frameworks: ${scanResult.stack.frameworks.join(", ") || "None"}

## Key Files (first 30)
${fileList}
`;

  if (facts) {
    context += `
## Project Summary
${facts.purpose}

${facts.description}
`;
  }

  return context;
}

/**
 * Interactive session class
 */
export class InteractiveSession {
  private client: LlmClient | null = null;
  private session: LlmSession | null = null;
  private transcript: Transcript;
  private repoPath: string;
  private repoInfo: RepoInfo;
  private scanResult: ScanResult;
  private facts?: RepoFacts;
  private verbose: boolean;
  private modelOverride?: string;
  private awaitingResponse = false;
  private activeResponse = "";
  private activeCitations: string[] = [];
  private pendingContextPrompt: string | null = null;

  constructor(
    repoPath: string,
    repoInfo: RepoInfo,
    scanResult: ScanResult,
    facts?: RepoFacts,
    verbose: boolean = false,
    modelOverride?: string
  ) {
    this.repoPath = repoPath;
    this.repoInfo = repoInfo;
    this.scanResult = scanResult;
    this.facts = facts;
    this.verbose = verbose;
    this.modelOverride = modelOverride;
    this.transcript = {
      repoName: repoInfo.fullName,
      startedAt: new Date(),
      messages: [],
    };
  }

  /**
   * Initialize the Copilot session
   */
  async initialize(): Promise<void> {
    this.client = await resolveInteractiveLlmClient();

    const tools = getRepoTools({
      repoPath: this.repoPath,
      verbose: this.verbose,
      onToolCall: (name, args) => {
        if (this.verbose) {
          console.log(
            chalk.cyan(`\n[Tool] ${name}`),
            chalk.gray(JSON.stringify(args).substring(0, 80))
          );
        }
      },
      onToolResult: (name, result) => {
        if (this.verbose) {
          console.log(chalk.green(`[Result] ${name}:`), chalk.gray(result.substring(0, 100)));
        }
      },
    });

    // Create session
    const customPrompt = readCustomPrompt(this.repoPath);
    const systemPrompt = `${INTERACTIVE_SYSTEM_PROMPT}${formatCustomPromptSection(customPrompt)}`;

    const { session } = await createSessionWithFallback(
      this.client,
      {
        streaming: true,
        systemMessage: { content: systemPrompt },
        tools,
      },
      this.verbose,
      this.modelOverride
    );
    this.session = session;
    this.session.on((event: LlmSessionEvent) => this.handleSessionEvent(event));

    const contextMessage = createContextMessage(this.repoInfo, this.scanResult, this.facts);
    this.pendingContextPrompt = `Here is the repository context:\n\n${contextMessage}\n\nUse this context to answer questions about the repository.`;
  }

  /**
   * Ask a question and get a response
   */
  async ask(question: string): Promise<string> {
    if (!this.session) {
      throw new Error("Session not initialized");
    }

    // Record user message
    this.transcript.messages.push({
      role: "user",
      content: question,
      timestamp: new Date(),
    });

    this.awaitingResponse = true;
    this.activeResponse = "";
    this.activeCitations = [];
    const prompt = this.pendingContextPrompt
      ? `${this.pendingContextPrompt}\n\nUser question:\n${question}`
      : question;

    // Send question
    try {
      await this.session.sendAndWait({ prompt }, 120000);
      this.pendingContextPrompt = null;
    } finally {
      this.awaitingResponse = false;
    }

    const fullResponse = this.activeResponse;
    const citations = [...new Set(this.activeCitations)];

    console.log(); // Newline after response

    // Record assistant message
    this.transcript.messages.push({
      role: "assistant",
      content: fullResponse,
      citations: citations.length > 0 ? citations : undefined,
      timestamp: new Date(),
    });

    return fullResponse;
  }

  private handleSessionEvent(event: LlmSessionEvent): void {
    if (!this.awaitingResponse) {
      return;
    }

    if (event.type === "assistant.message_delta") {
      const delta = event.data.deltaContent;
      if (delta) {
        this.activeResponse += delta;
        process.stdout.write(delta);
      }
    }

    // Extract citations from tool calls
    const eventAny = event as Record<string, unknown>;
    if (eventAny.type === "tool.call") {
      const data = eventAny.data as Record<string, unknown> | undefined;
      const toolName = data?.name as string | undefined;
      const args = data?.arguments as Record<string, unknown> | undefined;
      if (toolName === "read_file" && args?.path) {
        this.activeCitations.push(args.path as string);
      }
    }
  }

  /**
   * Get the current transcript
   */
  getTranscript(): Transcript {
    return this.transcript;
  }

  /**
   * Save transcript to file
   */
  async saveTranscript(outputDir: string): Promise<string> {
    const content = generateTranscriptMarkdown(this.transcript);
    const filePath = join(outputDir, "TRANSCRIPT.md");
    await writeFile(filePath, content, "utf-8");
    return filePath;
  }

  /**
   * Stop the session
   */
  async stop(): Promise<void> {
    if (this.client) {
      await this.client.stop();
    }
  }
}

async function createDefaultInteractiveClient(): Promise<LlmClient> {
  const { CopilotClient } = await import("@github/copilot-sdk");
  return new CopilotClient() as unknown as LlmClient;
}

function createFixtureInteractiveClient(response: string): LlmClient {
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
              type: "assistant.message_delta",
              data: {
                deltaContent: response,
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

async function resolveInteractiveLlmClient(): Promise<LlmClient> {
  const fixtureResponse = readTestLlmFixtureResponse();
  if (fixtureResponse !== null) {
    return createFixtureInteractiveClient(fixtureResponse);
  }

  return await createDefaultInteractiveClient();
}

/**
 * Generate markdown from transcript
 */
function generateTranscriptMarkdown(transcript: Transcript): string {
  const lines: string[] = [];

  lines.push("# Interactive Session Transcript");
  lines.push("");
  lines.push(`**Repository:** ${transcript.repoName}`);
  lines.push(`**Started:** ${transcript.startedAt.toISOString()}`);
  lines.push(`**Messages:** ${transcript.messages.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of transcript.messages) {
    const icon = msg.role === "user" ? "👤" : "🤖";
    const label = msg.role === "user" ? "You" : "Assistant";

    lines.push(`## ${icon} ${label}`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");

    if (msg.citations && msg.citations.length > 0) {
      lines.push("**Files referenced:**");
      for (const cite of msg.citations) {
        lines.push(`- \`${cite}\``);
      }
      lines.push("");
    }

    lines.push(`*${msg.timestamp.toISOString()}*`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Run interactive REPL
 */
export async function runInteractiveMode(
  repoPath: string,
  repoInfo: RepoInfo,
  scanResult: ScanResult,
  outputDir: string,
  facts?: RepoFacts,
  options?: { verbose?: boolean; saveTranscript?: boolean; model?: string }
): Promise<void> {
  console.log(chalk.bold.cyan("\n=== Interactive Mode ==="));
  console.log(chalk.gray(`Repository: ${repoInfo.fullName}`));
  console.log(chalk.gray("Type your questions about the codebase. Type 'exit' to quit.\n"));

  const session = new InteractiveSession(
    repoPath,
    repoInfo,
    scanResult,
    facts,
    options?.verbose,
    options?.model
  );

  try {
    console.log(chalk.gray("Initializing Copilot session..."));
    await session.initialize();
    console.log(chalk.green("Ready!\n"));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    });
    let rlClosed = false;
    rl.on("close", () => {
      rlClosed = true;
    });

    const promptUser = (): void => {
      if (rlClosed) {
        return;
      }

      const prompt = chalk.cyan("You: ");
      if (rl.terminal) {
        rl.setPrompt(prompt);
        rl.prompt();
        return;
      }

      process.stdout.write(prompt);
    };

    try {
      promptUser();

      for await (const input of rl) {
        const question = input.trim();

        if (!question) {
          promptUser();
          continue;
        }

        if (question.toLowerCase() === "exit" || question.toLowerCase() === "quit") {
          console.log(chalk.gray("\nEnding session..."));
          break;
        }

        try {
          console.log(chalk.gray("\nAssistant: "));
          await session.ask(question);
          console.log();
        } catch (error: unknown) {
          console.error(chalk.red(`Error: ${(error as Error).message}`));
        }

        promptUser();
      }
    } finally {
      if (!rlClosed) {
        rl.close();
      }

      if (options?.saveTranscript) {
        const transcriptPath = await session.saveTranscript(outputDir);
        console.log(chalk.green(`Transcript saved to: ${transcriptPath}`));
      }

      await session.stop();
    }
  } catch (error: unknown) {
    console.error(chalk.red(`Failed to initialize session: ${(error as Error).message}`));
    await session.stop();
    throw error;
  }
}

/**
 * Quick ask mode - single question without full generation
 */
export async function quickAsk(
  repoPath: string,
  repoInfo: RepoInfo,
  scanResult: ScanResult,
  question: string,
  verbose: boolean = false,
  model?: string
): Promise<string> {
  const session = new InteractiveSession(repoPath, repoInfo, scanResult, undefined, verbose, model);

  try {
    await session.initialize();
    const answer = await session.ask(question);
    await session.stop();
    return answer;
  } catch (error: unknown) {
    await session.stop();
    throw error;
  }
}
