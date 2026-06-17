import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("chalk", () => {
  const makeChalk = (): any =>
    new Proxy((...args: any[]) => args.join(""), {
      get: () => makeChalk(),
      apply: (_t: any, _a: any, args: any[]) => args.join(""),
    });
  return { default: makeChalk() };
});

const mockCleanup = vi.fn().mockResolvedValue(undefined);
const resolveRepoMock = vi.fn();
vi.mock("../src/repo-resolver.js", () => ({
  resolveRepo: (...args: any[]) => resolveRepoMock(...args),
}));

const scanMock = vi.fn();
vi.mock("../src/services/clone-service.js", () => ({
  scanRepositoryFiles: (...args: any[]) => scanMock(...args),
}));

const buildImportGraphMock = vi.fn();
vi.mock("../src/impact.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/impact.js")>();
  return {
    ...actual,
    buildImportGraph: (...a: any[]) => buildImportGraphMock(...a),
  };
});

import { runCyclesCommand } from "../src/commands/cycles-command.js";

/** A graph node — only `imports` matters for cycle detection. */
function node(imports: string[]) {
  return { imports, importedBy: [] };
}

function graphOf(entries: Record<string, string[]>) {
  return new Map(Object.entries(entries).map(([file, imports]) => [file, node(imports)]));
}

function remoteSource() {
  return {
    path: "/tmp/cloned-repo",
    isLocal: false,
    repoName: "repo",
    repoInfo: { owner: "test", repo: "repo", fullName: "test/repo" },
    cleanup: () => mockCleanup(),
  };
}

describe("runCyclesCommand", () => {
  const mockExit = vi
    .spyOn(process, "exit")
    .mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockClear();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    scanMock.mockResolvedValue({ files: [], readme: null, stack: {} });
    resolveRepoMock.mockResolvedValue(remoteSource());
  });

  function jsonOut(): any {
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    return JSON.parse(printed);
  }

  it("detects a simple two-module cycle (JSON)", async () => {
    buildImportGraphMock.mockResolvedValueOnce(
      graphOf({ "src/a.ts": ["src/b.ts"], "src/b.ts": ["src/a.ts"] })
    );
    await runCyclesCommand("https://github.com/test/repo", { json: true });
    const out = jsonOut();
    expect(out.cycleCount).toBe(1);
    expect(out.largestCycleSize).toBe(2);
    expect(out.moduleCount).toBe(2);
    expect(out.cycles).toEqual([{ size: 2, files: ["src/a.ts", "src/b.ts"] }]);
  });

  it("renders a closed ring for a 3-node cycle in the human report", async () => {
    buildImportGraphMock.mockResolvedValueOnce(
      graphOf({ "src/a.ts": ["src/b.ts"], "src/b.ts": ["src/c.ts"], "src/c.ts": ["src/a.ts"] })
    );
    await runCyclesCommand("https://github.com/test/repo", {});
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("Circular Dependencies");
    expect(printed).toContain("src/a.ts → src/b.ts → src/c.ts → src/a.ts");
  });

  it("reports no cycles for an acyclic graph and exits 0", async () => {
    buildImportGraphMock.mockResolvedValueOnce(
      graphOf({ "src/a.ts": ["src/b.ts", "src/c.ts"], "src/b.ts": ["src/c.ts"], "src/c.ts": [] })
    );
    await runCyclesCommand("https://github.com/test/repo", {});
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("No circular dependencies found");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("flags a self-import as a size-1 cycle", async () => {
    buildImportGraphMock.mockResolvedValueOnce(graphOf({ "src/x.ts": ["src/x.ts"] }));
    await runCyclesCommand("https://github.com/test/repo", { json: true });
    const out = jsonOut();
    expect(out.cycles).toEqual([{ size: 1, files: ["src/x.ts"] }]);
  });

  it("sorts two disjoint cycles by size descending (JSON)", async () => {
    buildImportGraphMock.mockResolvedValueOnce(
      graphOf({
        "src/a.ts": ["src/b.ts"],
        "src/b.ts": ["src/c.ts"],
        "src/c.ts": ["src/a.ts"],
        "src/x.ts": ["src/y.ts"],
        "src/y.ts": ["src/x.ts"],
      })
    );
    await runCyclesCommand("https://github.com/test/repo", { json: true });
    const out = jsonOut();
    expect(out.cycles.map((c: any) => c.size)).toEqual([3, 2]);
    expect(out.cycles[0].files).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(out.cycles[1].files).toEqual(["src/x.ts", "src/y.ts"]);
  });

  it("excludes test files so only the real cycle is reported", async () => {
    buildImportGraphMock.mockResolvedValueOnce(
      graphOf({
        // Real source cycle.
        "src/a.ts": ["src/b.ts"],
        "src/b.ts": ["src/a.ts"],
        // Test-only cycle — must be ignored.
        "src/a.test.ts": ["src/b.test.ts"],
        "src/b.test.ts": ["src/a.test.ts"],
      })
    );
    await runCyclesCommand("https://github.com/test/repo", { json: true });
    const out = jsonOut();
    expect(out.cycles).toEqual([{ size: 2, files: ["src/a.ts", "src/b.ts"] }]);
    // Test modules are not counted.
    expect(out.moduleCount).toBe(2);
  });

  it("ignores non-source modules in the graph", async () => {
    buildImportGraphMock.mockResolvedValueOnce(
      graphOf({
        "src/a.ts": ["src/b.ts"],
        "src/b.ts": ["src/a.ts"],
        "README.md": [],
        "data.json": [],
      })
    );
    await runCyclesCommand("https://github.com/test/repo", { json: true });
    expect(jsonOut().moduleCount).toBe(2);
  });

  it("exits 1 under --check when any cycle exists", async () => {
    buildImportGraphMock.mockResolvedValueOnce(
      graphOf({ "src/a.ts": ["src/b.ts"], "src/b.ts": ["src/a.ts"] })
    );
    await expect(
      runCyclesCommand("https://github.com/test/repo", { check: true })
    ).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("passes --check when cycles are within --max-cycles", async () => {
    buildImportGraphMock.mockResolvedValueOnce(
      graphOf({ "src/a.ts": ["src/b.ts"], "src/b.ts": ["src/a.ts"] })
    );
    await runCyclesCommand("https://github.com/test/repo", { check: true, maxCycles: 1 });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("fails --check when cycles exceed --max-cycles", async () => {
    buildImportGraphMock.mockResolvedValueOnce(
      graphOf({
        "src/a.ts": ["src/b.ts"],
        "src/b.ts": ["src/a.ts"],
        "src/x.ts": ["src/y.ts"],
        "src/y.ts": ["src/x.ts"],
      })
    );
    await expect(
      runCyclesCommand("https://github.com/test/repo", { check: true, maxCycles: 1 })
    ).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("handles an empty repository without crashing", async () => {
    buildImportGraphMock.mockResolvedValueOnce(new Map());
    await runCyclesCommand("https://github.com/test/repo", { json: true });
    const out = jsonOut();
    expect(out.moduleCount).toBe(0);
    expect(out.cycleCount).toBe(0);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("keeps the temporary clone with --keep-temp for remote repos", async () => {
    buildImportGraphMock.mockResolvedValueOnce(new Map());
    await runCyclesCommand("https://github.com/test/repo", { keepTemp: true });
    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it("keeps stdout valid JSON when --json is combined with --keep-temp", async () => {
    buildImportGraphMock.mockResolvedValueOnce(
      graphOf({ "src/a.ts": ["src/b.ts"], "src/b.ts": ["src/a.ts"] })
    );
    await runCyclesCommand("https://github.com/test/repo", { json: true, keepTemp: true });
    // stdout must be parseable JSON — the keep-temp note goes to stderr.
    const out = jsonOut();
    expect(out.cycleCount).toBe(1);
    const stdout = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).not.toContain("Temporary clone kept");
    const stderr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("Temporary clone kept");
  });

  it("exits 1 when the repository cannot be resolved", async () => {
    resolveRepoMock.mockRejectedValueOnce(new Error("nope"));
    await expect(
      runCyclesCommand("https://github.com/test/repo", {})
    ).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("exits non-zero and cleans up when the graph build fails", async () => {
    buildImportGraphMock.mockRejectedValueOnce(new Error("boom"));
    await expect(
      runCyclesCommand("https://github.com/test/repo", {})
    ).rejects.toThrow("process.exit");
    expect(mockCleanup).toHaveBeenCalled();
  });
});
