/**
 * Idempotency tests for createIssuesFromTasks: a second `--create-issues` run
 * must skip issues whose title already exists rather than re-creating them, and
 * a failed `gh issue list` must degrade gracefully (create everything).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FirstTask, RepoInfo } from "../src/types.js";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({ execFile: execFileMock }));
vi.mock("chalk", () => {
  const p: any = new Proxy((...a: any[]) => a.join(""), {
    get: () => p,
    apply: (_t: any, _x: any, a: any[]) => a.join(""),
  });
  return { default: p };
});

import { createIssuesFromTasks } from "../src/issues.js";

const repoInfo: RepoInfo = {
  owner: "octo",
  repo: "demo",
  url: "https://github.com/octo/demo",
  branch: "main",
  fullName: "octo/demo",
  provider: "github",
  host: "github.com",
};

const tasks: FirstTask[] = [
  {
    title: "Existing task",
    description: "Already tracked.",
    difficulty: "beginner",
    category: "docs",
    files: ["docs/a.md"],
    why: "w",
  },
  {
    title: "Brand new task",
    description: "Not tracked yet.",
    difficulty: "beginner",
    category: "test",
    files: ["src/b.ts"],
    why: "w",
  },
];

/** Route promisified execFile calls; callback is always the last argument. */
function route(existingListStdout: string | Error) {
  return (file: string, args: string[], opt3: unknown, opt4: unknown) => {
    const callback = (typeof opt4 === "function" ? opt4 : opt3) as (
      err: Error | null,
      result?: { stdout: string; stderr: string }
    ) => void;

    if (file === "which") {
      return callback(null, { stdout: "/usr/bin/gh", stderr: "" });
    }
    if (file === "gh" && args[0] === "auth") {
      return callback(null, { stdout: "Logged in", stderr: "" });
    }
    if (file === "gh" && args[0] === "issue" && args[1] === "list") {
      if (existingListStdout instanceof Error) return callback(existingListStdout);
      return callback(null, { stdout: existingListStdout, stderr: "" });
    }
    if (file === "gh" && args[0] === "issue" && args[1] === "create") {
      return callback(null, { stdout: "https://github.com/octo/demo/issues/9", stderr: "" });
    }
    return callback(new Error(`unexpected exec: ${file} ${args.join(" ")}`));
  };
}

function createCalls(): string[][] {
  return execFileMock.mock.calls
    .filter((c) => c[0] === "gh" && c[1][0] === "issue" && c[1][1] === "create")
    .map((c) => c[1] as string[]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createIssuesFromTasks idempotency", () => {
  it("skips tasks whose title already exists and creates the rest", async () => {
    execFileMock.mockImplementation(route(JSON.stringify([{ title: "Existing task" }])) as any);

    const results = await createIssuesFromTasks(tasks, repoInfo, {});

    expect(results).toHaveLength(2);
    const existing = results.find((r) => r.payload.title === "Existing task");
    const created = results.find((r) => r.payload.title === "Brand new task");
    expect(existing?.skipped).toBe(true);
    expect(created?.skipped).toBeFalsy();
    expect(created?.success).toBe(true);

    // Only the new task hits `gh issue create`.
    const creates = createCalls();
    expect(creates).toHaveLength(1);
    expect(creates[0]).toContain("Brand new task");

    // The dedup list was fetched exactly once (issue list call present).
    const listCalls = execFileMock.mock.calls.filter(
      (c) => c[0] === "gh" && c[1][0] === "issue" && c[1][1] === "list"
    );
    expect(listCalls).toHaveLength(1);
  }, 10000);

  it("creates every task when the existing-issue list cannot be fetched", async () => {
    execFileMock.mockImplementation(route(new Error("list failed")) as any);

    const results = await createIssuesFromTasks(tasks, repoInfo, {});

    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.skipped)).toBe(true);
    expect(createCalls()).toHaveLength(2);
  }, 10000);

  it("does not fetch the existing-issue list in dry-run mode", async () => {
    execFileMock.mockImplementation(route(JSON.stringify([{ title: "Existing task" }])) as any);

    const results = await createIssuesFromTasks(tasks, repoInfo, { dryRun: true });

    // Dry run previews both, skips network entirely.
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success && !r.skipped)).toBe(true);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
