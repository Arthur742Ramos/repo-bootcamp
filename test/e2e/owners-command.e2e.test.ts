import { execFileSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

const tempDirs: string[] = [];

async function createRepo(files: Record<string, string>): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-owners-e2e-"));
  tempDirs.push(base);
  const repoDir = join(base, "repo");
  await mkdir(repoDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoDir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf-8");
  }
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "a@example.com"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Alice"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], { cwd: repoDir, stdio: "ignore" });
  return repoDir;
}

const FILES: Record<string, string> = {
  ".github/CODEOWNERS": "* @org/maintainers\n/src/ @alice @bob\n/docs/ @carol\n",
  "src/index.ts": "export const x = 1;\n",
  "docs/guide.md": "# Guide\n",
};

describe("owners command", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("prints the ownership map for a repo with CODEOWNERS", async () => {
    const repoPath = await createRepo(FILES);
    const result = await runCli(["owners", repoPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Who Do I Ask");
    expect(result.stdout).toContain("@org/maintainers");
    expect(result.stdout).toContain("@alice");
  }, 60_000);

  it("emits ownership JSON (default owners, maintainers, per-area mapping)", async () => {
    const repoPath = await createRepo(FILES);
    const result = await runCli(["owners", repoPath, "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.defaultOwners).toEqual(["@org/maintainers"]);
    expect(parsed.maintainers).toContain("@carol");
    const src = parsed.areas.find((a: { dir: string }) => a.dir === "src");
    expect(src.owners).toEqual(["@alice", "@bob"]);
    const docs = parsed.areas.find((a: { dir: string }) => a.dir === "docs");
    expect(docs.owners).toEqual(["@carol"]);
  }, 60_000);
});
