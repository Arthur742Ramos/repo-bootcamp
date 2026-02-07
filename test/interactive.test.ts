import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import type { RepoInfo, ScanResult } from "../src/types.js";

const getRepoTools = vi.fn(() => [{ name: "tool" }]);
vi.mock("../src/tools.js", () => ({ getRepoTools }));

const writeFile = vi.fn();
vi.mock("fs/promises", () => ({ writeFile }));

const sendAndWait = vi.fn();
const createSession = vi.fn();
const stop = vi.fn();
let sessionHandler: ((event: any) => void) | undefined;

vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: class {
    createSession = createSession;
    stop = stop;
  },
  SessionEvent: {},
}));

const repoInfo: RepoInfo = {
  owner: "octo",
  repo: "repo",
  url: "https://github.com/octo/repo",
  branch: "main",
  fullName: "octo/repo",
};

const scanResult: ScanResult = {
  files: [
    { path: "README.md", size: 10, isDirectory: false },
    { path: "src/index.ts", size: 20, isDirectory: false },
  ],
  stack: {
    languages: ["TypeScript"],
    frameworks: ["Express"],
    buildSystem: "npm",
    packageManager: "npm",
    hasDocker: false,
    hasCi: true,
  },
  commands: [],
  ciWorkflows: [],
  readme: "README.md",
  contributing: null,
  keySourceFiles: new Map(),
};

beforeEach(() => {
  sessionHandler = undefined;
  sendAndWait.mockReset();
  createSession.mockReset();
  stop.mockReset();
  getRepoTools.mockClear();
  writeFile.mockClear();

  const on = vi.fn((handler: (event: any) => void) => {
    sessionHandler = handler;
  });
  createSession.mockResolvedValue({ sendAndWait, on });
});

describe("InteractiveSession", () => {
  it("initializes with context message", async () => {
    const { InteractiveSession } = await import("../src/interactive.js");
    sendAndWait.mockResolvedValue(undefined);

    const session = new InteractiveSession("/repo", repoInfo, scanResult, undefined, true);
    await session.initialize();

    expect(createSession).toHaveBeenCalledTimes(1);
    const createArgs = createSession.mock.calls[0][0];
    expect(createArgs.tools).toEqual([{ name: "tool" }]);
    expect(createArgs.systemMessage.content).toContain("You are an expert assistant");

    const prompt = sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("octo/repo");
    expect(prompt).toContain("README.md");
  });

  it("records responses and citations", async () => {
    const { InteractiveSession } = await import("../src/interactive.js");
    sendAndWait.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt.includes("Here is the repository context")) {
        return;
      }
      sessionHandler?.({
        type: "assistant.message_delta",
        data: { deltaContent: "All good." },
      });
      sessionHandler?.({
        type: "tool.call",
        data: { name: "read_file", arguments: { path: "src/index.ts" } },
      });
    });

    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    await session.initialize();
    const answer = await session.ask("What is this?");

    expect(answer).toBe("All good.");
    const transcript = session.getTranscript();
    expect(transcript.messages).toHaveLength(2);
    expect(transcript.messages[1].citations).toEqual(["src/index.ts"]);
  });

  it("saves transcript markdown", async () => {
    const { InteractiveSession } = await import("../src/interactive.js");
    sendAndWait.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt.includes("Here is the repository context")) {
        return;
      }
      sessionHandler?.({
        type: "assistant.message_delta",
        data: { deltaContent: "Saved." },
      });
    });

    const session = new InteractiveSession("/repo", repoInfo, scanResult);
    await session.initialize();
    await session.ask("Save transcript");
    const outputPath = await session.saveTranscript("/output");

    expect(outputPath).toBe(join("/output", "TRANSCRIPT.md"));
    expect(writeFile).toHaveBeenCalledWith(
      join("/output", "TRANSCRIPT.md"),
      expect.stringContaining("Interactive Session Transcript"),
      "utf-8",
    );
  });
});

describe("quickAsk", () => {
  it("initializes, answers, and stops", async () => {
    const { quickAsk } = await import("../src/interactive.js");
    sendAndWait.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt.includes("Here is the repository context")) {
        return;
      }
      sessionHandler?.({
        type: "assistant.message_delta",
        data: { deltaContent: "Quick answer" },
      });
    });

    const answer = await quickAsk("/repo", repoInfo, scanResult, "Hi", true);

    expect(answer).toBe("Quick answer");
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
