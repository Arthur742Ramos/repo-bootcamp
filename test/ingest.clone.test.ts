import { beforeEach, describe, expect, it, vi } from "vitest";

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
  result: { stdout: string; stderr: string } = { stdout: "", stderr: "" },
): void {
  const callback = typeof maybeCb === "function"
    ? maybeCb
    : typeof optsOrCb === "function"
      ? optsOrCb
      : undefined;
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
    const timeoutError = Object.assign(new Error("Command timed out"), { code: "ETIMEDOUT", killed: true });
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, optsOrCb: unknown, maybeCb?: unknown) => {
      invokeExecCallback(optsOrCb, maybeCb, timeoutError);
      return {} as never;
    });

    await expect(cloneRepo(makeRepoInfo(), "/tmp/target")).rejects.toThrow(
      "Failed to clone repository: git clone timed out after 120s"
    );
  });

  it("includes stderr details for git clone command failures", async () => {
    const cloneError = Object.assign(new Error("clone failed"), {
      code: 128,
      stderr: "fatal: repository 'owner/repo.git' not found\n",
    });
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, optsOrCb: unknown, maybeCb?: unknown) => {
      invokeExecCallback(optsOrCb, maybeCb, cloneError);
      return {} as never;
    });

    await expect(cloneRepo(makeRepoInfo(), "/tmp/target")).rejects.toThrow(
      "Failed to clone repository: git clone exited with code 128: fatal: repository 'owner/repo.git' not found"
    );
  });

  it("uses metadata-specific boundary when post-clone git reads fail", async () => {
    const metadataError = new Error("rev-parse failed");
    mockExecFile
      .mockImplementationOnce((_cmd: unknown, _args: unknown, optsOrCb: unknown, maybeCb?: unknown) => {
        invokeExecCallback(optsOrCb, maybeCb, null, { stdout: "", stderr: "" });
        return {} as never;
      })
      .mockImplementationOnce((_cmd: unknown, _args: unknown, optsOrCb: unknown, maybeCb?: unknown) => {
        invokeExecCallback(optsOrCb, maybeCb, metadataError);
        return {} as never;
      });

    await expect(cloneRepo(makeRepoInfo(), "/tmp/target")).rejects.toThrow(
      "Failed to read cloned repository metadata: rev-parse failed"
    );
  });
});
