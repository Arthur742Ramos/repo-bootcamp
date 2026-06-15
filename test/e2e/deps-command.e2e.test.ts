import { execFileSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

async function createRepo(baseDir: string, files: Record<string, string>): Promise<string> {
  const repoDir = join(baseDir, "fixture-deps-repo");
  await mkdir(repoDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(repoDir, relativePath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], { cwd: repoDir, stdio: "ignore" });
  return repoDir;
}

const FILES: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "fixture-deps-repo",
      version: "1.0.0",
      dependencies: { express: "^5.0.0", helmet: "^8.0.0", zod: "^4.0.0" },
      devDependencies: { vitest: "^4.0.0", typescript: "^6.0.0" },
    },
    null,
    2
  ),
  "README.md": "# Fixture Deps Repo\n",
};

describe("deps command", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("prints a dependency report for a local repo", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-deps-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["deps", repoPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Dependencies");
    expect(result.stdout).toContain("express");
    expect(result.stdout).toContain("vitest");
  }, 60_000);

  it("emits dependency JSON with --json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-deps-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["deps", repoPath, "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.packageManager).toBe("npm");
    expect(parsed.counts.runtime).toBe(3);
    expect(parsed.counts.dev).toBe(2);
    expect(parsed.runtime.map((d: { name: string }) => d.name)).toContain("express");
  }, 60_000);

  it("prints a Mermaid graph with --diagram", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-deps-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, FILES);

    const result = await runCli(["deps", repoPath, "--diagram"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("graph TD");
  }, 60_000);

  it("emits clean JSON for a non-npm (Cargo) repo without stdout noise", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-deps-e2e-"));
    tempDirs.push(tempDir);
    const repoPath = await createRepo(tempDir, {
      "Cargo.toml": '[dependencies]\nserde = { version = "1.0", features = ["derive"] }\n',
    });

    const result = await runCli(["deps", repoPath, "--json"]);
    expect(result.exitCode).toBe(0);
    // The npm extractor runs first and finds no package.json; it must not print
    // anything to stdout, so the JSON stays parseable.
    const parsed = JSON.parse(result.stdout);
    expect(parsed.packageManager).toBe("cargo");
    expect(parsed.runtime.map((d: { name: string }) => d.name)).toContain("serde");
  }, 60_000);
});
