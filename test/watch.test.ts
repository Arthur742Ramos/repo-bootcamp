/**
 * Tests for watch mode module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getHeadCommit, fetchAndCheckUpdates, startWatch } from "../src/watch.js";

// Mock child_process
vi.mock("child_process", () => {
  const execFn = vi.fn();
  return {
    exec: execFn,
    promisify: () => execFn,
  };
});

// Mock fs
vi.mock("fs", () => ({
  watch: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));

import { exec } from "child_process";
import { promisify } from "util";

const execMock = promisify(exec) as unknown as ReturnType<typeof vi.fn>;

describe("getHeadCommit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trimmed commit SHA", async () => {
    execMock.mockResolvedValueOnce({ stdout: "abc1234def5678\n", stderr: "" });
    const sha = await getHeadCommit("/tmp/repo");
    expect(sha).toBe("abc1234def5678");
    expect(execMock).toHaveBeenCalledWith("git rev-parse HEAD", { cwd: "/tmp/repo" });
  });
});

describe("fetchAndCheckUpdates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns updated: false when SHA matches", async () => {
    // git fetch origin
    execMock.mockResolvedValueOnce({ stdout: "", stderr: "" });
    // git rev-parse @{u}
    execMock.mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" });

    const result = await fetchAndCheckUpdates("/tmp/repo", "abc1234");
    expect(result.updated).toBe(false);
    expect(result.newSha).toBe("abc1234");
  });

  it("returns updated: true when SHA differs", async () => {
    // git fetch origin
    execMock.mockResolvedValueOnce({ stdout: "", stderr: "" });
    // git rev-parse @{u}
    execMock.mockResolvedValueOnce({ stdout: "newsha99\n", stderr: "" });
    // git merge --ff-only FETCH_HEAD
    execMock.mockResolvedValueOnce({ stdout: "", stderr: "" });

    const result = await fetchAndCheckUpdates("/tmp/repo", "oldsha11");
    expect(result.updated).toBe(true);
    expect(result.newSha).toBe("newsha99");
  });

  it("falls back to FETCH_HEAD when upstream tracking fails", async () => {
    // git fetch origin
    execMock.mockResolvedValueOnce({ stdout: "", stderr: "" });
    // git rev-parse @{u} — fails
    execMock.mockRejectedValueOnce(new Error("no upstream"));
    // git rev-parse FETCH_HEAD
    execMock.mockResolvedValueOnce({ stdout: "fallback1\n", stderr: "" });
    // git merge --ff-only FETCH_HEAD
    execMock.mockResolvedValueOnce({ stdout: "", stderr: "" });

    const result = await fetchAndCheckUpdates("/tmp/repo", "oldsha11");
    expect(result.updated).toBe(true);
    expect(result.newSha).toBe("fallback1");
  });

  it("falls back to hard reset when ff-merge fails", async () => {
    // git fetch origin
    execMock.mockResolvedValueOnce({ stdout: "", stderr: "" });
    // git rev-parse @{u}
    execMock.mockResolvedValueOnce({ stdout: "newsha99\n", stderr: "" });
    // git merge --ff-only fails
    execMock.mockRejectedValueOnce(new Error("not ff"));
    // git reset --hard
    execMock.mockResolvedValueOnce({ stdout: "", stderr: "" });

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

  it("stop() cleans up timers", () => {
    const handle = startWatch("/tmp/repo", {
      intervalSeconds: 10,
      onChangeDetected: vi.fn(),
    });
    // Should not throw
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
