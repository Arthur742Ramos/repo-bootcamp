/**
 * Tests for interactive.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RepoInfo, ScanResult } from "../src/types.js";

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
});
