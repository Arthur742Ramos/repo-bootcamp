import type { ChildProcessWithoutNullStreams } from "child_process";
import { spawn } from "child_process";
import { createServer } from "net";
import { join } from "path";

const REPO_ROOT = process.cwd();
const CLI_ENTRY = join(REPO_ROOT, "src", "cli.ts");
const TS_CONFIG = join(REPO_ROOT, "tsconfig.json");
const TSX_CLI = join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SpawnedCli {
  child: ChildProcessWithoutNullStreams;
  getOutput: () => { stdout: string; stderr: string };
}

function buildChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
  };

  // On Windows, Node's os.homedir() reads USERPROFILE (not HOME). Tests that
  // override HOME to redirect home-relative paths (e.g. ~/.cache) need the
  // same value mirrored to USERPROFILE for the override to take effect.
  if (process.platform === "win32" && env.HOME && !env.USERPROFILE) {
    childEnv.USERPROFILE = env.HOME;
  }

  delete childEnv.NODE_OPTIONS;
  delete childEnv.VITEST;

  for (const key of Object.keys(childEnv)) {
    if (key.startsWith("VITEST_") || key.startsWith("__VITEST")) {
      delete childEnv[key];
    }
  }

  return childEnv;
}

export function spawnCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
  cwd: string = REPO_ROOT
): SpawnedCli {
  const child = spawn(process.execPath, [TSX_CLI, "--tsconfig", TS_CONFIG, CLI_ENTRY, ...args], {
    cwd,
    env: buildChildEnv(env),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  return {
    child,
    getOutput: () => ({ stdout, stderr }),
  };
}

export async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
  timeoutMs = 60_000,
  cwd: string = REPO_ROOT
): Promise<CliResult> {
  const { child, getOutput } = spawnCli(args, env, cwd);

  return await new Promise<CliResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 1_000).unref();
      reject(new Error(`CLI timed out after ${timeoutMs}ms: ${args.join(" ")}`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      const output = getOutput();
      resolve({
        exitCode: code ?? -1,
        stdout: output.stdout,
        stderr: output.stderr,
      });
    });
  });
}

export async function waitForOutput(
  getOutput: () => { stdout: string; stderr: string },
  pattern: string | RegExp,
  timeoutMs = 30_000
): Promise<string> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { stdout, stderr } = getOutput();
    const combinedOutput = `${stdout}\n${stderr}`;
    const matched =
      typeof pattern === "string" ? combinedOutput.includes(pattern) : pattern.test(combinedOutput);

    if (matched) {
      return combinedOutput;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const { stdout, stderr } = getOutput();
  const combinedOutput = `${stdout}\n${stderr}`.trim();
  const outputPreview = combinedOutput || "(no output)";
  throw new Error(
    `Timed out waiting for output: ${String(pattern)}\n\nLast output:\n${outputPreview}`
  );
}

export async function getAvailablePort(): Promise<number> {
  const server = createServer();

  return await new Promise<number>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a test port")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function waitForHttpReady(url: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      await response.arrayBuffer();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Timed out waiting for ${url}`);
}
