import { execFile } from "child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";
import { createDiffHistory, fixtureGit } from "../helpers/diff-history.js";
import { packageFacts } from "../helpers/package-scope.js";

const exec = promisify(execFile),
  dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(extraMainCommits = 0) {
  const base = await mkdtemp(join(tmpdir(), "diff-baseline-cli-"));
  dirs.push(base);
  const history = await createDiffHistory(base, extraMainCommits),
    home = join(base, "owned-home");
  await mkdir(home);
  const response = join(base, "response.json"),
    facts = packageFacts("owned");
  facts.quickstart.commands = [];
  facts.firstTasks = [];
  await writeFile(response, JSON.stringify(facts));
  const preload = join(base, "preload.mjs");
  // A checked offline REST fixture and an execFile trace around the real local Git binary.
  // Redirect os.homedir before importing product modules; never touch shared home/cache state.
  await writeFile(
    preload,
    `
import os from 'node:os';
import cp from 'node:child_process';
import fs from 'node:fs';
import {promisify} from 'node:util';
import {syncBuiltinESMExports} from 'node:module';
os.homedir=()=>process.env.OWNED_DIFF_HOME;
const original=cp.execFile;
function traced(file,args,options,callback) {
  if(file==='git') fs.appendFileSync(process.env.OWNED_DIFF_GIT_LOG,JSON.stringify(args)+'\\n');
  if(file==='git' && args[0]==='fetch' && args.some(a=>a.startsWith('pull/')) && process.env.OWNED_DIFF_FALLBACK_REFS==='1') {
    queueMicrotask(()=>callback(new Error('Owned short PR ref unavailable'),'',''));
    return;
  }
  if(file==='git' && args.some(a=>a.startsWith('--deepen=')) && process.env.OWNED_DIFF_REJECT_DEEPEN==='1') {
    queueMicrotask(()=>callback(new Error('Owned history transport failure'),'',''));
    return;
  }
  return original(file,args,options,callback);
}
traced[promisify.custom]=(...args)=>new Promise((resolve,reject)=>traced(...args,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr})));
cp.execFile=traced;
syncBuiltinESMExports();
if(process.env.OWNED_DIFF_API_FILE) globalThis.fetch=async(url)=>{
  const fixture=JSON.parse(fs.readFileSync(process.env.OWNED_DIFF_API_FILE,'utf8'));
  if(String(url)!==fixture.expectedUrl) throw new Error('Unexpected network request '+url);
  return new Response(JSON.stringify(fixture.response),{status:200,headers:{'Content-Type':'application/json'}});
};
`
  );
  let runs = 0;
  async function run(args: string[], pr?: number, rejectDeepen = false, fallbackRefs = false) {
    const gitLog = join(base, `git-${runs}.jsonl`),
      apiFile = join(base, `api-${runs++}.json`);
    if (pr)
      await writeFile(
        apiFile,
        JSON.stringify({
          expectedUrl: `https://api.github.com/repos/owned/diff-fixture/pulls/${pr}`,
          response: {
            base: { ref: "main", sha: fallbackRefs ? "f".repeat(40) : history.main },
            head: {
              ref: pr === 1 ? "feature/readme" : pr === 2 ? "feature/package" : "unrelated",
              sha: pr === 1 ? history.readme : pr === 2 ? history.feature : history.unrelated,
            },
            title: "Owned PR",
            html_url: `https://github.com/owned/diff-fixture/pull/${pr}`,
          },
        })
      );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      OWNED_DIFF_HOME: home,
      OWNED_DIFF_GIT_LOG: gitLog,
      OWNED_DIFF_API_FILE: pr ? apiFile : "",
      OWNED_DIFF_REJECT_DEEPEN: rejectDeepen ? "1" : "0",
      OWNED_DIFF_FALLBACK_REFS: fallbackRefs ? "1" : "0",
      REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(history.remote).href}.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://github.com/owned/diff-fixture.git",
    };
    delete env.NODE_OPTIONS;
    delete env.GITHUB_TOKEN;
    delete env.REPO_BOOTCAMP_GITHUB_API_BASE_URL;
    const argv = [
      "--import",
      pathToFileURL(join(process.cwd(), "node_modules/tsx/dist/loader.mjs")).href,
      "--import",
      pathToFileURL(preload).href,
      join(process.cwd(), "src/cli.ts"),
      ...args,
    ];
    let result: { exitCode: number; stdout: string; stderr: string };
    try {
      const value = await exec(process.execPath, argv, {
        cwd: base,
        env,
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      result = { exitCode: 0, ...value };
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string };
      result = { exitCode: failure.code, stdout: failure.stdout, stderr: failure.stderr };
    }
    return {
      ...result,
      git: (await readFile(gitLog, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
    };
  }
  return { ...history, base, run };
}
const deepens = (commands: string[][]) =>
  commands.filter((args) => args.some((arg) => arg.startsWith("--deepen=")));

describe("actual Diff comparison baseline", () => {
  it.each([false, true])(
    "generates a coherent diverged README-only PR (full clone: %s)",
    async (fullClone) => {
      const f = await fixture(),
        output = join(f.base, "output");
      const result = await f.run(
        [
          "diff",
          "owned/diff-fixture#1",
          "--output",
          output,
          ...(fullClone ? ["--full-clone"] : []),
        ],
        1
      );
      expect(result.exitCode, result.stderr).toBe(0);
      const doc = await readFile(join(output, "DIFF.md"), "utf8");
      expect(doc).toContain("`main` → `PR #1 (feature/readme)`");
      expect(doc).toContain("No significant onboarding changes detected.");
      expect(doc).toContain("- `README.md`");
      expect(doc).not.toContain("main-only");
      expect(doc).not.toContain("npm run build");
      expect(deepens(result.git)).toHaveLength(fullClone ? 0 : 1);
      const clone = result.git.find((args) => args.includes("clone"))!;
      expect(clone.includes("--depth")).toBe(!fullClone);
      expect(await readdir(join(f.base, ".tmp"))).toEqual([]);
    }
  );

  it("preserves successful base-name and alternate PR-ref fallbacks during recovery", async () => {
    const f = await fixture(),
      output = join(f.base, "output");
    const result = await f.run(
      ["diff", "owned/diff-fixture#2", "--output", output],
      2,
      false,
      true
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.git.some((args) => args.includes(`${"f".repeat(40)}:pr-2-base`))).toBe(true);
    expect(result.git.some((args) => args.includes("main:pr-2-base"))).toBe(true);
    expect(result.git.some((args) => args.includes("pull/2/head:pr-2-head"))).toBe(true);
    expect(result.git.some((args) => args.includes("refs/pull/2/head:pr-2-head"))).toBe(true);
    expect(deepens(result.git).map((args) => args.slice(-2))).toEqual([
      ["main:pr-2-base", "refs/pull/2/head:pr-2-head"],
    ]);
    const doc = await readFile(join(output, "DIFF.md"), "utf8");
    expect(doc).toContain("Major version bump: 1.0.0 → 2.0.0");
    expect(doc).not.toContain("main-only");
  });

  it.each([80, 200])(
    "recovers only required PR histories at bounded depth (%s additional base commits)",
    async (count) => {
      const f = await fixture(count),
        output = join(f.base, "output");
      const result = await f.run(["diff", "owned/diff-fixture#2", "--output", output], 2);
      expect(result.exitCode, result.stderr).toBe(0);
      const attempts = deepens(result.git);
      expect(attempts.map((args) => args.find((arg) => arg.startsWith("--deepen=")))).toEqual(
        count === 80
          ? ["--deepen=32", "--deepen=128"]
          : ["--deepen=32", "--deepen=128", "--deepen=512"]
      );
      for (const args of attempts) {
        expect(args.slice(-2)).toEqual([`${f.main}:pr-2-base`, "pull/2/head:pr-2-head"]);
        expect(args).not.toContain("--unshallow");
        expect(args).not.toContain("--all");
      }
      const doc = await readFile(join(output, "DIFF.md"), "utf8");
      expect(doc).toContain("Major version bump: 1.0.0 → 2.0.0");
      expect(doc).toContain("feature-only");
      expect(doc).toContain(`npm run 'feature'"'"'check'`);
      expect(doc).not.toContain("main-only");
      expect(doc).not.toContain("npm run build");
    }
  );

  it.each([false, true])(
    "fails on unrelated histories with owned cleanup (keep-temp: %s)",
    async (keepTemp) => {
      const f = await fixture(),
        output = join(f.base, "output");
      const result = await f.run(
        ["diff", "owned/diff-fixture#3", "--output", output, ...(keepTemp ? ["--keep-temp"] : [])],
        3
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no common ancestor");
      expect(result.stderr).toContain("share Git history");
      expect(result.stdout).not.toContain("PR Diff Generated Successfully");
      expect(await readdir(join(f.base, ".tmp"))).toHaveLength(keepTemp ? 1 : 0);
      expect(await readdir(output).catch(() => [])).toEqual([]);
    }
  );

  it("stops after its fixed history budget and offers full-clone recovery", async () => {
    const f = await fixture(800),
      output = join(f.base, "output");
    const result = await f.run(["diff", "owned/diff-fixture#1", "--output", output], 1);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("bounded history limit (672 additional ancestry levels)");
    expect(result.stderr).toContain("--full-clone");
    expect(deepens(result.git)).toHaveLength(3);
    expect(await readdir(join(f.base, ".tmp"))).toEqual([]);
    expect(await readdir(output).catch(() => [])).toEqual([]);
    const full = await f.run(
      ["diff", "owned/diff-fixture#1", "--output", output, "--full-clone"],
      1
    );
    expect(full.exitCode, full.stderr).toBe(0);
    expect(deepens(full.git)).toEqual([]);
    expect(await readFile(join(output, "DIFF.md"), "utf8")).toContain(
      "No significant onboarding changes detected."
    );
  });

  it.each([false, true])(
    "settles failed history transport ownership (keep-temp: %s)",
    async (keepTemp) => {
      const f = await fixture(),
        result = await f.run(
          [
            "diff",
            "owned/diff-fixture#1",
            "--output",
            join(f.base, "output"),
            ...(keepTemp ? ["--keep-temp"] : []),
          ],
          1,
          true
        );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Could not recover PR history");
      expect(result.stderr).toContain("--full-clone");
      expect(result.stderr).toContain("Owned history transport failure");
      expect(deepens(result.git)).toHaveLength(1);
      expect(await readdir(join(f.base, ".tmp"))).toHaveLength(keepTemp ? 1 : 0);
    }
  );

  it.each([false, true])(
    "keeps local selected-scope Git context and literal guidance in fast=%s",
    async (fast) => {
      const f = await fixture(),
        output = join(f.base, "output");
      fixtureGit(f.repo, ["checkout", "feature/package"]);
      const result = await f.run([
        f.repo,
        "--no-clone",
        "--no-cache",
        "--compare",
        "main",
        "--subdir",
        "packages/app",
        "--output",
        output,
        ...(fast ? ["--fast"] : []),
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
      const doc = await readFile(join(output, "DIFF.md"), "utf8");
      expect(doc).toContain("`main` → `HEAD`");
      expect(doc).toContain("Major version bump: 1.0.0 → 2.0.0");
      expect(doc).toContain(`npm run 'feature'"'"'check'`);
      expect(doc).not.toContain("main-only");
      expect(doc).not.toContain("npm run build");
      expect(
        JSON.parse(await readFile(join(output, "ANALYSIS_MANIFEST.json"), "utf8")).options.subdir
      ).toBe("packages/app");
      expect(await readdir(join(f.repo, ".git"))).toContain("HEAD");
      expect(result.git.some((args) => args.includes("clone") || args[0] === "fetch")).toBe(false);
    }
  );
});
