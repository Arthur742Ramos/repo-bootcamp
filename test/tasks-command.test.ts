import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
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

  it("discovers only selected package tasks across Node, Make, and local Task includes", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({ scripts: { "root-test": "echo root" } }),
      Makefile: "root-build:\n\t@echo root\n",
      "Taskfile.yml": "version: '3'\ntasks:\n  root-task:\n    cmds: []\n",
      "packages/app/package.json": JSON.stringify({ scripts: { "child-test": "echo child" } }),
      "packages/app/Makefile": "child-build:\n\t@echo child\n",
      "packages/app/Taskfile.yml": "version: '3'\nincludes:\n  tools: ./taskfiles/tools.yml\n",
      "packages/app/taskfiles/tools.yml": "version: '3'\ntasks:\n  verify:\n    cmds: []\n",
    });
    resolveRepoMock.mockResolvedValue(localSource(dir));
    await runTasksCommand(dir, { json: true, subdir: " ./packages/app/ " });
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join("\n"));
    expect(parsed.repo).toBe("local/repo");
    expect(parsed.subdir).toBe("packages/app");
    expect(parsed.tasks.map((t: { command: string }) => t.command)).toEqual([
      "npm run child-test",
      "make child-build",
      "task tools:verify",
    ]);
    expect(parsed.gettingStarted).toContain("make child-build");
    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  it("shows the selected working directory in human output", async () => {
    const dir = await repoWith({ "packages/app/Makefile": "child-build:\n\t@echo child\n" });
    resolveRepoMock.mockResolvedValue(localSource(dir));
    await runTasksCommand(dir, { subdir: "packages/app" });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Run these commands from: packages/app");
    expect(out).toContain("make child-build");
  });

  it.each(["../outside", "/outside"])(
    "rejects invalid scope %s before repository resolution",
    async (subdir) => {
      await expect(
        runTasksCommand("https://github.com/test/repo", { subdir, json: true })
      ).rejects.toThrow("process.exit");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid subdir"));
      expect(resolveRepoMock).not.toHaveBeenCalled();
      expect(mockCleanup).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    }
  );

  it.each(["missing", "file.txt"])(
    "cleans the outer checkout after rejecting selected %s",
    async (subdir) => {
      const dir = await repoWith({ "file.txt": "owned" });
      resolveRepoMock.mockResolvedValue({ ...localSource(dir), isLocal: false });
      await expect(
        runTasksCommand("https://github.com/test/repo", { subdir, json: true })
      ).rejects.toThrow("process.exit");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(subdir));
      expect(mockCleanup).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
    }
  );

  it("honors keep-temp on a scoped failure and keeps JSON stdout empty", async () => {
    const dir = await repoWith({ "README.md": "owned" });
    resolveRepoMock.mockResolvedValue({ ...localSource(dir), isLocal: false });
    await expect(
      runTasksCommand("https://github.com/test/repo", {
        subdir: "missing",
        json: true,
        keepTemp: true,
      })
    ).rejects.toThrow("process.exit");
    expect(mockCleanup).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Temporary clone kept at:"));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("accepts a contained alias and rejects an alias outside the selected repository", async () => {
    const dir = await repoWith({ "packages/app/Makefile": "child-build:\n\t@echo child\n" });
    const outside = await repoWith({ Makefile: "outside-build:\n\t@echo outside\n" });
    await symlink(
      join(dir, "packages/app"),
      join(dir, "alias"),
      process.platform === "win32" ? "junction" : "dir"
    );
    await symlink(
      outside,
      join(dir, "outside-alias"),
      process.platform === "win32" ? "junction" : "dir"
    );
    resolveRepoMock.mockResolvedValue(localSource(dir));
    await runTasksCommand(dir, { subdir: "alias", json: true });
    expect(JSON.parse(String(logSpy.mock.calls[0][0])).tasks[0].command).toBe("make child-build");
    logSpy.mockClear();
    await expect(runTasksCommand(dir, { subdir: "outside-alias", json: true })).rejects.toThrow(
      "process.exit"
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("escapes repository root"));
    expect(logSpy).not.toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalledTimes(2);
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
