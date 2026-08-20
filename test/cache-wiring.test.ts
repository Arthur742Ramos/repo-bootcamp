/**
 * Tests that the facts (LLM) cache is actually wired into orchestrateAnalysis:
 * a cache hit must skip the expensive analyzeRepo call, a miss must populate
 * the cache, and --no-cache / missing-commitSha must bypass caching entirely.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BootcampOptions, RepoFacts, RepoInfo, ScanResult } from "../src/types.js";
import type { StyleConfig } from "../src/plugins.js";

const { analyzeRepoMock, readCacheMock, writeCacheMock } = vi.hoisted(() => ({
  analyzeRepoMock: vi.fn(),
  readCacheMock: vi.fn(),
  writeCacheMock: vi.fn(),
}));

vi.mock("../src/agent.js", () => ({ analyzeRepo: analyzeRepoMock }));
vi.mock("../src/cache.js", () => ({ readCache: readCacheMock, writeCache: writeCacheMock }));
vi.mock("chalk", () => ({ default: { yellow: (s: string) => s } }));

import { orchestrateAnalysis } from "../src/services/analysis-orchestration.js";

const facts = { repoName: "owner/repo", firstTasks: [] } as unknown as RepoFacts;

const liveResult = {
  facts,
  stats: {
    model: "gpt-live",
    toolCalls: [{ name: "readFile", args: "" }],
    totalEvents: 1,
    responseLength: 10,
    startTime: Date.now(),
    endTime: Date.now(),
  },
};

const scanResult = { files: [], keySourceFiles: new Map() } as unknown as ScanResult;
const styleConfig = { firstTasksCount: 5 } as unknown as StyleConfig;

function makeProgress() {
  return { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any;
}

function makeOptions(overrides: Partial<BootcampOptions> = {}): BootcampOptions {
  return {
    branch: "",
    focus: "all",
    audience: "backend",
    output: "",
    maxFiles: 200,
    noClone: false,
    verbose: false,
    style: "oss",
    model: "gpt-live",
    ...overrides,
  };
}

function makeRepoInfo(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    owner: "owner",
    repo: "repo",
    url: "https://github.com/owner/repo",
    branch: "main",
    fullName: "owner/repo",
    commitSha: "abc123",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  analyzeRepoMock.mockResolvedValue(liveResult);
  readCacheMock.mockResolvedValue(null);
  writeCacheMock.mockResolvedValue(undefined);
});

describe("orchestrateAnalysis facts cache wiring", () => {
  it("reads the cache and writes it on a miss (running the model once)", async () => {
    const result = await orchestrateAnalysis({
      repoPath: "/repo",
      repoInfo: makeRepoInfo(),
      scanResult,
      options: makeOptions(),
      styleConfig,
      progress: makeProgress(),
      analysisStart: Date.now(),
    });

    expect(readCacheMock).toHaveBeenCalledWith(
      "owner/repo",
      "abc123",
      expect.objectContaining({
        focus: "all",
        style: "oss",
        model: "gpt-live",
        audience: "backend",
      })
    );
    expect(analyzeRepoMock).toHaveBeenCalledTimes(1);
    expect(writeCacheMock).toHaveBeenCalledWith(
      "owner/repo",
      "abc123",
      facts,
      expect.objectContaining({ style: "oss" })
    );
    expect(result.model).toBe("gpt-live");
    expect(result.toolCalls).toBe(1);
  });

  it("returns cached facts without invoking the model on a hit", async () => {
    const cachedFacts = {
      repoName: "owner/repo",
      firstTasks: [],
      cached: true,
    } as unknown as RepoFacts;
    readCacheMock.mockResolvedValue(cachedFacts);

    const result = await orchestrateAnalysis({
      repoPath: "/repo",
      repoInfo: makeRepoInfo(),
      scanResult,
      options: makeOptions(),
      styleConfig,
      progress: makeProgress(),
      analysisStart: Date.now(),
    });

    expect(analyzeRepoMock).not.toHaveBeenCalled();
    expect(writeCacheMock).not.toHaveBeenCalled();
    expect(result.facts).toBe(cachedFacts);
    // A hit has no live model/tool data — synthesized as "cache".
    expect(result.model).toBe("cache");
    expect(result.toolCalls).toBe(0);
  });

  it("bypasses the cache entirely when --no-cache is set", async () => {
    await orchestrateAnalysis({
      repoPath: "/repo",
      repoInfo: makeRepoInfo(),
      scanResult,
      options: makeOptions({ noCache: true }),
      styleConfig,
      progress: makeProgress(),
      analysisStart: Date.now(),
    });

    expect(readCacheMock).not.toHaveBeenCalled();
    expect(writeCacheMock).not.toHaveBeenCalled();
    expect(analyzeRepoMock).toHaveBeenCalledTimes(1);
  });

  it("skips caching when there is no commit SHA (local --no-clone)", async () => {
    await orchestrateAnalysis({
      repoPath: "/repo",
      repoInfo: makeRepoInfo({ commitSha: undefined }),
      scanResult,
      options: makeOptions(),
      styleConfig,
      progress: makeProgress(),
      analysisStart: Date.now(),
    });

    expect(readCacheMock).not.toHaveBeenCalled();
    expect(writeCacheMock).not.toHaveBeenCalled();
    expect(analyzeRepoMock).toHaveBeenCalledTimes(1);
  });
});
