/**
 * Tests for agent.ts - Copilot SDK agent for repo analysis
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Use vi.hoisted so the mock references are available in vi.mock factory
const { sharedMockSession, sharedMockClient } = vi.hoisted(() => {
  const sharedMockSession = {
    on: vi.fn().mockReturnValue(vi.fn()),
    sendAndWait: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  };

  const sharedMockClient = {
    createSession: vi.fn().mockResolvedValue(sharedMockSession),
    stop: vi.fn().mockResolvedValue([]),
  };

  return { sharedMockSession, sharedMockClient };
});

// Mock the @github/copilot-sdk module
vi.mock("@github/copilot-sdk", () => {
  return {
    CopilotClient: vi.fn(function () { return sharedMockClient; }),
    defineTool: vi.fn((name: string, config: any) => ({ name, ...config })),
  };
});

// Mock chalk to pass-through strings (avoid color codes in tests)
vi.mock("chalk", () => {
  const passthrough = (s: string) => s;
  const handler: ProxyHandler<any> = {
    get: () => passthrough,
    apply: (_target, _thisArg, args) => args[0],
  };
  return { default: new Proxy(passthrough, handler) };
});

// Mock fs module for fast mode tests
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(""),
  };
});

import type { RepoInfo, ScanResult, BootcampOptions } from "../src/types.js";
import { analyzeRepo, readCustomPrompt, formatCustomPromptSection, type AnalysisStats } from "../src/agent.js";
import * as fs from "fs";

// ─── Test fixtures ───────────────────────────────────────────────────────────

function makeMockRepoInfo(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    owner: "test-owner",
    repo: "test-repo",
    url: "https://github.com/test-owner/test-repo",
    branch: "main",
    fullName: "test-owner/test-repo",
    ...overrides,
  };
}

function makeMockScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    files: [
      { path: "src/index.ts", size: 100, isDirectory: false },
      { path: "package.json", size: 200, isDirectory: false },
    ],
    stack: {
      languages: ["TypeScript"],
      frameworks: ["Express"],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: true,
    },
    commands: [
      { name: "build", command: "npm run build", source: "package.json" },
    ],
    ciWorkflows: [],
    readme: "# Test Repo",
    contributing: null,
    keySourceFiles: new Map(),
    ...overrides,
  };
}

function makeMockOptions(overrides: Partial<BootcampOptions> = {}): BootcampOptions {
  return {
    branch: "main",
    focus: "all",
    audience: "oss-contributor",
    output: "./output",
    maxFiles: 200,
    noClone: false,
    verbose: false,
    ...overrides,
  };
}

/** Minimal valid JSON that passes schema validation */
const VALID_REPO_FACTS_JSON = JSON.stringify({
  repoName: "test-owner/test-repo",
  purpose: "A test repository",
  description: "This is a test repository for testing the agent.",
  confidence: "high",
  sources: ["README.md"],
  stack: {
    languages: ["TypeScript"],
    frameworks: ["Express"],
    buildSystem: "npm",
    packageManager: "npm",
    hasDocker: false,
    hasCi: true,
  },
  quickstart: {
    prerequisites: ["Node.js 18+"],
    steps: ["npm install", "npm run dev"],
    commands: [{ name: "install", command: "npm install", source: "package.json" }],
  },
  structure: {
    keyDirs: [{ path: "src/", purpose: "Source code" }],
    entrypoints: [{ path: "src/index.ts", type: "library", description: "Main entry" }],
    testDirs: ["test/"],
    docsDirs: [],
  },
  ci: {
    workflows: [],
    mainChecks: ["test"],
  },
  contrib: {
    howToAddFeature: ["Add code"],
    howToAddTest: ["Add test"],
  },
  architecture: {
    overview: "Simple architecture",
    components: [{ name: "Core", description: "Main logic", directory: "src/" }],
  },
  firstTasks: [
    {
      title: "Fix typo",
      description: "Fix typos in README",
      difficulty: "beginner",
      category: "docs",
      files: ["README.md"],
      why: "Easy first task",
    },
  ],
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Configure the mock session to emit events and resolve sendAndWait.
 * `responseText` is streamed as a single assistant.message_delta event,
 * then the final assistant.message event is dispatched.
 */
function configureSessionResponse(responseText: string) {
  const mockSession = {
    on: vi.fn().mockImplementation(() => vi.fn()),
    sendAndWait: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  sharedMockClient.createSession.mockResolvedValue(mockSession);

  mockSession.sendAndWait.mockImplementation(async () => {
    const handler = mockSession.on.mock.calls[0]?.[0];
    if (handler) {
      handler({
        id: "evt-1",
        timestamp: new Date().toISOString(),
        parentId: null,
        type: "assistant.message_delta",
        data: { messageId: "msg-1", deltaContent: responseText },
      });
      handler({
        id: "evt-2",
        timestamp: new Date().toISOString(),
        parentId: null,
        type: "assistant.message",
        data: { messageId: "msg-1", content: responseText },
      });
    }
    return undefined;
  });

  return mockSession;
}

/**
 * Configure the session to return different responses on successive sendAndWait calls.
 */
function configureSessionResponses(responses: string[]) {
  const mockSession = {
    on: vi.fn().mockImplementation(() => vi.fn()),
    sendAndWait: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  sharedMockClient.createSession.mockResolvedValue(mockSession);

  let callIndex = 0;
  mockSession.sendAndWait.mockImplementation(async () => {
    const handler = mockSession.on.mock.calls[0]?.[0];
    const responseText = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;

    if (handler) {
      handler({
        id: `evt-${callIndex}`,
        timestamp: new Date().toISOString(),
        parentId: null,
        type: "assistant.message_delta",
        data: { messageId: `msg-${callIndex}`, deltaContent: responseText },
      });
      handler({
        id: `evt-${callIndex + 100}`,
        timestamp: new Date().toISOString(),
        parentId: null,
        type: "assistant.message",
        data: { messageId: `msg-${callIndex}`, content: responseText },
      });
    }
    return undefined;
  });

  return mockSession;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Reset shared mocks to defaults
  sharedMockClient.createSession.mockResolvedValue(sharedMockSession);
  sharedMockClient.stop.mockResolvedValue([]);
  sharedMockSession.on.mockReturnValue(vi.fn());
  sharedMockSession.sendAndWait.mockResolvedValue(undefined);
  // Suppress console output in tests
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

// ─── Model fallback ─────────────────────────────────────────────────────────

describe("model fallback", () => {
  it("uses the first model that succeeds", async () => {
    
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    // Should have attempted createSession with the first preferred model
    const firstCall = sharedMockClient.createSession.mock.calls[0][0];
    expect(firstCall.model).toBe("claude-opus-4-5");
  });

  it("falls back when the first model is not available", async () => {
    
    let callCount = 0;
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    sharedMockClient.createSession.mockImplementation(async (config: any) => {
      callCount++;
      if (callCount === 1) {
        throw new Error("model not available");
      }
      return mockSession;
    });

    // Configure response on the session
    mockSession.sendAndWait.mockImplementation(async () => {
      const handler = mockSession.on.mock.calls[0]?.[0];
      if (handler) {
        handler({
          id: "evt-1",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message_delta",
          data: { messageId: "msg-1", deltaContent: VALID_REPO_FACTS_JSON },
        });
      }
      return undefined;
    });

    const result = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    expect(sharedMockClient.createSession).toHaveBeenCalledTimes(2);
    expect(result.stats.model).toBe("claude-sonnet-4-5");
  });

  it("tries all models before throwing", async () => {
    
    sharedMockClient.createSession.mockRejectedValue(new Error("model not available"));

    await expect(
      analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions())
    ).rejects.toThrow("No available models");
  });

  it("throws immediately on non-model errors", async () => {
    
    sharedMockClient.createSession.mockRejectedValue(new Error("network timeout"));

    await expect(
      analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions())
    ).rejects.toThrow("network timeout");
  });

  it("uses override model first when specified", async () => {
    
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ model: "gpt-4o" })
    );

    const firstCall = sharedMockClient.createSession.mock.calls[0][0];
    expect(firstCall.model).toBe("gpt-4o");
  });

  it("falls back from override model when unavailable", async () => {
    let callCount = 0;
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    sharedMockClient.createSession.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("model not available");
      }
      return mockSession;
    });

    mockSession.sendAndWait.mockImplementation(async () => {
      const handler = mockSession.on.mock.calls[0]?.[0];
      if (handler) {
        handler({
          id: "evt-1",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message_delta",
          data: { messageId: "msg-1", deltaContent: VALID_REPO_FACTS_JSON },
        });
      }
      return undefined;
    });

    const { stats } = await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ model: "gpt-4o" })
    );

    expect(sharedMockClient.createSession).toHaveBeenCalledTimes(2);
    expect(sharedMockClient.createSession.mock.calls[0][0].model).toBe("gpt-4o");
    expect(sharedMockClient.createSession.mock.calls[1][0].model).toBe("claude-opus-4-5");
    expect(stats.model).toBe("claude-opus-4-5");
  });
});

// ─── Standard mode (with tools) ─────────────────────────────────────────────

describe("standard mode (with tools)", () => {
  it("returns parsed facts and stats on valid response", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const { facts, stats } = await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions()
    );

    expect(facts.repoName).toBe("test-owner/test-repo");
    expect(facts.purpose).toBe("A test repository");
    expect(stats.model).toBe("claude-opus-4-5");
    expect(stats.totalEvents).toBeGreaterThan(0);
    expect(stats.endTime).toBeDefined();
  });

  it("merges scanned stack info with LLM results", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const scanResult = makeMockScanResult({
      stack: {
        languages: ["TypeScript"],
        frameworks: ["Express", "Zod"],
        buildSystem: "npm",
        packageManager: "npm",
        hasDocker: true,
        hasCi: true,
      },
    });

    const { facts } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), scanResult, makeMockOptions());

    // Scanned stack values should override LLM values
    expect(facts.stack.hasDocker).toBe(true);
    // Frameworks should be a union of both
    expect(facts.stack.frameworks).toContain("Express");
    expect(facts.stack.frameworks).toContain("Zod");
  });

  it("configures tools in session config", async () => {
    
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    const sessionConfig = sharedMockClient.createSession.mock.calls[0][0];
    expect(sessionConfig.tools).toBeDefined();
    expect(sessionConfig.tools.length).toBe(4);
    expect(sessionConfig.tools.map((t: any) => t.name)).toEqual([
      "read_file",
      "list_files",
      "search",
      "get_repo_metadata",
    ]);
  });

  it("sets system message in session config", async () => {
    
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    const sessionConfig = sharedMockClient.createSession.mock.calls[0][0];
    expect(sessionConfig.systemMessage).toBeDefined();
    expect(sessionConfig.systemMessage.content).toContain("expert software architect");
  });

  it("calls sharedMockClient.stop() on success", async () => {
    
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    expect(sharedMockClient.stop).toHaveBeenCalledTimes(1);
  });

  it("calls sharedMockClient.stop() on error", async () => {
    
    configureSessionResponse("not valid json at all");

    // Need to configure the mock for retries too (all return invalid JSON)
    const mockSession = configureSessionResponses([
      "not valid json",
      "still not valid json",
      "nope",
    ]);

    await expect(
      analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions())
    ).rejects.toThrow();

    expect(sharedMockClient.stop).toHaveBeenCalledTimes(1);
  });
});

// ─── Tool dispatching / event handling ──────────────────────────────────────

describe("event handling", () => {
  it("accumulates response from assistant.message_delta events", async () => {
    
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    sharedMockClient.createSession.mockResolvedValue(mockSession);

    // Send JSON in multiple deltas
    const part1 = VALID_REPO_FACTS_JSON.substring(0, 100);
    const part2 = VALID_REPO_FACTS_JSON.substring(100);

    mockSession.sendAndWait.mockImplementation(async () => {
      const handler = mockSession.on.mock.calls[0]?.[0];
      if (handler) {
        handler({
          id: "evt-1",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message_delta",
          data: { messageId: "msg-1", deltaContent: part1 },
        });
        handler({
          id: "evt-2",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message_delta",
          data: { messageId: "msg-1", deltaContent: part2 },
        });
      }
      return undefined;
    });

    const { facts } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());
    expect(facts.repoName).toBe("test-owner/test-repo");
  });

  it("falls back to assistant.message content when no deltas received", async () => {
    
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    sharedMockClient.createSession.mockResolvedValue(mockSession);

    mockSession.sendAndWait.mockImplementation(async () => {
      const handler = mockSession.on.mock.calls[0]?.[0];
      if (handler) {
        // Only emit final message (no deltas)
        handler({
          id: "evt-1",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message",
          data: { messageId: "msg-1", content: VALID_REPO_FACTS_JSON },
        });
      }
      return undefined;
    });

    const { facts } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());
    expect(facts.repoName).toBe("test-owner/test-repo");
  });

  it("tracks totalEvents across all event types", async () => {
    
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    sharedMockClient.createSession.mockResolvedValue(mockSession);

    mockSession.sendAndWait.mockImplementation(async () => {
      const handler = mockSession.on.mock.calls[0]?.[0];
      if (handler) {
        handler({
          id: "evt-0",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.reasoning_delta",
          data: { reasoningId: "r-1", deltaContent: "thinking..." },
        });
        handler({
          id: "evt-1",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message_delta",
          data: { messageId: "msg-1", deltaContent: VALID_REPO_FACTS_JSON },
        });
        handler({
          id: "evt-2",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message",
          data: { messageId: "msg-1", content: VALID_REPO_FACTS_JSON },
        });
      }
      return undefined;
    });

    const { stats } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());
    expect(stats.totalEvents).toBe(3);
  });

  it("calls onProgress callback for reasoning events", async () => {
    
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    sharedMockClient.createSession.mockResolvedValue(mockSession);

    mockSession.sendAndWait.mockImplementation(async () => {
      const handler = mockSession.on.mock.calls[0]?.[0];
      if (handler) {
        handler({
          id: "evt-0",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.reasoning_delta",
          data: { reasoningId: "r-1", deltaContent: "thinking..." },
        });
        handler({
          id: "evt-1",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message_delta",
          data: { messageId: "msg-1", deltaContent: VALID_REPO_FACTS_JSON },
        });
      }
      return undefined;
    });

    const onProgress = vi.fn();
    await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions(), onProgress);

    expect(onProgress).toHaveBeenCalledWith("thinking...");
  });

  it("writes deltas to stdout in verbose mode", async () => {
    
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    sharedMockClient.createSession.mockResolvedValue(mockSession);

    mockSession.sendAndWait.mockImplementation(async () => {
      const handler = mockSession.on.mock.calls[0]?.[0];
      if (handler) {
        handler({
          id: "evt-1",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message_delta",
          data: { messageId: "msg-1", deltaContent: VALID_REPO_FACTS_JSON },
        });
      }
      return undefined;
    });

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ verbose: true })
    );

    expect(process.stdout.write).toHaveBeenCalled();
  });
});

// ─── Retry logic ────────────────────────────────────────────────────────────

describe("retry logic", () => {
  it("retries when first response fails validation, succeeds on retry", async () => {
    const mockSession = configureSessionResponses([
      '{"invalid": true}',         // First attempt: missing required fields
      VALID_REPO_FACTS_JSON,       // Second attempt: valid
    ]);

    const { facts } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    expect(facts.repoName).toBe("test-owner/test-repo");
    expect(mockSession.sendAndWait).toHaveBeenCalledTimes(2);
  });

  it("retries up to maxRetries (2) times then throws", async () => {
    const mockSession = configureSessionResponses([
      '{"invalid": true}',    // attempt 1
      '{"still": "invalid"}', // retry 1
      '{"nope": "nope"}',     // retry 2
    ]);

    await expect(
      analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions())
    ).rejects.toThrow("Failed to parse repo facts");

    // 1 initial + 2 retries = 3 total
    expect(mockSession.sendAndWait).toHaveBeenCalledTimes(3);
  });

  it("succeeds on second retry", async () => {
    const mockSession = configureSessionResponses([
      "not json at all",       // attempt 1
      '{"bad": "structure"}',  // retry 1
      VALID_REPO_FACTS_JSON,   // retry 2
    ]);

    const { facts } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());
    expect(facts.repoName).toBe("test-owner/test-repo");
    expect(mockSession.sendAndWait).toHaveBeenCalledTimes(3);
  });
});

// ─── JSON parsing (parseAndValidateRepoFacts) ───────────────────────────────

describe("response parsing", () => {
  it("parses JSON from markdown code blocks", async () => {
    const wrappedResponse = "Here is the analysis:\n```json\n" + VALID_REPO_FACTS_JSON + "\n```\n";
    configureSessionResponse(wrappedResponse);

    const { facts } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());
    expect(facts.repoName).toBe("test-owner/test-repo");
  });

  it("parses JSON embedded in surrounding text", async () => {
    const wrappedResponse = "Here is my analysis:\n" + VALID_REPO_FACTS_JSON + "\n\nHope this helps!";
    configureSessionResponse(wrappedResponse);

    const { facts } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());
    expect(facts.repoName).toBe("test-owner/test-repo");
  });

  it("parses raw JSON response", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const { facts } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());
    expect(facts.repoName).toBe("test-owner/test-repo");
  });

  it("fails on empty response", async () => {
    configureSessionResponses(["", "", ""]);

    await expect(
      analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions())
    ).rejects.toThrow();
  });
});

// ─── Fast mode ──────────────────────────────────────────────────────────────

describe("fast mode", () => {
  it("does not configure tools in fast mode", async () => {
    
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ fast: true })
    );

    const sessionConfig = sharedMockClient.createSession.mock.calls[0][0];
    expect(sessionConfig.tools).toBeUndefined();
  });

  it("returns valid facts in fast mode", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const { facts, stats } = await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ fast: true })
    );

    expect(facts.repoName).toBe("test-owner/test-repo");
    expect(stats.endTime).toBeDefined();
  });

  it("uses a simpler system message in fast mode", async () => {
    
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ fast: true })
    );

    const sessionConfig = sharedMockClient.createSession.mock.calls[0][0];
    expect(sessionConfig.systemMessage.content).toContain("expert software architect");
    expect(sessionConfig.systemMessage.content).not.toContain("read_file");
  });

  it("throws on invalid JSON in fast mode (no retries)", async () => {
    configureSessionResponse("not valid json");

    await expect(
      analyzeRepo(
        "/tmp/repo",
        makeMockRepoInfo(),
        makeMockScanResult(),
        makeMockOptions({ fast: true })
      )
    ).rejects.toThrow("Fast analysis failed");
  });

  it("reads inline file contents when available", async () => {
    const existsSyncMock = fs.existsSync as Mock;
    const readFileSyncMock = fs.readFileSync as Mock;

    existsSyncMock.mockImplementation((p: string) => {
      return p.endsWith("README.md") || p.endsWith("package.json");
    });
    readFileSyncMock.mockReturnValue("file content here");

    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ fast: true })
    );

    expect(existsSyncMock).toHaveBeenCalled();
  });
});

// ─── Verbose mode ───────────────────────────────────────────────────────────

describe("verbose mode", () => {
  it("logs stats in verbose mode", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ verbose: true })
    );

    const consoleSpy = console.log as Mock;
    const loggedMessages = consoleSpy.mock.calls.map((c: any) => c.join(" ")).join("\n");
    expect(loggedMessages).toContain("[Stats]");
  });

  it("logs tool call events in verbose mode", async () => {
    
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    sharedMockClient.createSession.mockResolvedValue(mockSession);

    mockSession.sendAndWait.mockImplementation(async () => {
      const handler = mockSession.on.mock.calls[0]?.[0];
      if (handler) {
        handler({
          id: "evt-0",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "tool.call",
          data: { name: "read_file", toolCallId: "tc-1" },
        });
        handler({
          id: "evt-1",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message_delta",
          data: { messageId: "msg-1", deltaContent: VALID_REPO_FACTS_JSON },
        });
      }
      return undefined;
    });

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ verbose: true })
    );

    const consoleSpy = console.log as Mock;
    const loggedMessages = consoleSpy.mock.calls.map((c: any) => c.join(" ")).join("\n");
    expect(loggedMessages).toContain("[SDK Tool Call]");
  });
});

// ─── Stats tracking ─────────────────────────────────────────────────────────

describe("stats tracking", () => {
  it("records model used", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const { stats } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());
    expect(stats.model).toBe("claude-opus-4-5");
  });

  it("records response length", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const { stats } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());
    expect(stats.responseLength).toBe(VALID_REPO_FACTS_JSON.length);
  });

  it("records start and end time", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const before = Date.now();
    const { stats } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());
    const after = Date.now();

    expect(stats.startTime).toBeGreaterThanOrEqual(before);
    expect(stats.endTime).toBeDefined();
    expect(stats.endTime!).toBeLessThanOrEqual(after);
  });

  it("records tool calls via onToolCall callback", async () => {
    
    // We need to verify the onToolCall callback is wired up.
    // Since tools are passed as SDK tools, we verify they appear in the config.
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const { stats } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    // No tool calls in this test since the session mock doesn't invoke tools
    expect(stats.toolCalls).toEqual([]);
    expect(Array.isArray(stats.toolCalls)).toBe(true);
  });
});

// ─── Tool setup ─────────────────────────────────────────────────────────────

describe("tool dispatching", () => {
  it("creates tools with correct names for session", async () => {
    
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    const sessionConfig = sharedMockClient.createSession.mock.calls[0][0];
    const toolNames = sessionConfig.tools.map((t: any) => t.name);
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("list_files");
    expect(toolNames).toContain("search");
    expect(toolNames).toContain("get_repo_metadata");
  });

  it("records tool calls to stats when onToolCall fires", async () => {
    
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    sharedMockClient.createSession.mockResolvedValue(mockSession);

    // Capture the tools from the session config
    let capturedTools: any[] = [];
    const origCreateSession = sharedMockClient.createSession;
    sharedMockClient.createSession.mockImplementation(async (config: any) => {
      capturedTools = config.tools || [];
      return mockSession;
    });

    mockSession.sendAndWait.mockImplementation(async () => {
      const handler = mockSession.on.mock.calls[0]?.[0];
      if (handler) {
        handler({
          id: "evt-1",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message_delta",
          data: { messageId: "msg-1", deltaContent: VALID_REPO_FACTS_JSON },
        });
      }
      return undefined;
    });

    const { stats } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    // Tools should have been passed to the session
    expect(capturedTools.length).toBe(4);
  });

  it("updates stats and progress when tool handlers run", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const onProgress = vi.fn();
    const { stats } = await analyzeRepo(
      process.cwd(),
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions(),
      onProgress
    );

    const sessionConfig = sharedMockClient.createSession.mock.calls[0][0];
    const readFileTool = sessionConfig.tools.find((t: any) => t.name === "read_file");

    await readFileTool.handler({ path: "README.md", maxLines: 1 });

    expect(stats.toolCalls.length).toBe(1);
    expect(stats.toolCalls[0].name).toBe("read_file");
    expect(stats.toolCalls[0].args).toContain("README.md");
    expect(onProgress).toHaveBeenCalledWith("Tool: read_file");
  });

  it("passes repoPath context to tools", async () => {
    
    let capturedTools: any[] = [];
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    sharedMockClient.createSession.mockImplementation(async (config: any) => {
      capturedTools = config.tools || [];
      return mockSession;
    });

    mockSession.sendAndWait.mockImplementation(async () => {
      const handler = mockSession.on.mock.calls[0]?.[0];
      if (handler) {
        handler({
          id: "evt-1",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message_delta",
          data: { messageId: "msg-1", deltaContent: VALID_REPO_FACTS_JSON },
        });
      }
      return undefined;
    });

    await analyzeRepo("/my/custom/path", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    // The tools are created with getRepoTools which uses the repoPath
    expect(capturedTools.length).toBe(4);
  });
});

// ─── Error handling ─────────────────────────────────────────────────────────

describe("error handling", () => {
  it("throws when all models fail", async () => {
    
    sharedMockClient.createSession.mockRejectedValue(new Error("model not available"));

    await expect(
      analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions())
    ).rejects.toThrow("No available models");
  });

  it("wraps fast mode errors", async () => {
    
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn().mockRejectedValue(new Error("timeout")),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    sharedMockClient.createSession.mockResolvedValue(mockSession);

    await expect(
      analyzeRepo(
        "/tmp/repo",
        makeMockRepoInfo(),
        makeMockScanResult(),
        makeMockOptions({ fast: true })
      )
    ).rejects.toThrow("Fast analysis failed");
  });

  it("propagates sendAndWait errors in standard mode", async () => {
    
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn().mockRejectedValue(new Error("connection lost")),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    sharedMockClient.createSession.mockResolvedValue(mockSession);

    await expect(
      analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions())
    ).rejects.toThrow("connection lost");
  });

  it("still calls sharedMockClient.stop() when sendAndWait throws", async () => {
    
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn().mockRejectedValue(new Error("fail")),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    sharedMockClient.createSession.mockResolvedValue(mockSession);

    await expect(
      analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions())
    ).rejects.toThrow();

    expect(sharedMockClient.stop).toHaveBeenCalled();
  });
});

// ─── Prompt construction ────────────────────────────────────────────────────

describe("prompt construction", () => {
  it("includes repo info in the prompt sent to session", async () => {
    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo({ fullName: "my-org/cool-project", url: "https://github.com/my-org/cool-project" }),
      makeMockScanResult(),
      makeMockOptions()
    );

    const prompt = mockSession.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("my-org/cool-project");
    expect(prompt).toContain("https://github.com/my-org/cool-project");
  });

  it("includes detected stack info in prompt", async () => {
    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult({ stack: { languages: ["Rust", "Go"], frameworks: ["Actix"], buildSystem: "cargo", packageManager: null, hasDocker: true, hasCi: false } }),
      makeMockOptions()
    );

    const prompt = mockSession.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("Rust");
    expect(prompt).toContain("Go");
    expect(prompt).toContain("Actix");
  });

  it("includes file list in prompt (limited to 50 files)", async () => {
    const files = Array.from({ length: 60 }, (_, i) => ({
      path: `src/file-${i}.ts`,
      size: 100,
      isDirectory: false,
    }));

    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult({ files }),
      makeMockOptions()
    );

    const prompt = mockSession.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("file-0.ts");
    expect(prompt).toContain("file-49.ts");
    expect(prompt).not.toContain("file-50.ts");
  });

  it("includes focus and audience in prompt", async () => {
    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ focus: "architecture", audience: "new-hire" })
    );

    const prompt = mockSession.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("architecture");
    expect(prompt).toContain("new-hire");
  });

  it("excludes directories from file list", async () => {
    const files = [
      { path: "src", size: 0, isDirectory: true },
      { path: "src/index.ts", size: 100, isDirectory: false },
    ];

    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult({ files }),
      makeMockOptions()
    );

    const prompt = mockSession.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("src/index.ts");
    // The directory "src" alone shouldn't appear in the file list
    const fileListSection = prompt.split("File Tree Preview")[1]?.split("##")[0] || "";
    const lines = fileListSection.split("\n").filter((l: string) => l.trim());
    const srcOnlyLine = lines.find((l: string) => l.trim() === "src");
    expect(srcOnlyLine).toBeUndefined();
  });

  it("includes commands in the prompt", async () => {
    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult({
        commands: [
          { name: "build", command: "npm run build", source: "package.json" },
          { name: "test", command: "npm test", source: "package.json" },
        ],
      }),
      makeMockOptions()
    );

    const prompt = mockSession.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("build: npm run build");
    expect(prompt).toContain("test: npm test");
  });

  it("shows empty commands gracefully", async () => {
    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult({ commands: [] }),
      makeMockOptions()
    );

    const prompt = mockSession.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("None detected");
  });

  it("includes custom prompt section when provided", async () => {
    const existsSyncMock = fs.existsSync as Mock;
    existsSyncMock.mockImplementation((p: string) => {
      return p.endsWith(".bootcamp-prompts.md");
    });
    (fs.readFileSync as Mock).mockReturnValue("Custom guidance here");

    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions()
    );

    const prompt = mockSession.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("Repository Guidance");
    expect(prompt).toContain("Custom guidance here");
  });
});

// ─── readCustomPrompt ───────────────────────────────────────────────────────

describe("readCustomPrompt", () => {
  it("returns null when file does not exist", () => {
    (fs.existsSync as Mock).mockReturnValue(false);

    expect(readCustomPrompt("/some/repo")).toBeNull();
  });

  it("returns content when file exists", () => {
    (fs.existsSync as Mock).mockImplementation((p: string) =>
      p.endsWith(".bootcamp-prompts.md")
    );
    (fs.readFileSync as Mock).mockReturnValue("Focus on security aspects");

    expect(readCustomPrompt("/some/repo")).toBe("Focus on security aspects");
  });

  it("returns null for empty file", () => {
    (fs.existsSync as Mock).mockImplementation((p: string) =>
      p.endsWith(".bootcamp-prompts.md")
    );
    (fs.readFileSync as Mock).mockReturnValue("   ");

    expect(readCustomPrompt("/some/repo")).toBeNull();
  });

  it("truncates content at 8000 chars", () => {
    (fs.existsSync as Mock).mockImplementation((p: string) =>
      p.endsWith(".bootcamp-prompts.md")
    );
    const longContent = "x".repeat(10000);
    (fs.readFileSync as Mock).mockReturnValue(longContent);

    const result = readCustomPrompt("/some/repo");
    expect(result).toHaveLength(8000);
  });

  it("returns null when readFileSync throws", () => {
    (fs.existsSync as Mock).mockImplementation((p: string) =>
      p.endsWith(".bootcamp-prompts.md")
    );
    (fs.readFileSync as Mock).mockImplementation(() => {
      throw new Error("permission denied");
    });

    expect(readCustomPrompt("/some/repo")).toBeNull();
  });
});

// ─── formatCustomPromptSection ──────────────────────────────────────────────

describe("formatCustomPromptSection", () => {
  it("returns empty string for null", () => {
    expect(formatCustomPromptSection(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatCustomPromptSection(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(formatCustomPromptSection("")).toBe("");
  });

  it("wraps content in guidance section", () => {
    const result = formatCustomPromptSection("My custom guidance");
    expect(result).toContain("## Repository Guidance (.bootcamp-prompts.md)");
    expect(result).toContain("My custom guidance");
  });
});

// ─── onToolResult verbose logging ───────────────────────────────────────────

describe("onToolResult verbose logging", () => {
  it("logs tool results in verbose mode when tool handler runs", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      process.cwd(),
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ verbose: true })
    );

    const sessionConfig = sharedMockClient.createSession.mock.calls[0][0];
    const readFileTool = sessionConfig.tools.find((t: any) => t.name === "read_file");

    await readFileTool.handler({ path: "package.json", maxLines: 1 });

    const consoleSpy = console.log as Mock;
    const loggedMessages = consoleSpy.mock.calls.map((c: any) => c.join(" ")).join("\n");
    expect(loggedMessages).toContain("[Tool Result]");
    expect(loggedMessages).toContain("read_file");
  });

  it("logs tool call details in verbose mode when tool handler runs", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      process.cwd(),
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ verbose: true })
    );

    const sessionConfig = sharedMockClient.createSession.mock.calls[0][0];
    const readFileTool = sessionConfig.tools.find((t: any) => t.name === "read_file");

    await readFileTool.handler({ path: "package.json" });

    const consoleSpy = console.log as Mock;
    const loggedMessages = consoleSpy.mock.calls.map((c: any) => c.join(" ")).join("\n");
    expect(loggedMessages).toContain("[Tool Call]");
  });
});

// ─── Reasoning delta in verbose mode ────────────────────────────────────────

describe("reasoning delta in verbose mode", () => {
  it("writes reasoning content to stdout in verbose mode", async () => {
    const mockSession = {
      on: vi.fn().mockImplementation(() => vi.fn()),
      sendAndWait: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    sharedMockClient.createSession.mockResolvedValue(mockSession);

    mockSession.sendAndWait.mockImplementation(async () => {
      const handler = mockSession.on.mock.calls[0]?.[0];
      if (handler) {
        handler({
          id: "evt-0",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.reasoning_delta",
          data: { reasoningId: "r-1", deltaContent: "Let me think about this..." },
        });
        handler({
          id: "evt-1",
          timestamp: new Date().toISOString(),
          parentId: null,
          type: "assistant.message_delta",
          data: { messageId: "msg-1", deltaContent: VALID_REPO_FACTS_JSON },
        });
      }
      return undefined;
    });

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ verbose: true })
    );

    expect(process.stdout.write).toHaveBeenCalled();
    const calls = (process.stdout.write as Mock).mock.calls.map((c: any) => c[0]);
    // Should contain the reasoning text (possibly wrapped in chalk.gray)
    expect(calls.some((c: string) => c.includes("Let me think about this..."))).toBe(true);
  });
});

// ─── Fast mode prompt construction ──────────────────────────────────────────

describe("fast mode prompt construction", () => {
  it("includes inline file contents in fast mode prompt", async () => {
    const existsSyncMock = fs.existsSync as Mock;
    const readFileSyncMock = fs.readFileSync as Mock;

    existsSyncMock.mockImplementation((p: string) => {
      return p.endsWith("README.md") || p.endsWith("package.json");
    });
    readFileSyncMock.mockImplementation((p: string) => {
      if (typeof p === "string" && p.endsWith("README.md")) return "# My Project\nSome readme content";
      if (typeof p === "string" && p.endsWith("package.json")) return '{"name": "my-project"}';
      return "";
    });

    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ fast: true })
    );

    const prompt = mockSession.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("### README.md");
    expect(prompt).toContain("# My Project");
    expect(prompt).toContain("### package.json");
    expect(prompt).toContain('"my-project"');
  });

  it("limits fast mode file list to 30 files", async () => {
    (fs.existsSync as Mock).mockReturnValue(false);

    const files = Array.from({ length: 40 }, (_, i) => ({
      path: `src/file-${i}.ts`,
      size: 100,
      isDirectory: false,
    }));

    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult({ files }),
      makeMockOptions({ fast: true })
    );

    const prompt = mockSession.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("file-29.ts");
    expect(prompt).not.toContain("file-30.ts");
  });

  it("includes entry point in fast mode when found", async () => {
    const existsSyncMock = fs.existsSync as Mock;
    const readFileSyncMock = fs.readFileSync as Mock;

    existsSyncMock.mockImplementation((p: string) => {
      return p.endsWith("src/index.ts");
    });
    readFileSyncMock.mockReturnValue("export function main() {}");

    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ fast: true })
    );

    const prompt = mockSession.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("### src/index.ts");
    expect(prompt).toContain("export function main()");
  });

  it("includes custom prompt section in fast mode", async () => {
    const existsSyncMock = fs.existsSync as Mock;
    existsSyncMock.mockImplementation((p: string) => {
      return p.endsWith(".bootcamp-prompts.md");
    });
    (fs.readFileSync as Mock).mockReturnValue("Custom fast guidance");

    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ fast: true })
    );

    const prompt = mockSession.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain("Repository Guidance");
    expect(prompt).toContain("Custom fast guidance");
  });

  it("does not retry in fast mode on validation failure", async () => {
    configureSessionResponse('{"incomplete": true}');

    await expect(
      analyzeRepo(
        "/tmp/repo",
        makeMockRepoInfo(),
        makeMockScanResult(),
        makeMockOptions({ fast: true })
      )
    ).rejects.toThrow("Fast analysis failed");

    // In fast mode, only one sendAndWait call (no retries)
    const sessions = sharedMockClient.createSession.mock.results;
    const session = await sessions[0].value;
    expect(session.sendAndWait).toHaveBeenCalledTimes(1);
  });

  it("includes streaming: true in fast mode session config", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ fast: true })
    );

    const sessionConfig = sharedMockClient.createSession.mock.calls[0][0];
    expect(sessionConfig.streaming).toBe(true);
  });
});

// ─── Stack merge deduplication ──────────────────────────────────────────────

describe("stack merge", () => {
  it("deduplicates frameworks when merging scan and LLM results", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const scanResult = makeMockScanResult({
      stack: {
        languages: ["TypeScript"],
        frameworks: ["Express"],  // Same as in VALID_REPO_FACTS_JSON
        buildSystem: "npm",
        packageManager: "npm",
        hasDocker: false,
        hasCi: true,
      },
    });

    const { facts } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), scanResult, makeMockOptions());

    // Should not have duplicates
    const expressCount = facts.stack.frameworks.filter((f: string) => f === "Express").length;
    expect(expressCount).toBe(1);
  });

  it("merges unique frameworks from both sources", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const scanResult = makeMockScanResult({
      stack: {
        languages: ["TypeScript"],
        frameworks: ["Fastify"],  // Different from LLM's "Express"
        buildSystem: "npm",
        packageManager: "npm",
        hasDocker: false,
        hasCi: true,
      },
    });

    const { facts } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), scanResult, makeMockOptions());

    expect(facts.stack.frameworks).toContain("Fastify");
    expect(facts.stack.frameworks).toContain("Express");
  });

  it("scan stack values override LLM values for non-array fields", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const scanResult = makeMockScanResult({
      stack: {
        languages: ["Python"],
        frameworks: [],
        buildSystem: "pip",
        packageManager: "pip",
        hasDocker: true,
        hasCi: false,
      },
    });

    const { facts } = await analyzeRepo("/tmp/repo", makeMockRepoInfo(), scanResult, makeMockOptions());

    expect(facts.stack.buildSystem).toBe("pip");
    expect(facts.stack.hasDocker).toBe(true);
    expect(facts.stack.hasCi).toBe(false);
    expect(facts.stack.languages).toEqual(["Python"]);
  });
});

// ─── Retry prompt content ───────────────────────────────────────────────────

describe("retry prompt content", () => {
  it("first retry prompt includes validation error summary", async () => {
    const mockSession = configureSessionResponses([
      '{"invalid": true}',
      VALID_REPO_FACTS_JSON,
    ]);

    await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    const retryPrompt = mockSession.sendAndWait.mock.calls[1][0].prompt;
    expect(retryPrompt).toContain("validation issues");
    expect(retryPrompt).toContain("valid JSON");
  });

  it("second retry prompt lists required fields explicitly", async () => {
    const mockSession = configureSessionResponses([
      '{"invalid": true}',
      '{"still": "invalid"}',
      VALID_REPO_FACTS_JSON,
    ]);

    await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    const secondRetryPrompt = mockSession.sendAndWait.mock.calls[2][0].prompt;
    expect(secondRetryPrompt).toContain("repoName (string)");
    expect(secondRetryPrompt).toContain("purpose (string)");
    expect(secondRetryPrompt).toContain("architecture");
    expect(secondRetryPrompt).toContain("firstTasks");
  });
});

// ─── Session configuration ──────────────────────────────────────────────────

describe("session configuration", () => {
  it("passes streaming: true to session in standard mode", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    const sessionConfig = sharedMockClient.createSession.mock.calls[0][0];
    expect(sessionConfig.streaming).toBe(true);
  });

  it("sends prompt with 10 minute timeout in standard mode", async () => {
    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    expect(mockSession.sendAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.any(String) }),
      600000
    );
  });

  it("sends prompt with 5 minute timeout in fast mode", async () => {
    const mockSession = configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ fast: true })
    );

    expect(mockSession.sendAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.any(String) }),
      300000
    );
  });

  it("sends retry prompts with 5 minute timeout", async () => {
    const mockSession = configureSessionResponses([
      '{"invalid": true}',
      VALID_REPO_FACTS_JSON,
    ]);

    await analyzeRepo("/tmp/repo", makeMockRepoInfo(), makeMockScanResult(), makeMockOptions());

    // Retry sendAndWait call should use 300000 timeout
    expect(mockSession.sendAndWait).toHaveBeenCalledTimes(2);
    expect(mockSession.sendAndWait.mock.calls[1][1]).toBe(300000);
  });
});

// ─── Warnings handling ──────────────────────────────────────────────────────

describe("warnings handling", () => {
  it("logs warnings in verbose standard mode", async () => {
    // Create a response that produces warnings (e.g., extra fields get ignored,
    // but the schema uses .passthrough or coercion that produces warnings).
    // Since our VALID_REPO_FACTS_JSON is clean, we test that no warnings crash.
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ verbose: true })
    );

    // Should not throw; warnings (if any) should be logged
    const consoleSpy = console.log as Mock;
    const loggedMessages = consoleSpy.mock.calls.map((c: any) => c.join(" ")).join("\n");
    // At minimum, stats should be logged
    expect(loggedMessages).toContain("[Stats]");
  });

  it("logs warnings in fast mode", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    // Should not throw
    const { facts } = await analyzeRepo(
      "/tmp/repo",
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ fast: true })
    );

    expect(facts.repoName).toBe("test-owner/test-repo");
  });
});

// ─── onProgress callback in tool dispatch ───────────────────────────────────

describe("onProgress with tool dispatch", () => {
  it("calls onProgress with tool name when not verbose", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const onProgress = vi.fn();
    await analyzeRepo(
      process.cwd(),
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ verbose: false }),
      onProgress
    );

    const sessionConfig = sharedMockClient.createSession.mock.calls[0][0];
    const listFilesTool = sessionConfig.tools.find((t: any) => t.name === "list_files");

    await listFilesTool.handler({ path: "." });

    expect(onProgress).toHaveBeenCalledWith("Tool: list_files");
  });

  it("does not call onProgress in verbose mode (uses console instead)", async () => {
    configureSessionResponse(VALID_REPO_FACTS_JSON);

    const onProgress = vi.fn();
    await analyzeRepo(
      process.cwd(),
      makeMockRepoInfo(),
      makeMockScanResult(),
      makeMockOptions({ verbose: true }),
      onProgress
    );

    const sessionConfig = sharedMockClient.createSession.mock.calls[0][0];
    const readFileTool = sessionConfig.tools.find((t: any) => t.name === "read_file");

    await readFileTool.handler({ path: "package.json" });

    // In verbose mode, console.log is used, not onProgress
    expect(onProgress).not.toHaveBeenCalledWith(expect.stringContaining("Tool: read_file"));
  });
});
