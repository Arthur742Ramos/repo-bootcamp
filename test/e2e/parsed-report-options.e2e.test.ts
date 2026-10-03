import { execFileSync } from "child_process";
import { once } from "events";
import { createServer, type Server } from "http";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

const url = "https://github.com/owned/routing.git";
const target = "owned/routing#1";
let root: string;
let server: Server;
let env: NodeJS.ProcessEnv;
let apiCalls = 0;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "bootcamp-parsed-options-"));
  const repo = join(root, "repo");
  const bare = join(root, "owned.git");
  const home = join(root, "home");
  await mkdir(repo);
  await mkdir(home);
  await writeFile(join(repo, "README.md"), "# Owned\n\nRequires Node 20.0.0 and npm.\n");
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({ name: "owned", version: "1.0.0", engines: { node: ">=20.0.0" } })
  );
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "owned@example.test"]);
  git(repo, ["config", "user.name", "Owned fixture"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "main", "--no-gpg-sign"]);
  const base = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["checkout", "-b", "release"]);
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({ name: "owned", version: "2.0.0", engines: { node: ">=24.0.0" } })
  );
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "release", "--no-gpg-sign"]);
  const head = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["checkout", "main"]);
  git(root, ["clone", "--bare", repo, bare]);
  git(bare, ["update-ref", "refs/pull/1/head", head]);
  const response = join(root, "answer.txt");
  await writeFile(response, "Owned saved answer.");
  server = createServer((_req, res) => {
    apiCalls++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        base: { ref: "main", sha: base },
        head: { ref: "release", sha: head },
        title: "Owned PR",
      })
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  env = {
    HOME: home,
    XDG_CACHE_HOME: join(home, "cache"),
    NODE_ENV: "test",
    GITHUB_TOKEN: "",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${pathToFileURL(bare).href}.insteadOf`,
    GIT_CONFIG_VALUE_0: url,
    GIT_TERMINAL_PROMPT: "0",
    REPO_BOOTCAMP_GITHUB_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
  };
});

afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  if (root) await rm(root, { recursive: true, force: true });
});

async function caller(name: string): Promise<string> {
  const path = join(root, name);
  await mkdir(path);
  return path;
}

async function clones(cwd: string): Promise<string[]> {
  return readdir(join(cwd, ".tmp")).catch(() => []);
}

describe("parsed Docs/Ask/Diff options through the actual CLI", () => {
  it("analyzes the final Docs branch and rejects the final invalid branch", async () => {
    const cwd = await caller("docs-final");
    const release = await runCli(
      ["--branch", "missing-first", "docs", url, "--branch", "release"],
      env,
      60_000,
      cwd
    );
    expect(release.exitCode, release.stderr).toBe(0);
    expect(release.stdout).toContain(">=24.0.0");
    expect(release.stdout).toContain("Version Mismatches");
    const invalid = await runCli(
      ["docs", url, "--branch", "main", "--branch", "missing-final"],
      env,
      60_000,
      cwd
    );
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("Failed to resolve repository:");
    expect(invalid.stdout).not.toContain("Analysis Results");
    expect(await clones(cwd)).toEqual([]);
  }, 90_000);

  it.each(["ask", "docs"])(
    "resets a repeated %s branch with a literal blank",
    async (action) => {
      const cwd = await caller(`${action}-blank`);
      const args = [
        action,
        url,
        ...(action === "ask" ? ["Owned question?"] : []),
        "--branch",
        "missing-first",
        "--branch",
        "",
      ];
      const result = await runCli(args, env, 60_000, cwd);
      expect(result.exitCode, result.stderr).toBe(0);
      if (action === "ask") expect(result.stdout.trim()).toBe("Owned saved answer.");
      else expect(result.stdout).not.toContain("Version Mismatches");
      expect(await clones(cwd)).toEqual([]);
    },
    90_000
  );

  it("asks against the final valid ref and fails before answering for the final invalid ref", async () => {
    const cwd = await caller("ask-final");
    const valid = await runCli(
      ["ask", url, "Owned question?", "--branch", "missing-first", "--branch", "release"],
      env,
      60_000,
      cwd
    );
    expect(valid.exitCode, valid.stderr).toBe(0);
    expect(valid.stdout.trim()).toBe("Owned saved answer.");
    const invalid = await runCli(
      ["ask", url, "Owned question?", "--branch", "main", "--branch", "missing-final"],
      env,
      60_000,
      cwd
    );
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stdout).not.toContain("Owned saved answer.");
    expect(invalid.stderr).toContain("Clone failed:");
    expect(await clones(cwd)).toEqual([]);
  }, 90_000);

  it.each(["ask", "docs"])(
    "keeps a flag-shaped %s branch as a required value",
    async (action) => {
      const cwd = await caller(`${action}-operand`);
      const result = await runCli(
        [
          action,
          url,
          ...(action === "ask" ? ["Owned question?"] : []),
          "--branch",
          "main",
          "--branch",
          "--verbose",
        ],
        env,
        60_000,
        cwd
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).not.toContain("Owned saved answer.");
      expect(result.stdout).not.toContain("Analysis Results");
      expect(await clones(cwd)).toEqual([]);
    },
    90_000
  );

  it("fails on the final occupied Diff output without writing the earlier directory", async () => {
    const cwd = await caller("diff-final-occupied");
    await writeFile(join(cwd, "occupied"), "Preserve owned content.");
    const result = await runCli(
      ["diff", target, "--output", "first", "--output", "occupied"],
      env,
      60_000,
      cwd
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Failed to create output directory:");
    expect(await readFile(join(cwd, "occupied"), "utf-8")).toBe("Preserve owned content.");
    expect(await readdir(cwd)).not.toContain("first");
    expect(await clones(cwd)).toEqual([]);
  }, 90_000);

  it("writes only the final Diff directory and HTML format", async () => {
    const cwd = await caller("diff-final");
    const result = await runCli(
      [
        "diff",
        target,
        "--output",
        "first",
        "--output",
        "second",
        "--format",
        "markdown",
        "--format",
        "html",
      ],
      env,
      60_000,
      cwd
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(await readFile(join(cwd, "second", "DIFF.html"), "utf-8")).toContain("Owned PR");
    expect(await readdir(cwd)).not.toContain("first");
    expect(await clones(cwd)).toEqual([]);
  }, 90_000);

  it("rejects final invalid Diff format before cloning or contacting PR metadata", async () => {
    const cwd = await caller("diff-invalid");
    const before = apiCalls;
    const result = await runCli(
      ["diff", target, "--format", "markdown", "--format", "invalid-final"],
      env,
      60_000,
      cwd
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid format: invalid-final");
    expect(apiCalls).toBe(before);
    expect(await readdir(cwd)).toEqual([]);
  }, 90_000);

  it("resets final blank Diff output/format to existing defaults", async () => {
    const cwd = await caller("diff-blank");
    const result = await runCli(
      ["diff", target, "--output", "first", "--output", "", "--format", "html", "--format", ""],
      env,
      60_000,
      cwd
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(await readFile(join(cwd, "bootcamp-routing-pr-1", "DIFF.md"), "utf-8")).toContain(
      "Owned PR"
    );
    expect(await readdir(cwd)).not.toContain("first");
    expect(await clones(cwd)).toEqual([]);
  }, 90_000);

  it.each(["--keep-temp", "--full-clone", "--verbose"])(
    "writes literal Diff directory %s and cleans the clone",
    async (operand) => {
      const cwd = await caller(`diff-operand${operand}`);
      const result = await runCli(["diff", target, "--output", operand], env, 60_000, cwd);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(await readFile(join(cwd, operand, "DIFF.md"), "utf-8")).toContain("Owned PR");
      expect(result.stdout).not.toContain("Temporary clone kept at:");
      expect(await clones(cwd)).toEqual([]);
    },
    90_000
  );

  it("retains a clone only when keep-temp is a separate parsed flag", async () => {
    const cwd = await caller("diff-real-keep");
    const result = await runCli(
      ["diff", target, "--output", "--keep-temp", "--keep-temp"],
      env,
      60_000,
      cwd
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(await readFile(join(cwd, "--keep-temp", "DIFF.md"), "utf-8")).toContain("Owned PR");
    expect(result.stdout).toContain("Temporary clone kept at:");
    expect(await clones(cwd)).toHaveLength(1);
  }, 90_000);
});
