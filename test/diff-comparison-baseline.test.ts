import { execFileSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeDiff, getChangedFiles } from "../src/diff.js";
import { createMergedDiffHistory, fixtureGit } from "./helpers/diff-history.js";

const dirs: string[] = [];
const git = (dir: string, args: string[]) =>
  execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
async function history() {
  const dir = await mkdtemp(join(tmpdir(), "diff-common-baseline-"));
  dirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "owned@example.invalid"]);
  git(dir, ["config", "user.name", "Owned Diff fixture"]);
  const pkg = { version: "1.0.0", scripts: { build: "echo build" }, dependencies: { shared: "1" } };
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg));
  await writeFile(join(dir, "README.md"), "# Owned fixture\n");
  await mkdir(join(dir, "src"));
  await writeFile(join(dir, "src/index.ts"), "export const original = process.env.COMMON_VALUE;\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "--no-gpg-sign", "-m", "ancestor"]);
  const ancestor = git(dir, ["rev-parse", "HEAD"]);
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      version: "3.0.0",
      scripts: {},
      dependencies: { shared: "1", "main-only": "1" },
    })
  );
  await writeFile(join(dir, "src/index.ts"), "export const main = process.env.MAIN_VALUE;\n");
  git(dir, ["commit", "--no-gpg-sign", "-am", "main-only changes"]);
  git(dir, ["checkout", "-b", "feature", ancestor]);
  return { dir, pkg, ancestor };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("shared Diff comparison baseline", () => {
  it("keeps a README-only feature free of base-tip package, environment and export changes", async () => {
    const { dir } = await history();
    await writeFile(join(dir, "README.md"), "# Owned fixture\n\nFeature documentation.\n");
    git(dir, ["commit", "--no-gpg-sign", "-am", "readme feature"]);
    const diff = await analyzeDiff(dir, "main", "feature");
    expect(diff.baseRef).toBe("main");
    expect(diff.headRef).toBe("feature");
    expect(diff.filesModified).toEqual(["README.md"]);
    expect(diff.filesChanged).toBe(1);
    expect(diff.onboardingDeltas).toEqual({
      newDependencies: [],
      removedDependencies: [],
      newCommands: [],
      newEnvVars: [],
      breakingChanges: [],
    });
    expect(await getChangedFiles(dir, "main", "feature")).toEqual({
      added: [],
      removed: [],
      modified: ["README.md"],
    });
  });

  it("reports feature package/version changes from the same ancestor as files and code", async () => {
    const { dir, pkg } = await history();
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        ...pkg,
        version: "2.0.0",
        scripts: { ...pkg.scripts, "feature'check": "echo feature" },
        dependencies: { ...pkg.dependencies, "feature-only": "1" },
      })
    );
    await writeFile(
      join(dir, "src/index.ts"),
      "export const feature = process.env.FEATURE_VALUE;\n"
    );
    git(dir, ["commit", "--no-gpg-sign", "-am", "package feature"]);
    const diff = await analyzeDiff(dir, "main");
    expect(diff.baseRef).toBe("main");
    expect(diff.headRef).toBe("HEAD");
    expect(diff.filesModified).toEqual(["package.json", "src/index.ts"]);
    expect(diff.onboardingDeltas.newDependencies).toEqual(["feature-only"]);
    expect(diff.onboardingDeltas.removedDependencies).toEqual([]);
    expect(diff.onboardingDeltas.newCommands).toEqual([`npm run 'feature'"'"'check'`]);
    expect(diff.onboardingDeltas.newEnvVars).toEqual(["FEATURE_VALUE"]);
    expect(diff.onboardingDeltas.breakingChanges).toEqual([
      "Major version bump: 1.0.0 → 2.0.0",
      "Removed export: original in src/index.ts",
    ]);
  });

  it("retains ancestor and same-ref comparison behavior", async () => {
    const { dir, ancestor } = await history();
    const diff = await analyzeDiff(dir, ancestor, "main");
    expect(diff.onboardingDeltas.newDependencies).toEqual(["main-only"]);
    expect(diff.onboardingDeltas.breakingChanges).toContain("Major version bump: 1.0.0 → 3.0.0");
    expect((await analyzeDiff(dir, "main", "main")).filesChanged).toBe(0);
  });

  it("refuses an uncertified local shallow base until the relevant merge ancestry is available", async () => {
    const base = await mkdtemp(join(tmpdir(), "diff-local-shallow-"));
    dirs.push(base);
    const f = await createMergedDiffHistory(base),
      clone = join(base, "clone");
    fixtureGit(base, ["clone", "--depth", "1", pathToFileURL(f.remote).href, clone]);
    fixtureGit(clone, [
      "fetch",
      "--quiet",
      "origin",
      `${f.main}:owned-base`,
      "pull/1/head:owned-head",
    ]);
    fixtureGit(clone, [
      "fetch",
      "--quiet",
      "--deepen=32",
      "origin",
      `${f.main}:owned-base`,
      "pull/1/head:owned-head",
    ]);
    expect(fixtureGit(clone, ["merge-base", "owned-base", "owned-head"])).toBe(f.ancestor);
    expect(fixtureGit(f.repo, ["merge-base", "main", "feature/readme"])).toBe(f.newerBase);
    await expect(analyzeDiff(clone, "owned-base", "owned-head")).rejects.toThrow(
      "sufficiently complete history"
    );
    expect((await analyzeDiff(clone, "owned-head", "owned-head")).filesChanged).toBe(0);
    fixtureGit(clone, [
      "fetch",
      "--quiet",
      "--deepen=128",
      "origin",
      `${f.main}:owned-base`,
      "pull/1/head:owned-head",
    ]);
    const diff = await analyzeDiff(clone, "owned-base", "owned-head");
    expect(diff.filesModified).toEqual(["README.md"]);
    expect(diff.onboardingDeltas.newDependencies).toEqual([]);
    expect(diff.onboardingDeltas.breakingChanges).toEqual([]);
  });

  it("fails clearly for unrelated histories and missing comparison refs", async () => {
    const { dir } = await history();
    git(dir, ["checkout", "--orphan", "unrelated"]);
    git(dir, ["rm", "-rf", "."]);
    await writeFile(join(dir, "README.md"), "# Separate history\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "--no-gpg-sign", "-m", "unrelated"]);
    await expect(analyzeDiff(dir, "main", "unrelated")).rejects.toThrow("no common ancestor");
    await expect(analyzeDiff(dir, "missing-owned-ref", "main")).rejects.toThrow("Verify the refs");
  });
});
