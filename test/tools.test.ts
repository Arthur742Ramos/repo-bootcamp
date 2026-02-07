/**
 * Tests for tools.ts - Copilot SDK tool factories
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "path";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

import { readFile, readdir, stat } from "fs/promises";
import { exec, execFile } from "child_process";
import { getRepoTools, type ToolContext } from "../src/tools.js";

const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);
const mockExec = vi.mocked(exec);
const mockExecFile = vi.mocked(execFile);

function makeContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    repoPath: "/test/repo",
    verbose: false,
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    ...overrides,
  };
}

// Helper: get a specific tool by name from the tools array
function getTool(context: ToolContext, name: string) {
  const tools = getRepoTools(context);
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("getRepoTools", () => {
  it("returns all four tools", () => {
    const tools = getRepoTools(makeContext());
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("list_files");
    expect(names).toContain("search");
    expect(names).toContain("get_repo_metadata");
  });

  it("all tools have descriptions and handlers", () => {
    const tools = getRepoTools(makeContext());
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(typeof tool.handler).toBe("function");
    }
  });
});

describe("read_file tool", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reads a file successfully", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "read_file");
    mockReadFile.mockResolvedValue("line1\nline2\nline3");

    const result = await tool.handler({ path: "src/index.ts" }, {} as any);

    expect(mockReadFile).toHaveBeenCalledWith(
      join("/test/repo", "src/index.ts"),
      "utf-8",
    );
    expect(result).toEqual({
      textResultForLlm: "line1\nline2\nline3",
      resultType: "success",
    });
    expect(ctx.onToolCall).toHaveBeenCalledWith("read_file", {
      path: "src/index.ts",
    });
    expect(ctx.onToolResult).toHaveBeenCalledWith(
      "read_file",
      "Read 3 lines from src/index.ts",
    );
  });

  it("truncates long files to default maxLines (500)", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "read_file");
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`);
    mockReadFile.mockResolvedValue(lines.join("\n"));

    const result = await tool.handler({ path: "big.ts" }, {} as any);

    const expected = lines.slice(0, 500).join("\n");
    expect((result as any).textResultForLlm).toBe(
      `${expected}\n\n... (truncated, showing 500 of 600 lines)`,
    );
    expect((result as any).resultType).toBe("success");
  });

  it("truncates to custom maxLines", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "read_file");
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    mockReadFile.mockResolvedValue(lines.join("\n"));

    const result = await tool.handler(
      { path: "file.ts", maxLines: 5 },
      {} as any,
    );

    const expected = lines.slice(0, 5).join("\n");
    expect((result as any).textResultForLlm).toBe(
      `${expected}\n\n... (truncated, showing 5 of 20 lines)`,
    );
  });

  it("does not truncate when lines <= maxLines", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "read_file");
    mockReadFile.mockResolvedValue("a\nb\nc");

    const result = await tool.handler(
      { path: "short.ts", maxLines: 10 },
      {} as any,
    );

    expect((result as any).textResultForLlm).toBe("a\nb\nc");
    expect((result as any).resultType).toBe("success");
  });

  it("handles file not found error", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "read_file");
    mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));

    const result = await tool.handler({ path: "missing.ts" }, {} as any);

    expect(result).toEqual({
      textResultForLlm:
        "Error reading file missing.ts: ENOENT: no such file",
      resultType: "failure",
    });
    expect(ctx.onToolResult).toHaveBeenCalledWith(
      "read_file",
      "Error reading file missing.ts: ENOENT: no such file",
    );
  });

  it("reads an empty file", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "read_file");
    mockReadFile.mockResolvedValue("");

    const result = await tool.handler({ path: "empty.ts" }, {} as any);

    expect((result as any).textResultForLlm).toBe("");
    expect((result as any).resultType).toBe("success");
  });

  it("works without callbacks", async () => {
    const ctx = makeContext({ onToolCall: undefined, onToolResult: undefined });
    const tool = getTool(ctx, "read_file");
    mockReadFile.mockResolvedValue("content");

    const result = await tool.handler({ path: "file.ts" }, {} as any);

    expect((result as any).resultType).toBe("success");
  });
});

describe("list_files tool", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function makeDirent(name: string, isDir: boolean) {
    return {
      name,
      isDirectory: () => isDir,
      isFile: () => !isDir,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      isSymbolicLink: () => false,
      path: "",
      parentPath: "",
    };
  }

  it("lists files and directories at root", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "list_files");
    mockReaddir.mockResolvedValue([
      makeDirent("src", true),
      makeDirent("package.json", false),
      makeDirent("README.md", false),
    ] as any);

    const result = await tool.handler({}, {} as any);

    expect((result as any).resultType).toBe("success");
    expect((result as any).textResultForLlm).toContain("[dir]  src");
    expect((result as any).textResultForLlm).toContain("[file] package.json");
    expect((result as any).textResultForLlm).toContain("[file] README.md");
    expect(ctx.onToolCall).toHaveBeenCalledWith("list_files", {
      path: "",
      pattern: undefined,
      recursive: false,
    });
  });

  it("lists files in a subdirectory", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "list_files");
    mockReaddir.mockResolvedValue([
      makeDirent("index.ts", false),
      makeDirent("utils.ts", false),
    ] as any);

    const result = await tool.handler({ path: "src" }, {} as any);

    expect((result as any).resultType).toBe("success");
    expect((result as any).textResultForLlm).toContain("[file] src/index.ts");
    expect((result as any).textResultForLlm).toContain("[file] src/utils.ts");
  });

  it("skips ignored directories", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "list_files");
    mockReaddir.mockResolvedValue([
      makeDirent("node_modules", true),
      makeDirent(".git", true),
      makeDirent("dist", true),
      makeDirent("src", true),
      makeDirent("index.ts", false),
    ] as any);

    const result = await tool.handler({}, {} as any);

    expect((result as any).textResultForLlm).not.toContain("node_modules");
    expect((result as any).textResultForLlm).not.toContain(".git");
    expect((result as any).textResultForLlm).not.toContain("[dir]  dist");
    expect((result as any).textResultForLlm).toContain("[dir]  src");
    expect((result as any).textResultForLlm).toContain("[file] index.ts");
  });

  it("filters by pattern", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "list_files");
    mockReaddir.mockResolvedValue([
      makeDirent("index.ts", false),
      makeDirent("utils.ts", false),
      makeDirent("README.md", false),
    ] as any);

    const result = await tool.handler({ pattern: "*.ts" }, {} as any);

    expect((result as any).textResultForLlm).toContain("index.ts");
    expect((result as any).textResultForLlm).toContain("utils.ts");
    expect((result as any).textResultForLlm).not.toContain("README.md");
  });

  it("respects maxResults limit", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "list_files");
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeDirent(`file${i}.ts`, false),
    );
    mockReaddir.mockResolvedValue(entries as any);

    const result = await tool.handler({ maxResults: 3 }, {} as any);

    const lines = (result as any).textResultForLlm.split("\n");
    expect(lines).toHaveLength(3);
  });

  it("stops recursion when maxResults is reached", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "list_files");

    mockReaddir.mockResolvedValueOnce([
      makeDirent("src", true),
    ] as any);
    mockReaddir.mockRejectedValueOnce(new Error("should not be called"));

    const result = await tool.handler({ recursive: true, maxResults: 1 }, {} as any);

    expect((result as any).resultType).toBe("success");
    expect((result as any).textResultForLlm).toContain("[dir]  src");
    expect(mockReaddir).toHaveBeenCalledTimes(1);
  });

  it("returns message when no files match", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "list_files");
    mockReaddir.mockResolvedValue([
      makeDirent("README.md", false),
    ] as any);

    const result = await tool.handler({ pattern: "*.py" }, {} as any);

    expect((result as any).textResultForLlm).toBe(
      "No files found matching criteria",
    );
  });

  it("handles error reading directory", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "list_files");
    mockReaddir.mockRejectedValue(new Error("ENOENT: no such directory"));

    const result = await tool.handler({ path: "nonexistent" }, {} as any);

    expect((result as any).resultType).toBe("failure");
    expect((result as any).textResultForLlm).toContain(
      "Error listing files in nonexistent",
    );
  });

  it("scans recursively", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "list_files");

    // First call: root dir
    mockReaddir.mockResolvedValueOnce([
      makeDirent("src", true),
      makeDirent("file.ts", false),
    ] as any);
    // Second call: src dir
    mockReaddir.mockResolvedValueOnce([
      makeDirent("index.ts", false),
    ] as any);

    const result = await tool.handler({ recursive: true }, {} as any);

    expect((result as any).resultType).toBe("success");
    expect((result as any).textResultForLlm).toContain("[dir]  src");
    expect((result as any).textResultForLlm).toContain("[file] file.ts");
    expect((result as any).textResultForLlm).toContain("[file] src/index.ts");
  });

  it("recurses into non-matching directories when pattern is set", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "list_files");

    // Root: has a dir that doesn't match pattern
    mockReaddir.mockResolvedValueOnce([
      makeDirent("lib", true),
    ] as any);
    // lib dir: has a matching file
    mockReaddir.mockResolvedValueOnce([
      makeDirent("helper.ts", false),
    ] as any);

    const result = await tool.handler(
      { pattern: "*.ts", recursive: true },
      {} as any,
    );

    expect((result as any).textResultForLlm).toContain("lib/helper.ts");
  });

  it("works without callbacks", async () => {
    const ctx = makeContext({ onToolCall: undefined, onToolResult: undefined });
    const tool = getTool(ctx, "list_files");
    mockReaddir.mockResolvedValue([makeDirent("a.ts", false)] as any);

    const result = await tool.handler({}, {} as any);

    expect((result as any).resultType).toBe("success");
  });
});

describe("search tool", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // execFile is promisified, so mock must call the callback
  function mockExecFileSuccess(stdout: string) {
    mockExecFile.mockImplementation(
      (_cmd: any, _args: any, _opts: any, cb?: any) => {
        const callback = cb || _opts;
        if (typeof callback === "function") {
          callback(null, { stdout, stderr: "" });
        }
        return {} as any;
      },
    );
  }

  function mockExecFileError(error: { message: string; code?: number }) {
    mockExecFile.mockImplementation(
      (_cmd: any, _args: any, _opts: any, cb?: any) => {
        const callback = cb || _opts;
        if (typeof callback === "function") {
          callback(error);
        }
        return {} as any;
      },
    );
  }

  it("searches with basic pattern", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "search");
    mockExecFileSuccess(
      "/test/repo/src/index.ts:1:import foo\n/test/repo/src/utils.ts:5:const foo = 1\n",
    );

    const result = await tool.handler({ pattern: "foo" }, {} as any);

    expect((result as any).resultType).toBe("success");
    expect((result as any).textResultForLlm).toContain("src/index.ts:1:import foo");
    expect((result as any).textResultForLlm).toContain("src/utils.ts:5:const foo = 1");
    expect(ctx.onToolCall).toHaveBeenCalledWith("search", {
      pattern: "foo",
      path: "",
      filePattern: undefined,
    });
  });

  it("passes file pattern to ripgrep as --glob", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "search");
    mockExecFileSuccess("/test/repo/src/app.ts:2:export class App\n");

    await tool.handler(
      { pattern: "class", filePattern: "*.ts" },
      {} as any,
    );

    // Verify execFile was called with --glob *.ts in args
    const call = mockExecFile.mock.calls[0];
    const args = call[1] as string[];
    expect(args).toContain("--glob");
    expect(args).toContain("*.ts");
  });

  it("passes maxResults to ripgrep as --max-count", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "search");
    mockExecFileSuccess("/test/repo/file.ts:1:match\n");

    await tool.handler(
      { pattern: "match", maxResults: 10 },
      {} as any,
    );

    const call = mockExecFile.mock.calls[0];
    const args = call[1] as string[];
    expect(args).toContain("--max-count");
    expect(args).toContain("10");
  });

  it("searches in a subdirectory", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "search");
    mockExecFileSuccess("/test/repo/src/a.ts:1:hello\n");

    await tool.handler({ pattern: "hello", path: "src" }, {} as any);

    const call = mockExecFile.mock.calls[0];
    const args = call[1] as string[];
    expect(args).toContain(join("/test/repo", "src"));
  });

  it("returns no matches message when ripgrep exits with code 1", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "search");
    mockExecFileError({ message: "No matches", code: 1 });

    const result = await tool.handler({ pattern: "nonexistent" }, {} as any);

    expect((result as any).resultType).toBe("success");
    expect((result as any).textResultForLlm).toBe(
      "No matches found for pattern: nonexistent",
    );
  });

  it("returns failure on ripgrep error (non-code-1)", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "search");
    mockExecFileError({ message: "ripgrep not found", code: 127 });

    const result = await tool.handler({ pattern: "test" }, {} as any);

    expect((result as any).resultType).toBe("failure");
    expect((result as any).textResultForLlm).toContain("Error searching");
  });

  it("returns no matches message for empty stdout", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "search");
    mockExecFileSuccess("");

    const result = await tool.handler({ pattern: "nothing" }, {} as any);

    expect((result as any).textResultForLlm).toBe(
      "No matches found for pattern: nothing",
    );
  });

  it("makes paths relative in output", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "search");
    mockExecFileSuccess(
      "/test/repo/deep/nested/file.ts:42:found it\n",
    );

    const result = await tool.handler({ pattern: "found" }, {} as any);

    expect((result as any).textResultForLlm).toBe(
      "deep/nested/file.ts:42:found it",
    );
  });

  it("works without callbacks", async () => {
    const ctx = makeContext({ onToolCall: undefined, onToolResult: undefined });
    const tool = getTool(ctx, "search");
    mockExecFileSuccess("/test/repo/a.ts:1:x\n");

    const result = await tool.handler({ pattern: "x" }, {} as any);

    expect((result as any).resultType).toBe("success");
  });
});

describe("get_repo_metadata tool", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function makeDirent(name: string, isDir: boolean) {
    return {
      name,
      isDirectory: () => isDir,
      isFile: () => !isDir,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      isSymbolicLink: () => false,
      path: "",
      parentPath: "",
    };
  }

  function mockExecSuccess(stdout: string) {
    return (_cmd: any, _opts: any, cb?: any) => {
      const callback = cb || _opts;
      if (typeof callback === "function") {
        callback(null, { stdout, stderr: "" });
      }
      return {} as any;
    };
  }

  it("collects repo metadata successfully", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "get_repo_metadata");

    // readdir for root
    mockReaddir.mockResolvedValueOnce([
      makeDirent("index.ts", false),
      makeDirent("utils.js", false),
    ] as any);

    // stat for each file
    mockStat.mockResolvedValueOnce({ size: 1024 } as any);
    mockStat.mockResolvedValueOnce({ size: 2048 } as any);

    // git commands: branch, commits, remotes
    let callIdx = 0;
    mockExec.mockImplementation((_cmd: any, _opts: any, cb?: any) => {
      const callback = cb || _opts;
      const responses = ["main\n", "42\n", "origin\thttps://github.com/o/r (fetch)\n"];
      if (typeof callback === "function") {
        callback(null, { stdout: responses[callIdx++], stderr: "" });
      }
      return {} as any;
    });

    const result = await tool.handler({}, {} as any);

    expect((result as any).resultType).toBe("success");
    const text = (result as any).textResultForLlm;
    expect(text).toContain("Total files: 2");
    expect(text).toContain("MB");
    expect(text).toContain(".ts: 1");
    expect(text).toContain(".js: 1");
    expect(text).toContain("Branch: main");
    expect(text).toContain("Commits: 42");
    expect(text).toContain("origin");
    expect(ctx.onToolCall).toHaveBeenCalledWith("get_repo_metadata", {});
  });

  it("handles git info unavailable", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "get_repo_metadata");

    mockReaddir.mockResolvedValueOnce([
      makeDirent("file.py", false),
    ] as any);
    mockStat.mockResolvedValueOnce({ size: 512 } as any);

    // git commands all fail
    mockExec.mockImplementation((_cmd: any, _opts: any, cb?: any) => {
      const callback = cb || _opts;
      if (typeof callback === "function") {
        callback(new Error("not a git repo"));
      }
      return {} as any;
    });

    const result = await tool.handler({}, {} as any);

    expect((result as any).resultType).toBe("success");
    expect((result as any).textResultForLlm).toContain("Git info not available");
  });

  it("skips excluded directories when counting files", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "get_repo_metadata");

    mockReaddir.mockResolvedValueOnce([
      makeDirent("node_modules", true),
      makeDirent(".git", true),
      makeDirent("dist", true),
      makeDirent("app.ts", false),
    ] as any);
    mockStat.mockResolvedValueOnce({ size: 100 } as any);

    mockExec.mockImplementation((_cmd: any, _opts: any, cb?: any) => {
      const callback = cb || _opts;
      if (typeof callback === "function") {
        callback(new Error("no git"));
      }
      return {} as any;
    });

    const result = await tool.handler({}, {} as any);

    // Only 1 file (app.ts), not files from node_modules/etc
    expect((result as any).textResultForLlm).toContain("Total files: 1");
    // readdir should only be called once (root), not for skipped dirs
    expect(mockReaddir).toHaveBeenCalledTimes(1);
  });

  it("recurses into non-excluded directories", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "get_repo_metadata");

    // root
    mockReaddir.mockResolvedValueOnce([
      makeDirent("src", true),
    ] as any);
    // src
    mockReaddir.mockResolvedValueOnce([
      makeDirent("main.ts", false),
    ] as any);

    mockStat.mockResolvedValueOnce({ size: 256 } as any);

    mockExec.mockImplementation((_cmd: any, _opts: any, cb?: any) => {
      const callback = cb || _opts;
      if (typeof callback === "function") {
        callback(new Error("no git"));
      }
      return {} as any;
    });

    const result = await tool.handler({}, {} as any);

    expect((result as any).textResultForLlm).toContain("Total files: 1");
    expect(mockReaddir).toHaveBeenCalledTimes(2);
  });

  it("handles files without extensions", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "get_repo_metadata");

    mockReaddir.mockResolvedValueOnce([
      makeDirent("Makefile", false),
      makeDirent("Dockerfile", false),
    ] as any);
    mockStat.mockResolvedValue({ size: 100 } as any);

    mockExec.mockImplementation((_cmd: any, _opts: any, cb?: any) => {
      const callback = cb || _opts;
      if (typeof callback === "function") {
        callback(new Error("no git"));
      }
      return {} as any;
    });

    const result = await tool.handler({}, {} as any);

    expect((result as any).textResultForLlm).toContain("no-ext: 2");
  });

  it("handles stat errors gracefully", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "get_repo_metadata");

    mockReaddir.mockResolvedValueOnce([
      makeDirent("file.ts", false),
    ] as any);
    mockStat.mockRejectedValueOnce(new Error("permission denied"));

    mockExec.mockImplementation((_cmd: any, _opts: any, cb?: any) => {
      const callback = cb || _opts;
      if (typeof callback === "function") {
        callback(new Error("no git"));
      }
      return {} as any;
    });

    const result = await tool.handler({}, {} as any);

    // Should still succeed, just with 0 total size
    expect((result as any).resultType).toBe("success");
    expect((result as any).textResultForLlm).toContain("Total files: 1");
  });

  it("handles readdir error", async () => {
    const ctx = makeContext();
    const tool = getTool(ctx, "get_repo_metadata");

    mockReaddir.mockRejectedValue(new Error("EACCES: permission denied"));

    const result = await tool.handler({}, {} as any);

    expect((result as any).resultType).toBe("failure");
    expect((result as any).textResultForLlm).toContain("Error getting metadata");
  });

  it("works without callbacks", async () => {
    const ctx = makeContext({ onToolCall: undefined, onToolResult: undefined });
    const tool = getTool(ctx, "get_repo_metadata");

    mockReaddir.mockResolvedValueOnce([
      makeDirent("a.ts", false),
    ] as any);
    mockStat.mockResolvedValueOnce({ size: 10 } as any);

    mockExec.mockImplementation((_cmd: any, _opts: any, cb?: any) => {
      const callback = cb || _opts;
      if (typeof callback === "function") {
        callback(new Error("no git"));
      }
      return {} as any;
    });

    const result = await tool.handler({}, {} as any);

    expect((result as any).resultType).toBe("success");
  });
});
