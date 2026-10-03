import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { fetchAndCheckUpdates } from "../src/watch.js";
const exec = promisify(execFile);
const roots: string[] = [];
async function git(cwd: string, args: string[]) {
  return (await exec("git", args, { cwd })).stdout.trim();
}
async function commit(cwd: string, text: string) {
  await writeFile(join(cwd, "file.txt"), text);
  await git(cwd, ["add", "file.txt"]);
  await git(cwd, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    text,
    "--no-gpg-sign",
  ]);
  return git(cwd, ["rev-parse", "HEAD"]);
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bootcamp-watch-identity-"));
  roots.push(root);
  const remote = join(root, "remote.git"),
    seed = join(root, "seed"),
    working = join(root, "working");
  await git(root, ["init", "--bare", "-b", "main", remote]);
  await mkdir(seed);
  await git(seed, ["init", "-b", "main"]);
  const initial = await commit(seed, "initial");
  await git(seed, ["remote", "add", "origin", remote]);
  await git(seed, ["push", "--set-upstream", "origin", "main"]);
  await git(root, ["clone", remote, working]);
  return { seed, working, initial };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("watch checked-out commit identity", () => {
  it("reports the actual checked-out SHA after an upstream fast-forward", async () => {
    const { seed, working, initial } = await fixture();
    const updated = await commit(seed, "upstream update");
    await git(seed, ["push"]);
    expect(await fetchAndCheckUpdates(working, initial)).toEqual({
      updated: true,
      newSha: updated,
    });
    expect(await git(working, ["rev-parse", "HEAD"])).toBe(updated);
  });
  it("does not regenerate against an older upstream SHA when local HEAD is ahead", async () => {
    const { working } = await fixture();
    const local = await commit(working, "local ahead");
    expect(await fetchAndCheckUpdates(working, local)).toEqual({ updated: false, newSha: local });
    expect(await git(working, ["rev-parse", "HEAD"])).toBe(local);
  });
  it("detects a new local commit even when the upstream is unchanged", async () => {
    const { working, initial } = await fixture();
    const local = await commit(working, "local update");
    expect(await fetchAndCheckUpdates(working, initial)).toEqual({ updated: true, newSha: local });
  });
});
