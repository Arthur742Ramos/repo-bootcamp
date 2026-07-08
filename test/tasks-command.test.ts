import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

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

import { runTasksCommand } from "../src/commands/tasks-command.js";

const dirs: string[] = [];

async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-tasks-cmd-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf-8");
  }
  return dir;
}

function localSource(path: string) {
  return {
    path,
    isLocal: true,
    repoName: "repo",
    repoInfo: { owner: "local", repo: "repo", fullName: "local/repo" },
    cleanup: () => mockCleanup(),
  };
}

describe("runTasksCommand", () => {
  const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as any);
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockClear();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("prints a grouped human report with a getting-started sequence", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({
        scripts: { install: "npm ci", build: "tsc", test: "vitest run" },
      }),
    });
    resolveRepoMock.mockResolvedValue(localSource(dir));

    await runTasksCommand(dir, {});

    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("What Can I Run?");
    expect(out).toContain("Getting started");
    expect(out).toContain("npm run build");
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("emits JSON when --json is set", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({ scripts: { build: "tsc", test: "vitest run" } }),
    });
    resolveRepoMock.mockResolvedValue(localSource(dir));

    await runTasksCommand(dir, { json: true });

    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.repo).toBe("local/repo");
    expect(parsed.category).toBeNull();
    expect(parsed.gettingStarted).toContain("npm run build");
    expect(parsed.tasks.map((t: { name: string }) => t.name)).toEqual(["build", "test"]);
  });

  it("filters by --category", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({ scripts: { build: "tsc", test: "vitest run" } }),
    });
    resolveRepoMock.mockResolvedValue(localSource(dir));

    await runTasksCommand(dir, { json: true, category: "test" });

    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join("\n"));
    expect(parsed.category).toBe("test");
    expect(parsed.tasks.map((t: { name: string }) => t.name)).toEqual(["test"]);
  });

  it("accepts a case-insensitive category", async () => {
    const dir = await repoWith({ "package.json": JSON.stringify({ scripts: { build: "tsc" } }) });
    resolveRepoMock.mockResolvedValue(localSource(dir));

    await runTasksCommand(dir, { json: true, category: "BUILD" });

    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join("\n"));
    expect(parsed.tasks.map((t: { name: string }) => t.name)).toEqual(["build"]);
  });

  it("exits non-zero for an unknown category before resolving the repo", async () => {
    const dir = await repoWith({ "package.json": JSON.stringify({ scripts: { build: "tsc" } }) });
    resolveRepoMock.mockResolvedValue(localSource(dir));

    await expect(runTasksCommand(dir, { category: "bogus" })).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
    // Category is repo-independent, so validation fails fast without cloning.
    expect(resolveRepoMock).not.toHaveBeenCalled();
    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it("reports an empty state when no tasks are discovered", async () => {
    const dir = await repoWith({ "README.md": "nothing runnable" });
    resolveRepoMock.mockResolvedValue(localSource(dir));

    await runTasksCommand(dir, {});

    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("No runnable tasks discovered");
  });

  it("reports an empty state for a category with no matches", async () => {
    const dir = await repoWith({ "package.json": JSON.stringify({ scripts: { build: "tsc" } }) });
    resolveRepoMock.mockResolvedValue(localSource(dir));

    await runTasksCommand(dir, { category: "release" });

    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("No release tasks found");
  });

  it("keeps the temporary clone with --keep-temp for remote repos", async () => {
    const dir = await repoWith({ "package.json": JSON.stringify({ scripts: { build: "tsc" } }) });
    resolveRepoMock.mockResolvedValue({
      path: dir,
      isLocal: false,
      repoName: "repo",
      repoInfo: { owner: "test", repo: "repo", fullName: "test/repo" },
      cleanup: () => mockCleanup(),
    });

    await runTasksCommand("https://github.com/test/repo", { keepTemp: true });
    expect(mockCleanup).not.toHaveBeenCalled();
  });
});
