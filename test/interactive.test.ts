/**
 * Tests for interactive.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { InteractiveSession, quickAsk } from "../src/interactive.js";
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
  it("initializes with repo context", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);

    const session = new InteractiveSession("/repo", repoInfo, scanResult, undefined, true);
    await session.initialize();

    expect(mockGetRepoTools).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath: "/repo", verbose: true }),
    );
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        streaming: true,
        model: "claude-sonnet-4-20250514",
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
      30000,
    );
  });

  it("captures responses and citations", async () => {
    let handler: ((event: Record<string, any>) => void) | undefined;
    mockSession.on.mockImplementation((cb) => {
      handler = cb;
    });

    mockSession.sendAndWait
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
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

  it("saves transcript markdown", async () => {
    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    const transcript = session.getTranscript();
    transcript.messages.push({
      role: "user",
      content: "Hello",
      timestamp: new Date("2024-01-01T00:00:00.000Z"),
    });

    const outputPath = await session.saveTranscript("/tmp/output");

    expect(outputPath).toBe("/tmp/output/TRANSCRIPT.md");
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

    expect(mockSession.sendAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("A demo application"),
      }),
      30000,
    );
  });

  it("includes language info in context message", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);

    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    await session.initialize();

    expect(mockSession.sendAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("TypeScript"),
      }),
      30000,
    );
  });

  it("includes file list in context (limited to 30)", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);

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

    // The context should include files but be capped at 30
    const call = mockSession.sendAndWait.mock.calls[0];
    const prompt = call[0].prompt as string;
    expect(prompt).toContain("src/file0.ts");
    expect(prompt).toContain("src/file29.ts");
    expect(prompt).not.toContain("src/file30.ts");
  });

  it("excludes directories from file list", async () => {
    mockSession.sendAndWait.mockResolvedValue(undefined);

    const filesResult: ScanResult = {
      ...scanResult,
      files: [
        { path: "src/", size: 0, isDirectory: true },
        { path: "src/index.ts", size: 100, isDirectory: false },
      ],
    };

    const session = new InteractiveSession("/repo", repoInfo, filesResult);
    await session.initialize();

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

    mockSession.sendAndWait
      .mockResolvedValueOnce(undefined) // init
      .mockImplementationOnce(async () => {
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

    mockSession.sendAndWait
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
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

    mockSession.sendAndWait
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
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
