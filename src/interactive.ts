/**
 * Interactive Q&A Module
 * REPL-style chat with the repo using Copilot SDK
 */

import * as readline from "readline";
import chalk from "chalk";
import { CopilotClient, SessionEvent } from "@github/copilot-sdk";
import type { 
  ScanResult, 
  RepoInfo, 
  RepoFacts, 
  ChatMessage, 
  Transcript,
  BootcampOptions 
} from "./types.js";
import { getRepoTools, setToolContext, clearToolContext } from "./tools.js";
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
  private client: CopilotClient;
  private session: Awaited<ReturnType<CopilotClient["createSession"]>> | null = null;
  private transcript: Transcript;
  private repoPath: string;
  private repoInfo: RepoInfo;
  private scanResult: ScanResult;
  private facts?: RepoFacts;
  private verbose: boolean;

  constructor(
    repoPath: string,
    repoInfo: RepoInfo,
    scanResult: ScanResult,
    facts?: RepoFacts,
    verbose: boolean = false
  ) {
    this.client = new CopilotClient();
    this.repoPath = repoPath;
    this.repoInfo = repoInfo;
    this.scanResult = scanResult;
    this.facts = facts;
    this.verbose = verbose;
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
    // Set up tool context
    setToolContext({
      repoPath: this.repoPath,
      verbose: this.verbose,
      onToolCall: (name, args) => {
        if (this.verbose) {
          console.log(chalk.cyan(`\n[Tool] ${name}`), chalk.gray(JSON.stringify(args).substring(0, 80)));
        }
      },
      onToolResult: (name, result) => {
        if (this.verbose) {
          console.log(chalk.green(`[Result] ${name}:`), chalk.gray(result.substring(0, 100)));
        }
      },
    });

    const tools = getRepoTools();

    // Create session
    this.session = await this.client.createSession({
      streaming: true,
      systemMessage: { content: INTERACTIVE_SYSTEM_PROMPT },
      tools,
      model: "claude-sonnet-4-20250514",
    });

    // Send initial context
    const contextMessage = createContextMessage(this.repoInfo, this.scanResult, this.facts);
    await this.session.sendAndWait({ 
      prompt: `Here is the repository context:\n\n${contextMessage}\n\nAcknowledge briefly that you're ready to help explore this codebase.`
    }, 30000);
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

    let fullResponse = "";
    const citations: string[] = [];

    // Set up event handlers
    this.session.on((event: SessionEvent) => {
      if (event.type === "assistant.message_delta") {
        const delta = event.data.deltaContent;
        if (delta) {
          fullResponse += delta;
          process.stdout.write(delta);
        }
      }

      // Extract citations from tool calls
      const eventAny = event as any;
      if (eventAny.type === "tool.call") {
        const toolName = eventAny.data?.name;
        const args = eventAny.data?.arguments;
        if (toolName === "read_file" && args?.path) {
          citations.push(args.path);
        }
      }
    });

    // Send question
    await this.session.sendAndWait({ prompt: question }, 120000);

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
    clearToolContext();
    if (this.client) {
      await this.client.stop();
    }
  }
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
  options?: { verbose?: boolean; saveTranscript?: boolean }
): Promise<void> {
  console.log(chalk.bold.cyan("\n=== Interactive Mode ==="));
  console.log(chalk.gray(`Repository: ${repoInfo.fullName}`));
  console.log(chalk.gray("Type your questions about the codebase. Type 'exit' to quit.\n"));

  const session = new InteractiveSession(
    repoPath,
    repoInfo,
    scanResult,
    facts,
    options?.verbose
  );

  try {
    console.log(chalk.gray("Initializing Copilot session..."));
    await session.initialize();
    console.log(chalk.green("Ready!\n"));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = (): void => {
      rl.question(chalk.cyan("You: "), async (input) => {
        const question = input.trim();

        if (!question) {
          askQuestion();
          return;
        }

        if (question.toLowerCase() === "exit" || question.toLowerCase() === "quit") {
          console.log(chalk.gray("\nEnding session..."));

          if (options?.saveTranscript) {
            const transcriptPath = await session.saveTranscript(outputDir);
            console.log(chalk.green(`Transcript saved to: ${transcriptPath}`));
          }

          rl.close();
          await session.stop();
          return;
        }

        try {
          console.log(chalk.gray("\nAssistant: "));
          await session.ask(question);
          console.log();
        } catch (error: any) {
          console.error(chalk.red(`Error: ${error.message}`));
        }

        askQuestion();
      });
    };

    askQuestion();
  } catch (error: any) {
    console.error(chalk.red(`Failed to initialize session: ${error.message}`));
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
  verbose: boolean = false
): Promise<string> {
  const session = new InteractiveSession(
    repoPath,
    repoInfo,
    scanResult,
    undefined,
    verbose
  );

  try {
    await session.initialize();
    const answer = await session.ask(question);
    await session.stop();
    return answer;
  } catch (error) {
    await session.stop();
    throw error;
  }
}
