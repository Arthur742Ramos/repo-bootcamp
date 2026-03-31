import { execFileSync } from "child_process";
import { once } from "events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { spawnCli, waitForOutput } from "./helpers.js";

async function createAskFixtureRepo(baseDir: string): Promise<string> {
  const repoDir = join(baseDir, "fixture-ask-repo");
  await mkdir(join(repoDir, "src"), { recursive: true });

  await writeFile(
    join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-ask-repo",
        version: "1.0.0",
        engines: { node: ">=20.0.0" },
        dependencies: {
          express: "^5.1.0",
        },
      },
      null,
      2
    ),
    "utf-8"
  );
  await writeFile(
    join(repoDir, "README.md"),
    "# Fixture Ask Repo\n\nA local repository for interactive CLI end-to-end coverage.\n",
    "utf-8"
  );
  await writeFile(
    join(repoDir, "src", "index.ts"),
    'import express from "express";\nexport const app = express();\n',
    "utf-8"
  );

  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repoDir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], { cwd: repoDir, stdio: "ignore" });

  return repoDir;
}

describe("ask command", () => {
  const tempDirs: string[] = [];
  const children: ReturnType<typeof spawnCli>[] = [];

  afterEach(async () => {
    await Promise.all(
      children.map(async ({ child }) => {
        if (child.exitCode === null) {
          child.kill("SIGTERM");
          await once(child, "close");
        }
      })
    );
    children.length = 0;

    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("answers questions against a local repo through the real CLI process", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-ask-e2e-"));
    tempDirs.push(tempDir);

    const repoPath = await createAskFixtureRepo(tempDir);
    const responseFile = join(tempDir, "mock-response.txt");
    const expectedAnswer = "The main entrypoint lives in src/index.ts.";
    await writeFile(responseFile, expectedAnswer, "utf-8");

    const askProcess = spawnCli(
      ["ask", repoPath, "--no-clone"],
      {
        NODE_ENV: "test",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile,
      },
      tempDir
    );
    children.push(askProcess);

    await waitForOutput(askProcess.getOutput, "Ready!", 60_000);
    await new Promise((resolve) => setTimeout(resolve, 200));
    askProcess.child.stdin.write("Where is the main entrypoint?\n");

    await waitForOutput(askProcess.getOutput, expectedAnswer);
    askProcess.child.stdin.write("exit\n");

    const [exitCode] = await once(askProcess.child, "close");
    expect(exitCode).toBe(0);

    const { stdout, stderr } = askProcess.getOutput();
    expect(stderr).toBe("");
    expect(stdout).toContain("Using local repository:");
    expect(stdout).toContain(expectedAnswer);

    const transcript = await readFile(join(tempDir, "TRANSCRIPT.md"), "utf-8");
    expect(transcript).toContain("Where is the main entrypoint?");
    expect(transcript).toContain(expectedAnswer);
  }, 90_000);
});
