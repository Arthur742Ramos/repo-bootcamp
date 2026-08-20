/**
 * Interactive Q&A Module
 * REPL-style chat with the repo using Copilot SDK
 */

import * as readline from "readline";
import chalk from "chalk";
import type {
  LlmClient,
  LlmSession,
  LlmSessionEvent,
  RepoFacts,
  RepoInfo,
  ScanResult,
  Transcript,
} from "./types.js";
import { getRepoTools } from "./tools.js";
import {
  createDefaultLlmClient,
  createFixtureLlmClient,
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
 * Result of classifying a line of interactive input.
 *
 * - `question`: a normal prompt to send to the assistant
 * - `exit`: the user wants to end the session
 * - `empty`: blank input, re-prompt without doing anything
 * - `command`: a recognized slash command (with any trailing args)
 * - `unknown-command`: a slash command we don't recognize
 */
export type InteractiveInput =
  | { kind: "question"; text: string }
  | { kind: "exit" }
  | { kind: "empty" }
  | { kind: "command"; name: InteractiveCommand; args: string }
  | { kind: "unknown-command"; name: string };

/** Slash commands supported in interactive mode. */
export type InteractiveCommand = "help" | "files" | "clear" | "exit";

const SLASH_COMMANDS: Record<string, InteractiveCommand> = {
  "/help": "help",
  "/?": "help",
  "/files": "files",
  "/clear": "clear",
  "/exit": "exit",
  "/quit": "exit",
};

/**
 * Classify a raw line of interactive input. Pure and synchronous so it can be
 * unit-tested without an LLM session.
 */
export function classifyInteractiveInput(raw: string): InteractiveInput {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { kind: "empty" };
  }

  const lower = trimmed.toLowerCase();
  if (lower === "exit" || lower === "quit") {
    return { kind: "exit" };
  }

  if (trimmed.startsWith("/")) {
    const [token, ...rest] = trimmed.split(/\s+/);
    const command = SLASH_COMMANDS[token.toLowerCase()];
    if (!command) {
      return { kind: "unknown-command", name: token };
    }
    if (command === "exit") {
      return { kind: "exit" };
    }
    return { kind: "command", name: command, args: rest.join(" ") };
  }

  return { kind: "question", text: trimmed };
}

/** Render the interactive-mode help text (slash command reference). */
export function renderInteractiveHelp(): string {
  return [
    chalk.bold("Commands:"),
    `  ${chalk.cyan("/help")}   Show this help (alias: /?)`,
    `  ${chalk.cyan("/files")}  List the key files detected in the repository`,
    `  ${chalk.cyan("/clear")}  Clear the screen`,
    `  ${chalk.cyan("/exit")}   End the session (aliases: exit, quit, /quit)`,
    "",
    chalk.dim("Anything else is sent to the assistant as a question."),
  ].join("\n");
}

/** Render the detected file list for the `/files` command. */
export function renderFileList(scanResult: ScanResult, limit = 40): string {
  const files = scanResult.files.filter((f) => !f.isDirectory).map((f) => f.path);
  if (files.length === 0) {
    return chalk.dim("No files detected in the scan.");
  }

  const shown = files.slice(0, limit);
  const lines = shown.map((path) => `  ${chalk.cyan(path)}`);
  if (files.length > shown.length) {
    lines.push(chalk.dim(`  …and ${files.length - shown.length} more`));
  }
  return [chalk.bold(`Detected files (${files.length}):`), ...lines].join("\n");
}

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

async function resolveInteractiveLlmClient(): Promise<LlmClient> {
  // Shares the default + fixture client factories with agent.ts so both the
  // analysis and REPL paths exercise the same SDK contract (a single
  // `assistant.message_delta` fixture event).
  const fixtureResponse = readTestLlmFixtureResponse();
  if (fixtureResponse !== null) {
    return createFixtureLlmClient(fixtureResponse);
  }

  return await createDefaultLlmClient();
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
  console.log(
    chalk.gray(
      "Type your questions about the codebase. Type '/help' for commands, 'exit' to quit.\n"
    )
  );

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
        const classified = classifyInteractiveInput(input);

        if (classified.kind === "empty") {
          promptUser();
          continue;
        }

        if (classified.kind === "exit") {
          console.log(chalk.gray("\nEnding session..."));
          break;
        }

        if (classified.kind === "unknown-command") {
          console.log(
            chalk.yellow(`Unknown command: ${classified.name}.`) +
              chalk.dim(" Type /help for the list of commands.")
          );
          promptUser();
          continue;
        }

        if (classified.kind === "command") {
          switch (classified.name) {
            case "help":
              console.log("\n" + renderInteractiveHelp() + "\n");
              break;
            case "files":
              console.log("\n" + renderFileList(scanResult) + "\n");
              break;
            case "clear":
              console.clear();
              break;
          }
          promptUser();
          continue;
        }

        try {
          console.log(chalk.gray("\nAssistant: "));
          await session.ask(classified.text);
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
