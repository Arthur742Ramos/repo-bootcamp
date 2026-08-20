import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("chalk", () => {
  const makeChalk = (): any =>
    new Proxy((...args: any[]) => args.join(""), {
      get: () => makeChalk(),
      apply: (_t: any, _a: any, args: any[]) => args.join(""),
    });
  return { default: makeChalk() };
});

vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return { ...actual, writeFile: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("../src/formatter.js", () => ({
  applyOutputFormat: vi.fn((docs: any[]) => docs),
}));

vi.mock("../src/issues.js", () => ({
  createIssuesFromTasks: vi.fn().mockResolvedValue(undefined),
  generateIssuePreview: vi.fn().mockReturnValue("# Preview"),
}));

vi.mock("../src/diagrams.js", () => ({
  renderOutputDiagrams: vi.fn().mockResolvedValue({ rendered: true, files: ["arch.svg"] }),
}));

vi.mock("../src/progress.js", () => ({
  ProgressTracker: vi.fn().mockImplementation(() => ({
    startPhase: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    update: vi.fn(),
    stop: vi.fn(),
  })),
}));

import { writeGeneratedOutputs } from "../src/services/output-writer.js";
import { writeFile } from "fs/promises";

function makeParams(overrides: any = {}) {
  return {
    documents: [
      { name: "BOOTCAMP.md", content: "# Boot" },
      { name: "repo_facts.json", content: '{"a":1}' },
    ],
    repoInfo: { owner: "t", repo: "r", fullName: "t/r" },
    facts: { firstTasks: [] } as any,
    options: {} as any,
    outputDir: "/tmp/out",
    outputFormat: "markdown" as any,
    progress: { update: vi.fn() } as any,
    ...overrides,
  };
}

describe("writeGeneratedOutputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes all documents", async () => {
    const result = await writeGeneratedOutputs(makeParams());
    expect(result.documentCount).toBe(2);
    expect(writeFile).toHaveBeenCalledTimes(2);
  });

  it("writes only JSON in jsonOnly mode", async () => {
    const result = await writeGeneratedOutputs(makeParams({ options: { jsonOnly: true } }));
    expect(result.documentCount).toBe(1);
  });

  it("creates issue preview in dryRun mode", async () => {
    const { generateIssuePreview } = await import("../src/issues.js");
    await writeGeneratedOutputs(
      makeParams({
        options: { createIssues: true, dryRun: true },
        facts: { firstTasks: [{ title: "task1" }] },
      })
    );
    expect(generateIssuePreview).toHaveBeenCalled();
  });

  it("creates real issues when not dryRun", async () => {
    const { createIssuesFromTasks } = await import("../src/issues.js");
    await writeGeneratedOutputs(
      makeParams({
        options: { createIssues: true },
        facts: { firstTasks: [{ title: "task1" }] },
      })
    );
    expect(createIssuesFromTasks).toHaveBeenCalled();
  });

  it("renders diagrams when option set", async () => {
    const { renderOutputDiagrams } = await import("../src/diagrams.js");
    await writeGeneratedOutputs(makeParams({ options: { renderDiagrams: true } }));
    expect(renderOutputDiagrams).toHaveBeenCalled();
  });

  it("handles diagram rendering error", async () => {
    const { renderOutputDiagrams } = await import("../src/diagrams.js");
    (renderOutputDiagrams as any).mockResolvedValueOnce({
      rendered: false,
      error: "no mermaid",
      files: [],
    });
    await writeGeneratedOutputs(makeParams({ options: { renderDiagrams: true } }));
  });

  it("runs output target plugins", async () => {
    const mockPlugin = { name: "test-plugin", writeOutput: vi.fn().mockResolvedValue(undefined) };
    await writeGeneratedOutputs(makeParams({ outputTargets: [mockPlugin] }));
    expect(mockPlugin.writeOutput).toHaveBeenCalled();
  });

  it("handles output target plugin failure gracefully", async () => {
    const mockPlugin = {
      name: "fail-plugin",
      writeOutput: vi.fn().mockRejectedValue(new Error("fail")),
    };
    await writeGeneratedOutputs(makeParams({ outputTargets: [mockPlugin] }));
    // Should not throw
  });

  it("skips issue creation when allowIssueCreation is false", async () => {
    const { createIssuesFromTasks } = await import("../src/issues.js");
    await writeGeneratedOutputs(
      makeParams({
        options: { createIssues: true },
        facts: { firstTasks: [{ title: "task1" }] },
        allowIssueCreation: false,
      })
    );
    expect(createIssuesFromTasks).not.toHaveBeenCalled();
  });
});
