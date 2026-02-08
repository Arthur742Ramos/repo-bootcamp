/**
 * Tests for watch mode module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process.execFile as a callback-style function
const execFileMock = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args: any[]) => execFileMock(...args),
}));

// Mock fs.watch
vi.mock("fs", () => ({
  watch: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));

// Helper to make execFileMock resolve with a given result
function mockExecResult(stdout: string, stderr = "") {
  execFileMock.mockImplementationOnce((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      process.nextTick(() => cb(null, { stdout, stderr }));
    }
    return { on: vi.fn() };
  });
}

function mockExecError(message: string) {
  execFileMock.mockImplementationOnce((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      process.nextTick(() => cb(new Error(message)));
    }
    return { on: vi.fn() };
  });
}

import { getHeadCommit, fetchAndCheckUpdates, startWatch } from "../src/watch.js";

describe("getHeadCommit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trimmed commit SHA", async () => {
    mockExecResult("abc1234def5678\n");
    const sha = await getHeadCommit("/tmp/repo");
    expect(sha).toBe("abc1234def5678");
  });
});

describe("fetchAndCheckUpdates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns updated: false when SHA matches", async () => {
    mockExecResult("");           // git fetch origin
    mockExecResult("abc1234\n");  // git rev-parse @{u}

    const result = await fetchAndCheckUpdates("/tmp/repo", "abc1234");
    expect(result.updated).toBe(false);
    expect(result.newSha).toBe("abc1234");
  });

  it("returns updated: true when SHA differs", async () => {
    mockExecResult("");            // git fetch origin
    mockExecResult("newsha99\n");  // git rev-parse @{u}
    mockExecResult("");            // git merge --ff-only

    const result = await fetchAndCheckUpdates("/tmp/repo", "oldsha11");
    expect(result.updated).toBe(true);
    expect(result.newSha).toBe("newsha99");
  });

  it("falls back to FETCH_HEAD when upstream tracking fails", async () => {
    mockExecResult("");                 // git fetch origin
    mockExecError("no upstream");       // git rev-parse @{u} fails
    mockExecResult("fallback1\n");      // git rev-parse FETCH_HEAD
    mockExecResult("");                 // git merge --ff-only

    const result = await fetchAndCheckUpdates("/tmp/repo", "oldsha11");
    expect(result.updated).toBe(true);
    expect(result.newSha).toBe("fallback1");
  });

  it("falls back to hard reset when ff-merge fails", async () => {
    mockExecResult("");            // git fetch origin
    mockExecResult("newsha99\n");  // git rev-parse @{u}
    mockExecError("not ff");       // git merge --ff-only fails
    mockExecResult("");            // git reset --hard

    const result = await fetchAndCheckUpdates("/tmp/repo", "oldsha11");
    expect(result.updated).toBe(true);
    expect(result.newSha).toBe("newsha99");
  });
});

describe("startWatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a handle with stop function", () => {
    const handle = startWatch("/tmp/repo", {
      intervalSeconds: 10,
      onChangeDetected: vi.fn(),
    });
    expect(handle).toHaveProperty("stop");
    expect(typeof handle.stop).toBe("function");
    handle.stop();
  });

  it("stop() cleans up timers safely", () => {
    const handle = startWatch("/tmp/repo", {
      intervalSeconds: 10,
      onChangeDetected: vi.fn(),
    });
    handle.stop();
    handle.stop(); // Double stop should be safe
  });

  it("prints watch mode active message", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const handle = startWatch("/tmp/repo", {
      intervalSeconds: 15,
      onChangeDetected: vi.fn(),
    });
    
    const output = consoleSpy.mock.calls.map(c => String(c[0])).join(" ");
    expect(output).toContain("Watch mode active");
    expect(output).toContain("15s");
    
    handle.stop();
    consoleSpy.mockRestore();
  });
});
