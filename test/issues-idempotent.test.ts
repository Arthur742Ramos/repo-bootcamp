/**
 * Idempotency tests for createIssuesFromTasks: a second `--create-issues` run
 * must skip issues whose title already exists rather than re-creating them, and
 * a failed `gh issue list` must degrade gracefully (create everything).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { createIssuesFromTasks, generateIssuePreview, taskToIssuePayload } from "../src/issues.js";

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
function route(existingListStdout: string | Error, failures: boolean[] = []) {
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
      if (failures.shift()) return callback(new Error("Owned creation failure"));
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

afterEach(() => vi.unstubAllEnvs());

describe("GitHub issue destination and batch results", () => {
  it.each([
    { provider: "gitlab", host: "gitlab.com", url: "https://gitlab.com/octo/demo" },
    { provider: "bitbucket", host: "bitbucket.org", url: "https://bitbucket.org/octo/demo" },
    {
      provider: undefined,
      host: undefined,
      url: "file:///owned/demo",
      owner: "local",
      fullName: "local/demo",
    },
    { provider: "gitlab" },
    { host: "gitlab.com" },
    { url: "https://gitlab.com/octo/demo" },
    { url: "https://github.com/other/demo" },
    { url: "https://github.com/octo/other" },
    { fullName: "other/demo" },
    { owner: "other" },
    { repo: "other" },
    { url: "https://github.example/octo/demo" },
    { url: "" },
  ])("rejects unsupported or contradictory metadata before invoking gh: %j", async (overrides) => {
    const info = { ...repoInfo, ...overrides } as RepoInfo;
    await expect(createIssuesFromTasks(tasks, info)).rejects.toThrow(
      "matching GitHub repository metadata"
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it.each([
    { url: "https://github.com/octo/demo", provider: undefined, host: undefined },
    { url: "git@github.com:octo/demo.git", provider: undefined, host: undefined },
    { url: "octo/demo", provider: undefined, host: undefined },
    { url: "https://github.com/Octo/Demo", host: "GITHUB.COM" },
  ])("qualifies matching GitHub destinations independently of GH_HOST: %j", async (overrides) => {
    vi.stubEnv("GH_HOST", "gitlab.example");
    execFileMock.mockImplementation(route("[]") as any);
    const info = { ...repoInfo, ...overrides } as RepoInfo;
    const results = await createIssuesFromTasks([tasks[0]], info);
    expect(results[0].success).toBe(true);
    const commands = execFileMock.mock.calls.filter(
      (call) => call[0] === "gh" && call[1][0] === "issue"
    );
    expect(commands).toHaveLength(2);
    for (const [, args] of commands) {
      expect(args[args.indexOf("--repo") + 1].toLowerCase()).toBe("github.com/octo/demo");
    }
  });

  it("reserves a successful title within the batch", async () => {
    execFileMock.mockImplementation(route("[]") as any);
    const results = await createIssuesFromTasks([tasks[0], tasks[0]], repoInfo);
    expect(createCalls()).toHaveLength(1);
    expect(results.map((result) => [result.success, !!result.skipped])).toEqual([
      [true, false],
      [true, true],
    ]);
  });

  it("retries a duplicate after failure and reserves only the later success", async () => {
    execFileMock.mockImplementation(route("[]", [true, false]) as any);
    const results = await createIssuesFromTasks([tasks[0], tasks[0], tasks[0]], repoInfo);
    expect(createCalls()).toHaveLength(2);
    expect(results.map((result) => [result.success, !!result.skipped])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ]);
  });

  it.each(["gitlab", "bitbucket", "local"])(
    "keeps %s manual previews offline and package-aware",
    async (provider) => {
      const info: RepoInfo =
        provider === "local"
          ? {
              ...repoInfo,
              owner: "local",
              fullName: "local/demo",
              provider: undefined,
              host: undefined,
              url: "file:///owned/demo",
            }
          : {
              ...repoInfo,
              provider: provider as "gitlab" | "bitbucket",
              host: provider === "gitlab" ? "gitlab.com" : "bitbucket.org",
              url: `https://${provider === "gitlab" ? "gitlab.com" : "bitbucket.org"}/octo/demo`,
              sourcePathPrefix: "packages/app",
            };
      const results = await createIssuesFromTasks([tasks[0]], info, { dryRun: true });
      const preview = generateIssuePreview([tasks[0]], info);
      expect(results[0].success).toBe(true);
      expect(execFileMock).not.toHaveBeenCalled();
      expect(preview).toContain("manual issue creation");
      expect(preview).not.toContain("To create these issues, run:");
      expect(preview).toContain("--create-issues --dry-run");
      if (provider !== "local") expect(preview).toContain("/packages/app/docs/a.md");
    }
  );

  it("preserves scoped GitHub issue source links", () => {
    const payload = taskToIssuePayload(tasks[0], { ...repoInfo, sourcePathPrefix: "packages/app" });
    expect(payload.body).toContain("https://github.com/octo/demo/blob/main/packages/app/docs/a.md");
  });
});

describe("issue payload attribution", () => {
  it.each([
    { provider: "github", host: "github.com", url: "https://github.com/octo/demo" },
    { provider: "gitlab", host: "gitlab.com", url: "https://gitlab.com/octo/demo" },
    { provider: "bitbucket", host: "bitbucket.org", url: "https://bitbucket.org/octo/demo" },
    {
      provider: undefined,
      host: undefined,
      url: "file:///owned/demo",
      owner: "local",
      fullName: "local/demo",
    },
    { provider: undefined, host: undefined, url: "https://github.com/octo/demo" },
  ])("credits the canonical tool project for %j", (overrides) => {
    const info = { ...repoInfo, ...overrides } as RepoInfo;
    const payload = taskToIssuePayload(tasks[0], info);
    expect(payload.body).toContain(
      "[Repo Bootcamp](https://github.com/Arthur742Ramos/repo-bootcamp)"
    );
    expect(payload.body).not.toContain(`[Repo Bootcamp](https://github.com/${info.fullName})`);
    expect(generateIssuePreview([tasks[0]], info)).toContain(
      "[Repo Bootcamp](https://github.com/Arthur742Ramos/repo-bootcamp)"
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
