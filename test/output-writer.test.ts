import { describe, it, expect, vi, beforeEach } from "vitest";
import { join, resolve } from "path";

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
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    realpath: vi.fn(async (path: string) => resolve(path)),
  };
});

vi.mock("../src/formatter.js", () => ({
  applyOutputFormat: vi.fn((docs: any[]) => docs),
}));

vi.mock("../src/issues.js", () => ({
  createIssuesFromTasks: vi.fn().mockResolvedValue([]),
  generateIssuePreview: vi.fn().mockReturnValue("# Preview"),
}));

vi.mock("../src/diagrams.js", () => ({
  renderOutputDiagrams: vi.fn().mockResolvedValue({ rendered: true, files: ["/tmp/out/arch.svg"] }),
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

  it("reports the final formatted names once, including formatter-added files", async () => {
    const { applyOutputFormat } = await import("../src/formatter.js");
    vi.mocked(applyOutputFormat).mockReturnValueOnce([
      { name: "WELCOME.html", content: "<h1>Welcome</h1>" },
      { name: "PLUGIN.html", content: "<h1>Plugin</h1>" },
      { name: "WELCOME.html", content: "<h1>Updated</h1>" },
    ]);
    const result = await writeGeneratedOutputs(makeParams({ outputFormat: "html" }));
    expect(result.documentCount).toBe(3);
    expect(result.emittedFiles).toEqual(["WELCOME.html", "PLUGIN.html"]);
    expect(writeFile).toHaveBeenLastCalledWith(
      join("/tmp/out", "WELCOME.html"),
      "<h1>Updated</h1>",
      "utf-8"
    );
  });

  it("reports JSON-only and converted issue-preview writes without advertising unused documents", async () => {
    const { applyOutputFormat } = await import("../src/formatter.js");
    vi.mocked(applyOutputFormat)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ name: "./ISSUES_PREVIEW.html", content: "<h1>Preview</h1>" }]);
    const result = await writeGeneratedOutputs(
      makeParams({
        outputFormat: "html",
        options: { jsonOnly: true, createIssues: true, dryRun: true },
        facts: { firstTasks: [{ title: "Preview only" }] },
      })
    );
    expect(result.emittedFiles).toEqual(["repo_facts.json", "ISSUES_PREVIEW.html"]);
    expect(writeFile).toHaveBeenCalledTimes(2);
  });

  it("includes successfully rendered files even when another diagram fails", async () => {
    const { renderOutputDiagrams } = await import("../src/diagrams.js");
    vi.mocked(renderOutputDiagrams).mockResolvedValueOnce({
      rendered: false,
      files: [join("/tmp/out", "diagrams", "..", "architecture.svg")],
      error: "second diagram failed",
    });
    const result = await writeGeneratedOutputs(makeParams({ options: { renderDiagrams: true } }));
    expect(result.emittedFiles).toEqual(["BOOTCAMP.md", "repo_facts.json", "architecture.svg"]);
  });

  it("keeps output-target delivery separate from local file ownership", async () => {
    const target = { name: "external", writeOutput: vi.fn().mockResolvedValue(undefined) };
    const result = await writeGeneratedOutputs(makeParams({ outputTargets: [target] }));
    expect(result.emittedFiles).toEqual(["BOOTCAMP.md", "repo_facts.json"]);
    expect(target.writeOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: makeParams().documents,
        outputDir: "/tmp/out",
      })
    );
  });

  it("does not return a successful inventory after a failed local write", async () => {
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"));
    await expect(writeGeneratedOutputs(makeParams())).rejects.toThrow("disk full");
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("deduplicates lexical aliases of the actual written destinations", async () => {
    const { applyOutputFormat } = await import("../src/formatter.js");
    vi.mocked(applyOutputFormat).mockReturnValueOnce([
      { name: "BOOTCAMP.html", content: "first" },
      { name: "./BOOTCAMP.html", content: "last" },
      { name: "./summary.json", content: "metadata" },
    ]);
    const result = await writeGeneratedOutputs(makeParams());
    expect(result.documentCount).toBe(3);
    expect(result.emittedFiles).toEqual(["BOOTCAMP.html", "summary.json"]);
    expect(writeFile).toHaveBeenNthCalledWith(
      2,
      join("/tmp/out", "BOOTCAMP.html"),
      "last",
      "utf-8"
    );
  });

  it("keeps literal POSIX backslashes and uses platform separators for Windows names", async () => {
    const result = await writeGeneratedOutputs(
      makeParams({
        documents: [{ name: "notes\\GUIDE.html", content: "guide" }],
      })
    );
    expect(result.emittedFiles).toEqual(
      process.platform === "win32" ? ["notes/GUIDE.html"] : ["notes\\GUIDE.html"]
    );
  });

  it("preserves separate inventory entries when resolved case spellings remain distinct", async () => {
    const { applyOutputFormat } = await import("../src/formatter.js");
    vi.mocked(applyOutputFormat).mockReturnValueOnce([
      { name: "BOOTCAMP.html", content: "first" },
      { name: "bootcamp.html", content: "second" },
    ]);
    const result = await writeGeneratedOutputs(makeParams());
    expect(result.emittedFiles).toEqual(["BOOTCAMP.html", "bootcamp.html"]);
    expect(result.documentCount).toBe(2);
  });
});

describe("issue result propagation", () => {
  it.each([
    [{ success: false }],
    [{ success: true }, { success: false }, { success: true, skipped: true }],
  ])(
    "fails after preserving generated documents when any creation fails: %j",
    async (...results) => {
      const { createIssuesFromTasks } = await import("../src/issues.js");
      vi.clearAllMocks();
      vi.mocked(createIssuesFromTasks).mockResolvedValueOnce(results as any);
      await expect(
        writeGeneratedOutputs(
          makeParams({
            options: { createIssues: true },
            facts: { firstTasks: [{ title: "task" }] },
          })
        )
      ).rejects.toThrow("1 starter issue could not be created");
      expect(writeFile).toHaveBeenCalledWith(join("/tmp/out", "BOOTCAMP.md"), "# Boot", "utf-8");
      expect(writeFile).toHaveBeenCalledWith(
        join("/tmp/out", "repo_facts.json"),
        '{"a":1}',
        "utf-8"
      );
      expect(vi.mocked(writeFile).mock.invocationCallOrder[1]).toBeLessThan(
        vi.mocked(createIssuesFromTasks).mock.invocationCallOrder[0]
      );
    }
  );

  it("accepts successes and skipped existing issues", async () => {
    const { createIssuesFromTasks } = await import("../src/issues.js");
    vi.mocked(createIssuesFromTasks).mockResolvedValueOnce([
      { success: true },
      { success: true, skipped: true },
    ] as any);
    await expect(
      writeGeneratedOutputs(
        makeParams({ options: { createIssues: true }, facts: { firstTasks: [{ title: "task" }] } })
      )
    ).resolves.toEqual({
      documentCount: 2,
      emittedFiles: ["BOOTCAMP.md", "repo_facts.json"],
    });
  });
});
