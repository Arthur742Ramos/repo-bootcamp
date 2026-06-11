/**
 * Tests for progress indicators
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProgressTracker, createProgressBar } from "../src/progress.js";

describe("ProgressTracker", () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker(false);
  });

  afterEach(() => {
    tracker.stop();
  });

  it("should initialize with zero tool calls", () => {
    expect(tracker.getToolCallCount()).toBe(0);
  });

  it("should record tool calls", () => {
    tracker.startPhase("analyze");
    tracker.recordToolCall("read_file");
    tracker.recordToolCall("list_files");
    tracker.recordToolCall("search");
    
    expect(tracker.getToolCallCount()).toBe(3);
  });

  it("should track elapsed time", async () => {
    const before = tracker.getElapsedTime();
    await new Promise((r) => setTimeout(r, 60));
    const after = tracker.getElapsedTime();
    
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(50); // Allow some timing variance
  });

  it("should return stats", () => {
    tracker.startPhase("analyze");
    tracker.recordToolCall("read_file");
    tracker.recordToolCall("search");
    
    const stats = tracker.getStats();
    
    expect(stats.toolCalls).toBe(2);
    expect(stats.toolNames).toEqual(["read_file", "search"]);
    expect(stats.totalTime).toBeGreaterThanOrEqual(0);
  });

  it("should handle multiple phases", () => {
    tracker.startPhase("clone");
    tracker.succeed("Cloned");
    
    tracker.startPhase("scan");
    tracker.succeed("Scanned");
    
    tracker.startPhase("analyze");
    tracker.recordToolCall("read_file");
    tracker.succeed("Analyzed");
    
    expect(tracker.getToolCallCount()).toBe(1);
  });
});

describe("createProgressBar", () => {
  it("should create a progress bar function", () => {
    const bar = createProgressBar(100, 20);
    expect(typeof bar).toBe("function");
  });

  it("should show 0% at start", () => {
    const bar = createProgressBar(100, 20);
    const result = bar(0);
    expect(result).toContain("0%");
  });

  it("should show 50% at halfway", () => {
    const bar = createProgressBar(100, 20);
    const result = bar(50);
    expect(result).toContain("50%");
  });

  it("should show 100% at end", () => {
    const bar = createProgressBar(100, 20);
    const result = bar(100);
    expect(result).toContain("100%");
  });

  it("should cap at 100%", () => {
    const bar = createProgressBar(100, 20);
    const result = bar(150);
    expect(result).toContain("100%");
  });
});

describe("ProgressTracker - additional branch coverage", () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker(false);
  });

  afterEach(() => {
    tracker.stop();
  });

  it("should handle start with analyze phase", () => {
    tracker.startPhase("analyze");
    expect(tracker.getToolCallCount()).toBe(0);
  });

  it("should handle succeed on analyze phase with tool calls", () => {
    tracker.startPhase("analyze");
    tracker.recordToolCall("read_file");
    tracker.recordToolCall("list_dir");
    tracker.succeed();
    expect(tracker.getToolCallCount()).toBe(2);
  });

  it("should handle succeed with custom message", () => {
    tracker.startPhase("clone");
    tracker.succeed("Clone completed successfully");
  });

  it("should handle fail", () => {
    tracker.startPhase("scan");
    tracker.fail("Something went wrong");
  });

  it("should handle warn", () => {
    tracker.startPhase("generate");
    tracker.warn("Partial generation");
  });

  it("should handle update with message", () => {
    tracker.startPhase("analyze");
    tracker.update("Processing files...");
  });

  it("should handle update with very long message", () => {
    tracker.startPhase("analyze");
    tracker.update("This is a very long message that should be truncated because it exceeds forty characters");
  });

  it("should track tool calls", () => {
    tracker.startPhase("analyze");
    tracker.recordToolCall("read_file");
    expect(tracker.getToolCallCount()).toBe(1);
  });

  it("should get stats", () => {
    tracker.startPhase("analyze");
    tracker.recordToolCall("read_file");
    const stats = tracker.getStats();
    expect(stats.toolCalls).toBe(1);
    expect(stats.toolNames).toEqual(["read_file"]);
    expect(stats.totalTime).toBeGreaterThanOrEqual(0);
  });

  it("should get elapsed time", () => {
    expect(tracker.getElapsedTime()).toBeGreaterThanOrEqual(0);
  });

  it("should handle start with diff phase", () => {
    tracker.startPhase("diff");
    tracker.succeed();
  });

  it("should handle start with cleanup phase", () => {
    tracker.startPhase("cleanup");
    tracker.succeed();
  });

  it("should print phase overview", () => {
    ProgressTracker.printPhaseOverview();
  });
});

describe("createProgressBar - edge cases", () => {
  it("should handle zero total", () => {
    const bar = createProgressBar(0);
    // current/total = Infinity, Math.min(100, ...) = 100
    const result = bar(0);
    expect(result).toContain("%");
  });

  it("should handle current > total", () => {
    const bar = createProgressBar(10);
    const result = bar(20);
    expect(result).toContain("100%");
  });

  it("should handle custom width", () => {
    const bar = createProgressBar(100, 50);
    const result = bar(50);
    expect(result).toContain("50%");
  });
});

describe("ProgressTracker - quiet mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not write spinner output to stdout for normal phases", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const tracker = new ProgressTracker(false, true);

    tracker.startPhase("clone", "repo");
    tracker.update("working");
    tracker.succeed("done");
    tracker.stop();

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("still surfaces failures on stderr when quiet", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tracker = new ProgressTracker(false, true);

    tracker.startPhase("scan");
    tracker.fail("scan failed");
    tracker.stop();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("scan failed");
  });

  it("still surfaces warnings on stderr when quiet", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tracker = new ProgressTracker(false, true);

    tracker.startPhase("cleanup");
    tracker.warn("could not clean up");
    tracker.stop();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("could not clean up");
  });

  it("preserves tool-call bookkeeping in quiet mode", () => {
    const tracker = new ProgressTracker(false, true);
    tracker.startPhase("analyze");
    tracker.recordToolCall("read_file");
    tracker.recordToolCall("search");
    expect(tracker.getToolCallCount()).toBe(2);
    tracker.stop();
  });
});
