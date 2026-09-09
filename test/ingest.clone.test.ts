import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const { mockExecFile, mockRm } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockRm: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return {
    ...actual,
    rm: mockRm,
  };
});

import { cloneRepo } from "../src/ingest.js";
import type { RepoInfo } from "../src/types.js";

let targetDir: string;

beforeEach(async () => {
  targetDir = await mkdtemp(join(tmpdir(), "bootcamp-clone-test-"));
});

afterEach(async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  await actual.rm(targetDir, { recursive: true, force: true });
});

function makeRepoInfo(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    owner: "owner",
    repo: "repo",
    url: "https://github.com/owner/repo",
    branch: "main",
    fullName: "owner/repo",
    ...overrides,
  };
}

function invokeExecCallback(
  optsOrCb: unknown,
  maybeCb: unknown,
  error: Error | null,
  result: { stdout: string; stderr: string } = { stdout: "", stderr: "" }
): void {
  const callback =
    typeof maybeCb === "function" ? maybeCb : typeof optsOrCb === "function" ? optsOrCb : undefined;
  if (typeof callback === "function") {
    callback(error, result);
  }
}

describe("cloneRepo error boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRm.mockResolvedValue(undefined);
  });

  it("returns timeout-specific clone errors", async () => {
    const timeoutError = Object.assign(new Error("Command timed out"), {
      code: "ETIMEDOUT",
      killed: true,
    });
    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, optsOrCb: unknown, maybeCb?: unknown) => {
        invokeExecCallback(optsOrCb, maybeCb, timeoutError);
        return {} as never;
      }
    );

    await expect(cloneRepo(makeRepoInfo(), targetDir)).rejects.toThrow(
      "Failed to clone repository: git clone timed out after 120s"
    );
  });

  it("includes stderr details for git clone command failures", async () => {
    const cloneError = Object.assign(new Error("clone failed"), {
      code: 128,
      stderr: "fatal: repository 'owner/repo.git' not found\n",
    });
    mockExecFile.mockImplementation(
      (_cmd: unknown, _args: unknown, optsOrCb: unknown, maybeCb?: unknown) => {
        invokeExecCallback(optsOrCb, maybeCb, cloneError);
        return {} as never;
      }
    );

    await expect(cloneRepo(makeRepoInfo(), targetDir)).rejects.toThrow(
      "Failed to clone repository: git clone exited with code 128: fatal: repository 'owner/repo.git' not found"
    );
  });

  it("uses metadata-specific boundary when post-clone git reads fail", async () => {
    const metadataError = new Error("rev-parse failed");
    mockExecFile
      .mockImplementationOnce(
        (_cmd: unknown, _args: unknown, optsOrCb: unknown, maybeCb?: unknown) => {
          invokeExecCallback(optsOrCb, maybeCb, null, { stdout: "", stderr: "" });
          return {} as never;
        }
      )
      .mockImplementationOnce(
        (_cmd: unknown, _args: unknown, optsOrCb: unknown, maybeCb?: unknown) => {
          invokeExecCallback(optsOrCb, maybeCb, metadataError);
          return {} as never;
        }
      );

    await expect(cloneRepo(makeRepoInfo(), targetDir)).rejects.toThrow(
      "Failed to read cloned repository metadata: rev-parse failed"
    );
  });
});

describe("cloneRepo hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRm.mockResolvedValue(undefined);
  });

  it("hardens the clone env with Git-compatible null config paths", async () => {
    const calls: { args: string[]; opts: Record<string, unknown> | undefined }[] = [];
    mockExecFile.mockImplementation(
      (_cmd: unknown, args: unknown, optsOrCb: unknown, maybeCb?: unknown) => {
        const opts =
          typeof optsOrCb === "object" && optsOrCb !== null
            ? (optsOrCb as Record<string, unknown>)
            : undefined;
        calls.push({ args: args as string[], opts });
        invokeExecCallback(optsOrCb, maybeCb, null, { stdout: "main\n", stderr: "" });
        return {} as never;
      }
    );

    await cloneRepo(makeRepoInfo(), targetDir);

    const cloneCall = calls[0];
    // `-c protocol.file.allow=user` is a global option, so it must precede the
    // `clone` subcommand.
    expect(cloneCall.args).toContain("-c");
    expect(cloneCall.args).toContain("protocol.file.allow=user");
    expect(cloneCall.args.indexOf("-c")).toBeLessThan(cloneCall.args.indexOf("clone"));

    const env = (cloneCall.opts?.env ?? {}) as Record<string, string | undefined>;
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_ASKPASS).toBe("echo");
    expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(env.GIT_CONFIG_SYSTEM).toBe("/dev/null");
    // The ambient environment is preserved (env is spread from process.env).
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("threads the requested branch into the clone and records the resulting branch", async () => {
    const calls: string[][] = [];
    mockExecFile.mockImplementation(
      (_cmd: unknown, args: unknown, optsOrCb: unknown, maybeCb?: unknown) => {
        calls.push(args as string[]);
        // The clone is call[0]; the follow-up `git rev-parse` reads feed
        // repoInfo.branch / repoInfo.commitSha. Report "feature" as HEAD.
        invokeExecCallback(optsOrCb, maybeCb, null, { stdout: "feature\n", stderr: "" });
        return {} as never;
      }
    );

    const repoInfo = makeRepoInfo();
    await cloneRepo(repoInfo, targetDir, "feature", true);

    const cloneArgs = calls[0];
    expect(cloneArgs).toContain("--branch");
    expect(cloneArgs[cloneArgs.indexOf("--branch") + 1]).toBe("feature");
    // fullClone=true keeps full history — no shallow --depth / blob filter.
    expect(cloneArgs).not.toContain("--depth");
    expect(cloneArgs).not.toContain("--filter=blob:none");
    // repoInfo.branch is updated from `git rev-parse --abbrev-ref HEAD`.
    expect(repoInfo.branch).toBe("feature");
  });

  it("uses an isolated clone destination for concurrent clones of the same repository", async () => {
    const cloneDestinations: string[] = [];
    mockExecFile.mockImplementation(
      (_cmd: unknown, args: unknown, optsOrCb: unknown, maybeCb?: unknown) => {
        const cloneArgs = args as string[];
        if (cloneArgs.includes("clone")) {
          cloneDestinations.push(cloneArgs[cloneArgs.length - 1]);
        }
        invokeExecCallback(optsOrCb, maybeCb, null, { stdout: "main\n", stderr: "" });
        return {} as never;
      }
    );

    const [first, second] = await Promise.all([
      cloneRepo(makeRepoInfo(), targetDir),
      cloneRepo(makeRepoInfo(), targetDir),
    ]);

    expect(first).not.toBe(second);
    expect(new Set(cloneDestinations).size).toBe(2);
  });

  it("does not append .git to local file URLs", async () => {
    const cloneCalls: string[][] = [];
    mockExecFile.mockImplementation(
      (_cmd: unknown, args: unknown, optsOrCb: unknown, maybeCb?: unknown) => {
        const argsList = args as string[];
        if (argsList.includes("clone")) cloneCalls.push(argsList);
        invokeExecCallback(optsOrCb, maybeCb, null, { stdout: "main\n", stderr: "" });
        return {} as never;
      }
    );

    const repoInfo = makeRepoInfo({
      url: "file:///tmp/source-repo",
    });
    await cloneRepo(repoInfo, targetDir);
    expect(cloneCalls[0]).toContain("file:///tmp/source-repo");
    expect(cloneCalls[0]).not.toContain("file:///tmp/source-repo.git");
  });
});
