import { describe, it, expect, vi, beforeEach } from "vitest";

const runAskCommand = vi.fn().mockResolvedValue(undefined);
const runDocsCommand = vi.fn().mockResolvedValue(undefined);
const runPullRequestDiff = vi.fn().mockResolvedValue(undefined);
const runMainCommand = vi.fn().mockResolvedValue(undefined);
const startServer = vi.fn();

vi.mock("../src/commands/ask-command.js", () => ({
  runAskCommand: (...args: any[]) => runAskCommand(...args),
}));
vi.mock("../src/commands/docs-command.js", () => ({
  runDocsCommand: (...args: any[]) => runDocsCommand(...args),
}));
vi.mock("../src/commands/diff-command.js", () => ({
  runPullRequestDiff: (...args: any[]) => runPullRequestDiff(...args),
}));
vi.mock("../src/commands/main-command.js", () => ({
  runMainCommand: (...args: any[]) => runMainCommand(...args),
}));
vi.mock("../src/web/server.js", () => ({
  startServer: (...args: any[]) => startServer(...args),
}));

import { program } from "../src/cli.js";

async function runArgv(argv: string[]): Promise<void> {
  const saved = process.argv;
  process.argv = ["node", "cli", ...argv];
  try {
    await program.parseAsync(process.argv);
  } finally {
    process.argv = saved;
  }
}

describe("CLI option routing past root-command flag collisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes ask --branch and --model to the ask command", async () => {
    await runArgv(["ask", "./repo", "--branch", "dev", "--model", "m1"]);
    expect(runAskCommand).toHaveBeenCalledTimes(1);
    const [repo, opts] = runAskCommand.mock.calls[0];
    expect(repo).toBe("./repo");
    expect(opts.branch).toBe("dev");
    expect(opts.model).toBe("m1");
  });

  it("routes a positional question to the ask command (one-shot mode)", async () => {
    await runArgv(["ask", "./repo", "Where is the entrypoint?"]);
    expect(runAskCommand).toHaveBeenCalledTimes(1);
    const [repo, opts] = runAskCommand.mock.calls[0];
    expect(repo).toBe("./repo");
    expect(opts.question).toBe("Where is the entrypoint?");
  });

  it("routes the -q/--question flag to the ask command", async () => {
    await runArgv(["ask", "./repo", "--question", "flag question"]);
    const [, opts] = runAskCommand.mock.calls[0];
    expect(opts.question).toBe("flag question");
  });

  it("prefers the positional question over the --question flag", async () => {
    await runArgv(["ask", "./repo", "positional q", "--question", "flag q"]);
    const [, opts] = runAskCommand.mock.calls[0];
    expect(opts.question).toBe("positional q");
  });

  it("leaves ask question undefined in interactive mode", async () => {
    await runArgv(["ask", "./repo"]);
    const [, opts] = runAskCommand.mock.calls[0];
    expect(opts.question).toBeUndefined();
  });

  it("threads --exclude and --subdir into the main command options", async () => {
    await runArgv(["./repo", "--exclude", "dist", "vendor", "--subdir", "packages/app"]);
    expect(runMainCommand).toHaveBeenCalledTimes(1);
    const [repo, opts] = runMainCommand.mock.calls[0];
    expect(repo).toBe("./repo");
    expect(opts.exclude).toEqual(["dist", "vendor"]);
    expect(opts.subdir).toBe("packages/app");
  });

  it("leaves exclude/subdir undefined when the flags are absent", async () => {
    await runArgv(["./repo"]);
    const [, opts] = runMainCommand.mock.calls[0];
    expect(opts.exclude).toBeUndefined();
    expect(opts.subdir).toBeUndefined();
  });

  it("threads --host and --port into startServer for the web command", async () => {
    await runArgv(["web", "--host", "0.0.0.0", "--port", "0"]);
    expect(startServer).toHaveBeenCalledWith(0, "0.0.0.0");
  });

  it("defaults the web host to undefined (server binds loopback)", async () => {
    await runArgv(["web", "--port", "0"]);
    expect(startServer).toHaveBeenCalledWith(0, undefined);
  });

  it("routes docs --branch to the docs command", async () => {
    await runArgv(["docs", "./repo", "--branch", "release", "--check"]);
    expect(runDocsCommand).toHaveBeenCalledTimes(1);
    const [repo, opts] = runDocsCommand.mock.calls[0];
    expect(repo).toBe("./repo");
    expect(opts.branch).toBe("release");
    expect(opts.check).toBe(true);
  });

  it("routes diff --format, --full-clone, and --keep-temp to the diff command", async () => {
    await runArgv(["diff", "owner/repo#1", "--format", "html", "--full-clone", "--keep-temp"]);
    expect(runPullRequestDiff).toHaveBeenCalledTimes(1);
    const [target, opts] = runPullRequestDiff.mock.calls[0];
    expect(target).toBe("owner/repo#1");
    expect(opts.format).toBe("html");
    expect(opts.fullClone).toBe(true);
    expect(opts.keepTemp).toBe(true);
  });

  it("leaves options unset when not provided", async () => {
    await runArgv(["diff", "owner/repo#2"]);
    const [, opts] = runPullRequestDiff.mock.calls[0];
    expect(opts.format).toBeUndefined();
    expect(opts.fullClone).toBe(false);
    expect(opts.keepTemp).toBe(false);
  });
});
