import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ChangeImpact } from "../src/types.js";

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
const analyzeChangeImpactMock = vi.fn();
const getKeyFilesForImpactMock = vi.fn();
vi.mock("../src/impact.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/impact.js")>();
  return {
    ...actual,
    buildImportGraph: (...a: any[]) => buildImportGraphMock(...a),
    analyzeChangeImpact: (...a: any[]) => analyzeChangeImpactMock(...a),
    getKeyFilesForImpact: (...a: any[]) => getKeyFilesForImpactMock(...a),
  };
});

import { runImpactCommand } from "../src/commands/impact-command.js";

function makeImpact(file: string): ChangeImpact {
  return {
    file,
    affectedFiles: ["src/a.ts", "src/b.ts"],
    affectedTests: ["test/a.test.ts"],
    affectedDocs: ["README.md"],
    importedBy: ["src/a.ts"],
    imports: ["./util.js"],
  };
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

describe("runImpactCommand", () => {
  const mockExit = vi
    .spyOn(process, "exit")
    .mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockClear();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    scanMock.mockResolvedValue({
      files: [
        { path: "src/index.ts", size: 1, isDirectory: false },
        { path: "src/cli.ts", size: 1, isDirectory: false },
      ],
      stack: {},
      readme: null,
      contributing: null,
    });
    buildImportGraphMock.mockResolvedValue(
      new Map([
        ["src/index.ts", { imports: [], importedBy: [] }],
        ["src/cli.ts", { imports: [], importedBy: [] }],
      ])
    );
    getKeyFilesForImpactMock.mockReturnValue(["src/index.ts", "src/cli.ts"]);
    analyzeChangeImpactMock.mockImplementation((_repo: string, _files: unknown, target: string) =>
      Promise.resolve(makeImpact(target))
    );
    resolveRepoMock.mockResolvedValue(remoteSource());
  });

  it("summarizes key files when no file is given", async () => {
    await runImpactCommand("https://github.com/test/repo", undefined, {});
    expect(getKeyFilesForImpactMock).toHaveBeenCalled();
    expect(analyzeChangeImpactMock).toHaveBeenCalledTimes(2);
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("Change Impact");
    expect(printed).toContain("src/index.ts");
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("prints full detail for a specific file", async () => {
    await runImpactCommand("https://github.com/test/repo", "src/cli.ts", {});
    expect(analyzeChangeImpactMock).toHaveBeenCalledTimes(1);
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("Imported by");
    expect(printed).toContain("Affected tests");
    expect(printed).toContain("test/a.test.ts");
  });

  it("limits key files analyzed to --top", async () => {
    getKeyFilesForImpactMock.mockReturnValue(["a.ts", "b.ts", "c.ts", "d.ts"]);
    await runImpactCommand("https://github.com/test/repo", undefined, { top: 2 });
    expect(analyzeChangeImpactMock).toHaveBeenCalledTimes(2);
  });

  it("emits impact JSON with --json", async () => {
    await runImpactCommand("https://github.com/test/repo", "src/cli.ts", { json: true });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.repo).toBe("test/repo");
    expect(parsed.impacts).toHaveLength(1);
    expect(parsed.impacts[0].file).toBe("src/cli.ts");
  });

  it("normalizes a ./-prefixed file path against the scan keys", async () => {
    await runImpactCommand("https://github.com/test/repo", "./src/cli.ts", {});
    expect(analyzeChangeImpactMock).toHaveBeenCalledWith(
      "/tmp/cloned-repo",
      expect.anything(),
      "src/cli.ts",
      expect.anything()
    );
  });

  it("exits 1 (and still cleans up) when the file is not in the scan", async () => {
    await expect(
      runImpactCommand("https://github.com/test/repo", "nope/missing.ts", {})
    ).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("prints a friendly message when there are no key files", async () => {
    getKeyFilesForImpactMock.mockReturnValue([]);
    await runImpactCommand("https://github.com/test/repo", undefined, {});
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("No key source files");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("keeps the temporary clone with --keep-temp for remote repos", async () => {
    await runImpactCommand("https://github.com/test/repo", "src/cli.ts", { keepTemp: true });
    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it("exits non-zero and cleans up when the scan fails", async () => {
    scanMock.mockRejectedValueOnce(new Error("scan boom"));
    await expect(
      runImpactCommand("https://github.com/test/repo", undefined, {})
    ).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("exits 1 when the repository cannot be resolved", async () => {
    resolveRepoMock.mockRejectedValueOnce(new Error("nope"));
    await expect(
      runImpactCommand("https://github.com/test/repo", undefined, {})
    ).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
