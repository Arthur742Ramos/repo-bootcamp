import { execFileSync } from "child_process";
import { once } from "events";
import { createServer, type Server } from "http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

const FIXTURE_OWNER = "fixture-owner";
const FIXTURE_REPO = "fixture-repo";
const PR_NUMBER = 123;

interface DiffFixture {
  bareRepoPath: string;
  baseSha: string;
  headSha: string;
}

function git(cwd: string, args: string[], options: { encoding?: BufferEncoding } = {}): string {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: options.encoding ?? "utf-8",
  }).trim();
}

async function createDiffFixture(baseDir: string): Promise<DiffFixture> {
  const workingDir = join(baseDir, "fixture-diff-work");
  const bareRepoPath = join(baseDir, "fixture-diff-remote.git");

  await mkdir(join(workingDir, "src"), { recursive: true });
  await writeFile(
    join(workingDir, "package.json"),
    JSON.stringify(
      {
        name: FIXTURE_REPO,
        version: "1.0.0",
        engines: { node: ">=20.0.0" },
        scripts: {
          test: "echo test",
        },
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
    join(workingDir, "src", "index.ts"),
    'export const greet = () => "hello";\n',
    "utf-8"
  );
  await writeFile(join(workingDir, ".env.example"), "PORT=3000\n", "utf-8");

  git(baseDir, ["init", "--bare", "--initial-branch=main", bareRepoPath]);
  git(workingDir, ["init", "-b", "main"]);
  git(workingDir, ["config", "user.email", "test@example.com"]);
  git(workingDir, ["config", "user.name", "Test User"]);
  git(workingDir, ["remote", "add", "origin", bareRepoPath]);
  git(workingDir, ["add", "-A"]);
  git(workingDir, ["commit", "-m", "base", "--no-gpg-sign"]);
  const baseSha = git(workingDir, ["rev-parse", "HEAD"]);
  git(workingDir, ["push", "-u", "origin", "main"]);

  git(workingDir, ["checkout", "-b", "feature/pr-123"]);

  await writeFile(
    join(workingDir, "package.json"),
    JSON.stringify(
      {
        name: FIXTURE_REPO,
        version: "2.0.0",
        engines: { node: ">=20.0.0" },
        scripts: {
          test: "echo test",
          lint: "echo lint",
        },
        dependencies: {
          express: "^5.1.0",
          zod: "^4.0.0",
        },
      },
      null,
      2
    ),
    "utf-8"
  );
  await writeFile(
    join(workingDir, "src", "index.ts"),
    'import express from "express";\nexport const app = express();\n',
    "utf-8"
  );
  await writeFile(join(workingDir, ".env.example"), "PORT=3000\nAPI_TOKEN=\n", "utf-8");

  git(workingDir, ["add", "-A"]);
  git(workingDir, ["commit", "-m", "feature", "--no-gpg-sign"]);
  const headSha = git(workingDir, ["rev-parse", "HEAD"]);
  git(workingDir, ["push", "-u", "origin", "feature/pr-123"]);
  git(workingDir, ["push", "origin", `HEAD:refs/pull/${PR_NUMBER}/head`]);

  return { bareRepoPath, baseSha, headSha };
}

async function startPullRequestApiServer(baseSha: string, headSha: string): Promise<{
  server: Server;
  apiBaseUrl: string;
}> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === `/repos/${FIXTURE_OWNER}/${FIXTURE_REPO}/pulls/${PR_NUMBER}`) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          base: { ref: "main", sha: baseSha },
          head: { ref: "feature/pr-123", sha: headSha },
          title: "Fixture PR",
          html_url: `https://github.com/${FIXTURE_OWNER}/${FIXTURE_REPO}/pull/${PR_NUMBER}`,
        })
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start PR API fixture server");
  }

  return {
    server,
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe("diff command", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          })
      )
    );
    servers.length = 0;

    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("generates a PR onboarding diff through the real CLI process", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-diff-e2e-"));
    tempDirs.push(tempDir);

    const { bareRepoPath, baseSha, headSha } = await createDiffFixture(tempDir);
    const { server, apiBaseUrl } = await startPullRequestApiServer(baseSha, headSha);
    servers.push(server);

    const outputDir = join(tempDir, "diff-output");
    const bareRepoUrl = pathToFileURL(bareRepoPath).href;
    const result = await runCli(
      ["diff", `${FIXTURE_OWNER}/${FIXTURE_REPO}#${PR_NUMBER}`, "--output", outputDir],
      {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.${bareRepoUrl}.insteadOf`,
        GIT_CONFIG_VALUE_0: `https://github.com/${FIXTURE_OWNER}/${FIXTURE_REPO}.git`,
        REPO_BOOTCAMP_GITHUB_API_BASE_URL: apiBaseUrl,
      },
      60_000,
      tempDir
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("PR Diff Generated Successfully");

    const diffDoc = await readFile(join(outputDir, "DIFF.md"), "utf-8");
    expect(diffDoc).toContain("Fixture PR");
    expect(diffDoc).toContain("Comparison for **fixture-repo**: `main` → `PR #123 (feature/pr-123)`");
    expect(diffDoc).toContain("- `zod`");
    expect(diffDoc).toContain("- `API_TOKEN`");
    expect(diffDoc).toContain("- `npm run lint`");
    expect(diffDoc).toContain("Major version bump: 1.0.0 → 2.0.0");
    expect(diffDoc).toContain("Removed export: greet in src/index.ts");
  }, 90_000);
});
