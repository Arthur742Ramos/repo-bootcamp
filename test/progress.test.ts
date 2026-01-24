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
    await new Promise((r) => setTimeout(r, 50));
    const after = tracker.getElapsedTime();
    
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(50);
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
