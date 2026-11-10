import { execFile } from "child_process";
import { createHash, randomUUID } from "crypto";
import { access, mkdir, readFile, realpath, rename, rmdir, unlink, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, isAbsolute, join } from "path";
import { promisify } from "util";

import type { RepoSource } from "./repo-resolver.js";

const execFileAsync = promisify(execFile);

interface SessionState {
  version: 1;
  fingerprint: string;
  completed: number[];
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprintFirstSession(
  tasks: unknown,
  evidence: ReadonlyMap<string, string>
): string {
  return hash(
    JSON.stringify([
      tasks,
      [...evidence.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ])
  );
}

export function fingerprintTaskSource(content: string): string {
  return hash(content);
}

async function localRef(path: string): Promise<string> {
  try {
    await access(join(path, ".git"));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "non-git";
    throw error;
  }
  const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd: path });
  if (stdout.trim()) return `branch:${stdout.trim()}`;
  const { stdout: sha } = await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: path,
  });
  return `detached:${sha.trim()}`;
}

function remoteRef(repo: RepoSource): string {
  if (repo.repoInfo.branch !== "HEAD") return `branch:${repo.repoInfo.branch}`;
  if (!repo.repoInfo.commitSha)
    throw new Error("Cannot identify a detached remote checkout without its commit SHA.");
  return `detached:${repo.repoInfo.commitSha}`;
}

async function sessionFile(
  repo: RepoSource,
  input: string,
  selectedRoot: string,
  subdir: string | undefined
): Promise<string> {
  const stateRoot =
    process.env.XDG_STATE_HOME ||
    (process.platform === "win32" && process.env.LOCALAPPDATA) ||
    join(homedir(), ".local", "state");
  if (!isAbsolute(stateRoot))
    throw new Error("The session state directory must be an absolute path.");
  const identity = repo.isLocal
    ? ["local", await realpath(repo.path), await realpath(selectedRoot), await localRef(repo.path)]
    : ["remote", repo.repoInfo.url || input, remoteRef(repo), subdir ?? ""];
  return join(stateRoot, "repo-bootcamp", "sessions", `${hash(JSON.stringify(identity))}.json`);
}

function parseState(content: string): SessionState {
  const parsed: unknown = JSON.parse(content);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("fingerprint" in parsed) ||
    typeof parsed.fingerprint !== "string" ||
    !("completed" in parsed) ||
    !Array.isArray(parsed.completed) ||
    !parsed.completed.every(
      (step: unknown): step is number =>
        typeof step === "number" && Number.isSafeInteger(step) && step > 0
    )
  ) {
    throw new Error("Invalid first-session state.");
  }
  return { version: 1, fingerprint: parsed.fingerprint, completed: parsed.completed };
}

/**
 * Persist only user-confirmed progress. The lock prevents concurrent CLI runs
 * from silently overwriting one another, and a rename makes each update atomic.
 */
export async function updateFirstSession(options: {
  repo: RepoSource;
  input: string;
  selectedRoot: string;
  subdir?: string;
  fingerprint: string;
  stepCount: number;
  done?: number;
  restart?: boolean;
}): Promise<SessionState> {
  const path = await sessionFile(options.repo, options.input, options.selectedRoot, options.subdir);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = `${path}.lock`;
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Another first-session update is active. If it was interrupted, remove ${lock} and retry.`,
        { cause: error }
      );
    }
    throw error;
  }

  try {
    let existing: SessionState | undefined;
    try {
      const content = await readFile(path, "utf8");
      try {
        existing = parseState(content);
      } catch (error: unknown) {
        if (!options.restart) {
          throw new Error("First-session state is invalid. Use --restart-session to replace it.", {
            cause: error,
          });
        }
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existing && existing.fingerprint !== options.fingerprint && !options.restart) {
      throw new Error(
        "Task definitions changed since this session was saved. Use --restart-session to start over."
      );
    }
    const state: SessionState =
      existing && !options.restart
        ? existing
        : { version: 1, fingerprint: options.fingerprint, completed: [] };
    if (state.completed.some((step) => step > options.stepCount)) {
      throw new Error(
        "First-session state contains invalid steps. Use --restart-session to replace it."
      );
    }
    if (options.done !== undefined && !state.completed.includes(options.done)) {
      state.completed.push(options.done);
      state.completed.sort((a, b) => a - b);
    }

    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return state;
  } finally {
    await rmdir(lock);
  }
}
