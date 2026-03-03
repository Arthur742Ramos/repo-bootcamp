import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("chalk", () => {
  const makeChalk = (): any => new Proxy((...args: any[]) => args.join(""), {
    get: () => makeChalk(),
    apply: (_t: any, _a: any, args: any[]) => args.join(""),
  });
  return { default: makeChalk() };
});

vi.mock("ora", () => ({
  default: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(), text: "",
  })),
}));

import { ProgressTracker, createProgressBar } from "../src/progress.js";

describe("ProgressTracker extra branches", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("analyze phase with tool calls and timer", () => {
    const p = new ProgressTracker(true);
    p.startPhase("analyze");
    p.recordToolCall("readFile");
    p.recordToolCall("search");
    p.update("Processing files...");
    vi.advanceTimersByTime(2000);
    p.succeed("Done analyzing");
    expect(p.getToolCallCount()).toBe(2);
  });

  it("analyze with long message triggers truncation", () => {
    const p = new ProgressTracker();
    p.startPhase("analyze");
    p.update("A".repeat(50));
    p.succeed();
  });

  it("non-analyze phase update", () => {
    const p = new ProgressTracker();
    p.startPhase("scan");
    p.update("50 files");
    p.succeed("Scanned");
  });

  it("succeed on analyze with tool count", () => {
    const p = new ProgressTracker();
    p.startPhase("analyze");
    p.recordToolCall("t1");
    p.succeed();
  });

  it("succeed without current phase", () => {
    const p = new ProgressTracker();
    p.succeed("done");
  });

  it("fail and warn", () => {
    const p = new ProgressTracker();
    p.startPhase("clone");
    p.fail("failed");
    p.startPhase("cleanup");
    p.warn("partial");
  });

  it("update with no phase is noop", () => {
    const p = new ProgressTracker();
    p.update("ignored");
  });

  it("getStats and getElapsedTime", () => {
    const p = new ProgressTracker();
    vi.advanceTimersByTime(1000);
    expect(p.getElapsedTime()).toBe(1000);
    const stats = p.getStats();
    expect(stats.toolCalls).toBe(0);
  });

  it("elapsed >60s formats as minutes", () => {
    const p = new ProgressTracker();
    p.startPhase("analyze");
    vi.advanceTimersByTime(75000);
    p.succeed("Done");
  });

  it("printPhaseOverview", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    ProgressTracker.printPhaseOverview();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("double stop is safe", () => {
    const p = new ProgressTracker();
    p.startPhase("analyze");
    p.stop();
    p.stop();
  });

  it("recordToolCall with Tool: in message", () => {
    const p = new ProgressTracker();
    p.startPhase("analyze");
    p.update("Tool: readFile");
    p.recordToolCall("readFile");
    p.succeed();
  });

  it("startPhase replaces previous phase", () => {
    const p = new ProgressTracker();
    p.startPhase("analyze");
    p.startPhase("generate");
    p.succeed();
  });
});

describe("createProgressBar extra", () => {
  it("works with various values", () => {
    const bar = createProgressBar(100);
    expect(bar(0)).toContain("0%");
    expect(bar(50)).toContain("50%");
    expect(bar(100)).toContain("100%");
    expect(bar(200)).toContain("100%");
  });

  it("works with custom width", () => {
    const bar = createProgressBar(10, 20);
    expect(bar(5)).toContain("50%");
  });
});
