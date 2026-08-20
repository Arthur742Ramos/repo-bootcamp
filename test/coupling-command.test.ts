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
const getKeyFilesForImpactMock = vi.fn();
vi.mock("../src/impact.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/impact.js")>();
  return {
    ...actual,
    buildImportGraph: (...a: any[]) => buildImportGraphMock(...a),
    getKeyFilesForImpact: (...a: any[]) => getKeyFilesForImpactMock(...a),
  };
});

import { runCouplingCommand } from "../src/commands/coupling-command.js";

function node(imports: string[], importedBy: string[]) {
  return { imports, importedBy };
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

describe("runCouplingCommand", () => {
  const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as any);
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockClear();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    scanMock.mockResolvedValue({ files: [], readme: null, stack: {} });
    buildImportGraphMock.mockResolvedValue(
      new Map<string, { imports: string[]; importedBy: string[] }>([
        ["src/types.ts", node([], ["src/a.ts", "src/b.ts", "src/c.ts"])], // fanIn 3
        ["src/a.ts", node(["src/types.ts"], ["src/b.ts"])], // fanIn 1, fanOut 1
        ["src/b.ts", node(["src/types.ts", "src/a.ts", "src/c.ts"], [])], // fanIn 0, fanOut 3 (entry)
        ["src/c.ts", node(["src/types.ts"], ["src/b.ts"])], // fanIn 1, fanOut 1
        ["src/dead.ts", node([], [])], // fanIn 0, fanOut 0 — orphan
        ["src/index.ts", node(["src/b.ts"], [])], // entry
        ["README.md", node([], [])], // non-source → excluded
        ["vitest.config.ts", node([], [])], // config → excluded from orphans
      ])
    );
    getKeyFilesForImpactMock.mockReturnValue(["src/index.ts", "src/b.ts"]);
    resolveRepoMock.mockResolvedValue(remoteSource());
  });

  it("ranks core by fan-in, hubs by fan-out, and flags only genuine orphans (JSON)", async () => {
    await runCouplingCommand("https://github.com/test/repo", { json: true });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(printed);

    expect(parsed.moduleCount).toBe(7); // README.md excluded (non-source); vitest.config.ts counts (.ts)
    expect(parsed.core[0]).toMatchObject({ file: "src/types.ts", fanIn: 3 });
    expect(parsed.hubs[0]).toMatchObject({ file: "src/b.ts", fanOut: 3 });
    // dead.ts is the only orphan (isolated): b.ts/index.ts import things; config/non-source excluded.
    expect(parsed.orphans).toEqual(["src/dead.ts"]);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("does not flag isolated Go/Python test files as orphaned dead code (JSON)", async () => {
    buildImportGraphMock.mockResolvedValueOnce(
      new Map<string, { imports: string[]; importedBy: string[] }>([
        ["pkg/server.go", node([], ["pkg/handler.go"])], // fanIn 1
        ["pkg/handler.go", node(["pkg/server.go"], [])], // entry
        ["pkg/server_test.go", node([], [])], // isolated Go test - NOT an orphan
        ["app/test_utils.py", node([], [])], // isolated Python test - NOT an orphan
        ["app/widget_test.py", node([], [])], // isolated Python test - NOT an orphan
        ["app/__mocks__/db.py", node([], [])], // mock dir - NOT an orphan
        ["app/legacy.py", node([], [])], // genuine isolated source - orphan
      ])
    );
    await runCouplingCommand("https://github.com/test/repo", { json: true });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(printed);
    // Only the genuine isolated source file is reported; test/mock files excluded.
    expect(parsed.orphans).toEqual(["app/legacy.py"]);
  });

  it("prints a human-readable coupling report", async () => {
    await runCouplingCommand("https://github.com/test/repo", {});
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("Module Coupling");
    expect(printed).toContain("Load-bearing core");
    expect(printed).toContain("src/types.ts");
    expect(printed).toContain("Orchestrators");
  });

  it("keeps the temporary clone with --keep-temp for remote repos", async () => {
    await runCouplingCommand("https://github.com/test/repo", { keepTemp: true });
    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it("exits 1 when the repository cannot be resolved", async () => {
    resolveRepoMock.mockRejectedValueOnce(new Error("nope"));
    await expect(runCouplingCommand("https://github.com/test/repo", {})).rejects.toThrow(
      "process.exit"
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("exits non-zero and cleans up when the graph build fails", async () => {
    buildImportGraphMock.mockRejectedValueOnce(new Error("boom"));
    await expect(runCouplingCommand("https://github.com/test/repo", {})).rejects.toThrow(
      "process.exit"
    );
    expect(mockCleanup).toHaveBeenCalled();
  });
});
