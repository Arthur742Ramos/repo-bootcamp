import { describe, it, expect, vi, beforeEach } from "vitest";

import type { DependencyAnalysis } from "../src/deps.js";

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

const extractDependenciesMock = vi.fn();
vi.mock("../src/deps.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/deps.js")>();
  return { ...actual, extractDependencies: (...a: any[]) => extractDependenciesMock(...a) };
});

import { runDepsCommand } from "../src/commands/deps-command.js";

function makeDeps(): DependencyAnalysis {
  return {
    packageManager: "npm",
    totalCount: 5,
    runtime: [
      { name: "express", version: "^5.0.0", type: "runtime" },
      { name: "zod", version: "^4.0.0", type: "runtime" },
    ],
    dev: [
      { name: "vitest", version: "^4.0.0", type: "dev" },
      { name: "typescript", version: "^6.0.0", type: "dev" },
      { name: "eslint", version: "^10.0.0", type: "dev" },
    ],
    peer: [],
    categories: [{ name: "Testing", deps: ["vitest"] }],
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

describe("runDepsCommand", () => {
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
    extractDependenciesMock.mockResolvedValue(makeDeps());
    resolveRepoMock.mockResolvedValue(remoteSource());
  });

  it("prints a human-readable report and cleans up", async () => {
    await runDepsCommand("https://github.com/test/repo", {});
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("Dependencies");
    expect(printed).toContain("express");
    expect(printed).toContain("vitest");
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("emits JSON with counts and full lists with --json", async () => {
    await runDepsCommand("https://github.com/test/repo", { json: true });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.repo).toBe("test/repo");
    expect(parsed.packageManager).toBe("npm");
    expect(parsed.counts).toEqual({ runtime: 2, dev: 3, peer: 0 });
    expect(parsed.runtime).toHaveLength(2);
    expect(parsed.categories[0].name).toBe("Testing");
  });

  it("prints a Mermaid graph with --diagram", async () => {
    await runDepsCommand("https://github.com/test/repo", { diagram: true });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("graph TD");
    expect(printed).toContain("repo");
  });

  it("reports gracefully when no manifest is found (human)", async () => {
    extractDependenciesMock.mockResolvedValue(null);
    await runDepsCommand("https://github.com/test/repo", {});
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("No recognized dependency manifest");
    expect(mockCleanup).toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("emits null dependencies as JSON when no manifest is found", async () => {
    extractDependenciesMock.mockResolvedValue(null);
    await runDepsCommand("https://github.com/test/repo", { json: true });
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.dependencies).toBeNull();
  });

  it("keeps the temporary clone with --keep-temp for remote repos", async () => {
    await runDepsCommand("https://github.com/test/repo", { keepTemp: true });
    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it("exits non-zero and cleans up when extraction throws", async () => {
    extractDependenciesMock.mockRejectedValueOnce(new Error("boom"));
    await expect(runDepsCommand("https://github.com/test/repo", {})).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("exits 1 when the repository cannot be resolved", async () => {
    resolveRepoMock.mockRejectedValueOnce(new Error("nope"));
    await expect(runDepsCommand("https://github.com/test/repo", {})).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
