/**
 * Tests for interactive.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "path";
import type { RepoInfo, ScanResult, RepoFacts } from "../src/types.js";

const mockCreateSession = vi.fn();
const mockStop = vi.fn();

vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: class {
    createSession = mockCreateSession;
    stop = mockStop;
  },
  SessionEvent: {},
}));

vi.mock("../src/tools.js", () => ({
  getRepoTools: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  writeFile: vi.fn(),
}));

import {
  InteractiveSession,
  quickAsk,
  classifyInteractiveInput,
  renderInteractiveHelp,
  renderFileList,
} from "../src/interactive.js";
import { createFixtureLlmClient } from "../src/agent.js";
import { getRepoTools } from "../src/tools.js";
import { writeFile } from "fs/promises";

const mockGetRepoTools = vi.mocked(getRepoTools);
const mockWriteFile = vi.mocked(writeFile);

const repoInfo: RepoInfo = {
  owner: "octo",
  repo: "demo",
  url: "https://github.com/octo/demo",
  branch: "main",
  fullName: "octo/demo",
};

const scanResult: ScanResult = {
  files: [],
  stack: {
    languages: ["TypeScript"],
    frameworks: [],
    buildSystem: "npm",
    packageManager: "npm",
    hasDocker: false,
    hasCi: true,
  },
  commands: [],
  ciWorkflows: [],
  readme: null,
  contributing: null,
  keySourceFiles: new Map(),
};

let mockSession: {
  sendAndWait: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockCreateSession.mockReset();
  mockStop.mockReset();
  mockGetRepoTools.mockReset();
  mockWriteFile.mockReset();

  mockSession = {
    sendAndWait: vi.fn(),
    on: vi.fn(),
  };

  mockCreateSession.mockReturnValue(mockSession);
  mockGetRepoTools.mockReturnValue([
    { name: "read_file", description: "Read a file", handler: vi.fn() },
  ]);
});

describe("InteractiveSession", () => {
  it("includes repo context with the first question", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);
    mockSession.on.mockImplementation(() => {});

    const session = new InteractiveSession("/repo", repoInfo, scanResult, undefined, true);
    await session.initialize();

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await session.ask("How do I start?");
    writeSpy.mockRestore();

    expect(mockGetRepoTools).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath: "/repo", verbose: true }),
    );
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        streaming: true,
        model: "claude-opus-4-5",
        systemMessage: {
          content: expect.stringContaining("expert assistant"),
        },
        tools: expect.any(Array),
      }),
    );
    expect(mockSession.sendAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Repository Context"),
      }),
      120000,
    );
  });

  it("captures responses and citations", async () => {
    let handler: ((event: Record<string, any>) => void) | undefined;
    mockSession.on.mockImplementation((cb) => {
      handler = cb;
    });

    mockSession.sendAndWait.mockImplementationOnce(async () => {
      handler?.({ type: "assistant.message_delta", data: { deltaContent: "Hello " } });
      handler?.({ type: "assistant.message_delta", data: { deltaContent: "world" } });
      handler?.({
        type: "tool.call",
        data: { name: "read_file", arguments: { path: "src/index.ts" } },
      });
    });

    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    await session.initialize();

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const response = await session.ask("Say hi");
    writeSpy.mockRestore();

    expect(response).toBe("Hello world");
    const transcript = session.getTranscript();
    expect(transcript.messages).toHaveLength(2);
    expect(transcript.messages[1].citations).toContain("src/index.ts");
  });

  it("registers a single listener across multiple questions", async () => {
    let handler: ((event: Record<string, any>) => void) | undefined;
    mockSession.on.mockImplementation((cb) => {
      handler = cb;
    });

    mockSession.sendAndWait
      .mockImplementationOnce(async () => {
        handler?.({ type: "assistant.message_delta", data: { deltaContent: "First answer" } });
      })
      .mockImplementationOnce(async () => {
        handler?.({ type: "assistant.message_delta", data: { deltaContent: "Second answer" } });
      });

    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    await session.initialize();

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const first = await session.ask("first");
    const second = await session.ask("second");
    writeSpy.mockRestore();

    expect(first).toBe("First answer");
    expect(second).toBe("Second answer");
    expect(mockSession.on).toHaveBeenCalledTimes(1);
    expect((mockSession.sendAndWait.mock.calls[0][0].prompt as string)).toContain("Repository Context");
    expect(mockSession.sendAndWait.mock.calls[1][0].prompt).toBe("second");
  });

  it("saves transcript markdown", async () => {
    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    const transcript = session.getTranscript();
    transcript.messages.push({
      role: "user",
      content: "Hello",
      timestamp: new Date("2024-01-01T00:00:00.000Z"),
    });

    const outputPath = await session.saveTranscript("/tmp/output");

    // saveTranscript joins the output dir + filename via path.join, which uses
    // the platform-native separator. Compare with the same join.
    expect(outputPath).toBe(join("/tmp/output", "TRANSCRIPT.md"));
    expect(mockWriteFile).toHaveBeenCalledWith(
      outputPath,
      expect.stringContaining("# Interactive Session Transcript"),
      "utf-8",
    );
  });

  it("throws when asking before initialization", async () => {
    const session = new InteractiveSession("/repo", repoInfo, scanResult);

    await expect(session.ask("Hello")).rejects.toThrow("Session not initialized");
  });

  it("initializes with facts context", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);
    mockSession.on.mockImplementation(() => {});

    const facts: RepoFacts = {
      repoName: "octo/demo",
      purpose: "A demo application",
      description: "This is a demo app for testing",
      stack: scanResult.stack,
      quickstart: { prerequisites: [], steps: [], commands: [] },
      structure: { keyDirs: [], entrypoints: [], testDirs: [], docsDirs: [] },
      ci: { workflows: [], mainChecks: [] },
      contrib: { howToAddFeature: [], howToAddTest: [] },
      architecture: { overview: "", components: [] },
      firstTasks: [],
    };

    const session = new InteractiveSession("/repo", repoInfo, scanResult, facts);
    await session.initialize();

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await session.ask("What does this app do?");
    writeSpy.mockRestore();

    expect(mockSession.sendAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("A demo application"),
      }),
      120000,
    );
  });

  it("includes language info in context message", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);
    mockSession.on.mockImplementation(() => {});

    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    await session.initialize();

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await session.ask("What language is this?");
    writeSpy.mockRestore();

    expect(mockSession.sendAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("TypeScript"),
      }),
      120000,
    );
  });

  it("includes file list in context (limited to 30)", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);
    mockSession.on.mockImplementation(() => {});

    const filesResult: ScanResult = {
      ...scanResult,
      files: Array.from({ length: 40 }, (_, i) => ({
        path: `src/file${i}.ts`,
        size: 100,
        isDirectory: false,
      })),
    };

    const session = new InteractiveSession("/repo", repoInfo, filesResult);
    await session.initialize();

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await session.ask("What files are important?");
    writeSpy.mockRestore();

    // The context should include files but be capped at 30
    const call = mockSession.sendAndWait.mock.calls[0];
    const prompt = call[0].prompt as string;
    expect(prompt).toContain("src/file0.ts");
    expect(prompt).toContain("src/file29.ts");
    expect(prompt).not.toContain("src/file30.ts");
  });

  it("excludes directories from file list", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);
    mockSession.on.mockImplementation(() => {});

    const filesResult: ScanResult = {
      ...scanResult,
      files: [
        { path: "src/", size: 0, isDirectory: true },
        { path: "src/index.ts", size: 100, isDirectory: false },
      ],
    };

    const session = new InteractiveSession("/repo", repoInfo, filesResult);
    await session.initialize();

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await session.ask("Show me the entrypoint");
    writeSpy.mockRestore();

    const call = mockSession.sendAndWait.mock.calls[0];
    const prompt = call[0].prompt as string;
    expect(prompt).toContain("src/index.ts");
    expect(prompt).not.toMatch(/^src\/$/m);
  });

  it("records user message in transcript when asking", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);
    mockSession.on.mockImplementation(() => {});

    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    await session.initialize();

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await session.ask("What is this repo?");
    writeSpy.mockRestore();

    const transcript = session.getTranscript();
    expect(transcript.messages[0].role).toBe("user");
    expect(transcript.messages[0].content).toBe("What is this repo?");
    expect(transcript.messages[0].timestamp).toBeInstanceOf(Date);
  });

  it("records assistant message without citations when none present", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);
    mockSession.on.mockImplementation((cb) => {
      // No tool calls, just text
    });

    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    await session.initialize();

    mockSession.sendAndWait.mockResolvedValueOnce(undefined);

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await session.ask("Hello");
    writeSpy.mockRestore();

    const transcript = session.getTranscript();
    const assistantMsg = transcript.messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.citations).toBeUndefined();
  });

  it("handles events with null deltaContent gracefully", async () => {
    let handler: ((event: Record<string, any>) => void) | undefined;
    mockSession.on.mockImplementation((cb) => {
      handler = cb;
    });

    mockSession.sendAndWait.mockImplementationOnce(async () => {
      handler?.({ type: "assistant.message_delta", data: { deltaContent: null } });
      handler?.({ type: "assistant.message_delta", data: { deltaContent: "OK" } });
    });

    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    await session.initialize();

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const response = await session.ask("test");
    writeSpy.mockRestore();

    expect(response).toBe("OK");
  });

  it("ignores non-read_file tool calls for citations", async () => {
    let handler: ((event: Record<string, any>) => void) | undefined;
    mockSession.on.mockImplementation((cb) => {
      handler = cb;
    });

    mockSession.sendAndWait.mockImplementationOnce(async () => {
      handler?.({
        type: "tool.call",
        data: { name: "search", arguments: { pattern: "test" } },
      });
      handler?.({ type: "assistant.message_delta", data: { deltaContent: "Done" } });
    });

    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    await session.initialize();

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await session.ask("search for something");
    writeSpy.mockRestore();

    const transcript = session.getTranscript();
    const assistantMsg = transcript.messages.find((m) => m.role === "assistant");
    expect(assistantMsg!.citations).toBeUndefined();
  });

  it("transcript markdown includes repo name and message count", async () => {
    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    const transcript = session.getTranscript();
    transcript.messages.push(
      {
        role: "user",
        content: "Hello",
        timestamp: new Date("2024-01-01T00:00:00.000Z"),
      },
      {
        role: "assistant",
        content: "Hi there!",
        citations: ["src/app.ts"],
        timestamp: new Date("2024-01-01T00:00:01.000Z"),
      },
    );

    await session.saveTranscript("/tmp/output");

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    expect(writtenContent).toContain("**Repository:** octo/demo");
    expect(writtenContent).toContain("**Messages:** 2");
    expect(writtenContent).toContain("👤 You");
    expect(writtenContent).toContain("🤖 Assistant");
    expect(writtenContent).toContain("Hello");
    expect(writtenContent).toContain("Hi there!");
    expect(writtenContent).toContain("`src/app.ts`");
    expect(writtenContent).toContain("**Files referenced:**");
  });

  it("getTranscript returns initial empty transcript", () => {
    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    const transcript = session.getTranscript();

    expect(transcript.repoName).toBe("octo/demo");
    expect(transcript.messages).toEqual([]);
    expect(transcript.startedAt).toBeInstanceOf(Date);
  });

  it("stop calls client stop", async () => {
    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    await session.initialize();
    await session.stop();

    expect(mockStop).toHaveBeenCalled();
  });

  it("initializes with verbose=false by default", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);

    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    await session.initialize();

    expect(mockGetRepoTools).toHaveBeenCalledWith(
      expect.objectContaining({ verbose: false }),
    );
  });
});

describe("quickAsk", () => {
  it("returns an answer and stops the client", async () => {
    let handler: ((event: Record<string, any>) => void) | undefined;
    mockSession.on.mockImplementation((cb) => {
      handler = cb;
    });

    mockSession.sendAndWait.mockImplementationOnce(async () => {
      handler?.({ type: "assistant.message_delta", data: { deltaContent: "Answer" } });
    });

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const response = await quickAsk("/repo", repoInfo, scanResult, "Question");
    writeSpy.mockRestore();

    expect(response).toBe("Answer");
    expect(mockStop).toHaveBeenCalled();
  });

  it("stops the client even when an error occurs", async () => {
    mockSession.sendAndWait.mockRejectedValue(new Error("Connection failed"));

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(
      quickAsk("/repo", repoInfo, scanResult, "Question"),
    ).rejects.toThrow("Connection failed");
    writeSpy.mockRestore();

    expect(mockStop).toHaveBeenCalled();
  });

  it("passes verbose flag through", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);
    mockSession.on.mockImplementation(() => {});

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await quickAsk("/repo", repoInfo, scanResult, "Question", true);
    } catch {
      // May fail on sendAndWait, that's fine
    }
    writeSpy.mockRestore();

    expect(mockGetRepoTools).toHaveBeenCalledWith(
      expect.objectContaining({ verbose: true }),
    );
  });
});

describe("shared LLM client fixture (agent.ts dedup)", () => {
  // interactive.ts reuses agent.ts's createFixtureLlmClient instead of a local
  // copy; the REPL handler only understands assistant.message_delta, so the
  // shared fixture must emit exactly that shape (a single delta with the
  // response). Accumulation of that delta by InteractiveSession.ask is covered
  // by the "captures responses and citations" case above.
  it("emits a single assistant.message_delta carrying the response", async () => {
    const client = createFixtureLlmClient("answer from the shared fixture");
    const session = await client.createSession({});

    const events: Array<{ type: string; data: { deltaContent?: string } }> = [];
    session.on((event) => {
      events.push(event as { type: string; data: { deltaContent?: string } });
    });
    await session.sendAndWait({ prompt: "anything" });

    expect(events).toEqual([
      { type: "assistant.message_delta", data: { deltaContent: "answer from the shared fixture" } },
    ]);
  });
});

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI, "");

function scanWith(paths: Array<{ path: string; isDirectory?: boolean }>): ScanResult {
  return {
    files: paths.map((p) => ({ path: p.path, size: 1, isDirectory: Boolean(p.isDirectory) })),
    stack: { languages: [], frameworks: [], buildSystem: "", packageManager: "", hasDocker: false, hasCi: false },
    commands: [],
    ciWorkflows: [],
    readme: null,
    contributing: null,
    keySourceFiles: new Map(),
  } as unknown as ScanResult;
}

describe("classifyInteractiveInput", () => {
  it("treats blank input as empty", () => {
    expect(classifyInteractiveInput("")).toEqual({ kind: "empty" });
    expect(classifyInteractiveInput("   ")).toEqual({ kind: "empty" });
  });

  it("recognizes exit/quit (case-insensitive)", () => {
    expect(classifyInteractiveInput("exit")).toEqual({ kind: "exit" });
    expect(classifyInteractiveInput("QUIT")).toEqual({ kind: "exit" });
    expect(classifyInteractiveInput("  Exit  ")).toEqual({ kind: "exit" });
  });

  it("maps /exit and /quit to exit", () => {
    expect(classifyInteractiveInput("/exit")).toEqual({ kind: "exit" });
    expect(classifyInteractiveInput("/quit")).toEqual({ kind: "exit" });
  });

  it("recognizes known slash commands and their aliases", () => {
    expect(classifyInteractiveInput("/help")).toEqual({ kind: "command", name: "help", args: "" });
    expect(classifyInteractiveInput("/?")).toEqual({ kind: "command", name: "help", args: "" });
    expect(classifyInteractiveInput("/files")).toEqual({ kind: "command", name: "files", args: "" });
    expect(classifyInteractiveInput("/clear")).toEqual({ kind: "command", name: "clear", args: "" });
  });

  it("captures trailing args for slash commands", () => {
    expect(classifyInteractiveInput("/files src")).toEqual({ kind: "command", name: "files", args: "src" });
  });

  it("is case-insensitive about the command token", () => {
    expect(classifyInteractiveInput("/HELP")).toEqual({ kind: "command", name: "help", args: "" });
  });

  it("flags unknown slash commands", () => {
    expect(classifyInteractiveInput("/bogus")).toEqual({ kind: "unknown-command", name: "/bogus" });
  });

  it("treats normal text as a question and trims it", () => {
    expect(classifyInteractiveInput("  How does auth work?  ")).toEqual({
      kind: "question",
      text: "How does auth work?",
    });
  });

  it("does not treat a question containing a slash as a command", () => {
    expect(classifyInteractiveInput("what is src/index.ts")).toEqual({
      kind: "question",
      text: "what is src/index.ts",
    });
  });
});

describe("renderInteractiveHelp", () => {
  it("lists every supported command", () => {
    const help = stripAnsi(renderInteractiveHelp());
    expect(help).toContain("/help");
    expect(help).toContain("/files");
    expect(help).toContain("/clear");
    expect(help).toContain("/exit");
  });
});

describe("renderFileList", () => {
  it("lists detected files and excludes directories", () => {
    const out = stripAnsi(renderFileList(scanWith([
      { path: "src/index.ts" },
      { path: "src", isDirectory: true },
      { path: "README.md" },
    ])));
    expect(out).toContain("Detected files (2)");
    expect(out).toContain("src/index.ts");
    expect(out).toContain("README.md");
    expect(out).not.toMatch(/^\s+src$/m);
  });

  it("truncates to the limit and reports the remainder", () => {
    const files = Array.from({ length: 50 }, (_, i) => ({ path: `f${i}.ts` }));
    const out = stripAnsi(renderFileList(scanWith(files), 40));
    expect(out).toContain("Detected files (50)");
    expect(out).toContain("…and 10 more");
  });

  it("handles an empty scan", () => {
    const out = stripAnsi(renderFileList(scanWith([])));
    expect(out).toContain("No files detected");
  });
});
