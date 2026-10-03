import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";
const exec = promisify(execFile),
  root = process.cwd(),
  dirs: string[] = [];
const pkg = (name: string) => `[package]\nname="${name}"\nversion="0.1.0"\nedition="2021"\n`;
const ws = '[workspace]\nmembers=["crates/*"]\ndefault-members=["crates/b"]\nresolver="2"\n';
async function fixture(extra: Record<string, string> = {}, scoped = false, explicit = false) {
  const base = await mkdtemp(join(tmpdir(), "cargo-wildcard-cli-owned-"));
  dirs.push(base);
  const repo = join(base, "repo"),
    scope = scoped ? "packages/rust/" : "";
  await mkdir(join(base, "home"));
  const files = {
    "Cargo.toml": ws,
    "crates/a/Cargo.toml": pkg("owned_a"),
    "crates/a/src/lib.rs": "pub fn owned() {}\n",
    "crates/b/Cargo.toml": pkg("owned_b") + '[dependencies]\nowned_a={path="../a"}\n',
    "crates/b/src/lib.rs": "pub fn owned() {}\n",
    ...extra,
  };
  for (const [p, c] of Object.entries(files)) {
    await mkdir(join(repo, scope + p, ".."), { recursive: true });
    await writeFile(join(repo, scope + p), c);
  }
  const response = join(base, "response.json");
  await writeFile(
    response,
    JSON.stringify({
      repoName: "local/owned",
      purpose: "Owned Rust workspace",
      description: "Offline Cargo fixture",
      confidence: "high",
      sources: ["Cargo.toml"],
      stack: {
        languages: ["Rust"],
        frameworks: [],
        buildSystem: "Cargo",
        packageManager: "cargo",
        hasDocker: false,
        hasCi: false,
      },
      quickstart: {
        prerequisites: ["Rust and Cargo installed"],
        steps: [],
        commands: explicit
          ? [{ name: "documented", command: "cargo test --workspace", source: "README.md" }]
          : [],
        commonErrors: [],
        sources: ["Cargo.toml"],
      },
      structure: {
        keyDirs: [{ path: "crates", purpose: "Rust crates", keyFiles: ["Cargo.toml"] }],
        entrypoints: [{ path: "crates/b/src/lib.rs", type: "library", description: "Library" }],
        testDirs: [],
        docsDirs: [],
        sources: ["Cargo.toml"],
      },
      ci: { workflows: [], mainChecks: [], sources: [] },
      contrib: {
        howToAddFeature: ["Update library"],
        howToAddTest: ["Add test"],
        codeStyle: "Rust",
        sources: ["Cargo.toml"],
      },
      architecture: {
        overview: "Two packages",
        components: [{ name: "Library", description: "Rust library", directory: "crates" }],
        dataFlow: "Library calls",
        keyAbstractions: [],
        codeExamples: [],
        sources: ["Cargo.toml"],
      },
      firstTasks: [],
      runbook: {
        applicable: false,
        deploySteps: [],
        observability: [],
        incidents: [],
        sources: [],
      },
    })
  );
  const preload = join(base, "preload.mjs");
  await writeFile(
    preload,
    "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>process.env.OWNED_CARGO_HOME;syncBuiltinESMExports();globalThis.fetch=async()=>{throw Error('No provider calls authorized in owned fixture');};"
  );
  const run = async (args: string[]) => {
    const env = {
      ...process.env,
      NODE_ENV: "test",
      OWNED_CARGO_HOME: join(base, "home"),
      REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
    };
    delete env.NODE_OPTIONS;
    try {
      const r = await exec(
        process.execPath,
        [
          "--import",
          pathToFileURL(resolve(root, "node_modules/tsx/dist/loader.mjs")).href,
          "--import",
          pathToFileURL(preload).href,
          join(root, "src/cli.ts"),
          ...args,
        ],
        { cwd: base, env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }
      );
      return { status: 0, ...r };
    } catch (error) {
      const e = error as { code: number; stdout: string; stderr: string };
      return { status: e.code, stdout: e.stdout, stderr: e.stderr };
    }
  };
  return { base, repo, scope, run };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
describe("actual closed Cargo wildcard journeys", () => {
  it("reports selected workspace commands and category without evaluating project code", async () => {
    const f = await fixture({}, true);
    const r = await f.run(["tasks", f.repo, "--subdir", "packages/rust", "--json"]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).gettingStarted).toEqual(["cargo build", "cargo test"]);
    const tests = await f.run([
      "tasks",
      f.repo,
      "--subdir",
      "packages/rust",
      "--category",
      "test",
      "--json",
    ]);
    expect(tests.status, tests.stderr).toBe(0);
    expect(JSON.parse(tests.stdout).tasks.map((t: { command: string }) => t.command)).toEqual([
      "cargo test",
    ]);
  });
  it.each([false, true])(
    "generates selected-scope standard/fast=%s guidance and respects exclusions",
    async (fast) => {
      const f = await fixture({}, true),
        out = join(f.base, "output");
      const args = [
        f.repo,
        "--no-clone",
        "--no-cache",
        "--quiet",
        "--subdir",
        "packages/rust",
        "--output",
        out,
        ...(fast ? ["--fast"] : []),
      ];
      const r = await f.run(args);
      expect(r.status, r.stderr).toBe(0);
      const facts = JSON.parse(await readFile(join(out, "repo_facts.json"), "utf8"));
      expect(facts.quickstart.commands.map((t: { command: string }) => t.command)).toEqual([
        "cargo build",
        "cargo test",
      ]);
      const doc = await readFile(join(out, "ONBOARDING.md"), "utf8");
      expect(doc).toContain("cargo build");
      expect(doc).toContain("cargo test");
      expect(doc).toContain("`Cargo.toml`");
      expect(
        facts.quickstart.commands.every((t: { source: string }) => t.source === "Cargo.toml")
      ).toBe(true);
      expect(
        JSON.parse(await readFile(join(out, "ANALYSIS_MANIFEST.json"), "utf8")).options.subdir
      ).toBe("packages/rust");
      const excluded = await f.run([...args, "--exclude", "crates/a/**"]);
      expect(excluded.status, excluded.stderr).toBe(0);
      expect(
        JSON.parse(await readFile(join(out, "repo_facts.json"), "utf8")).quickstart.commands
      ).toEqual([]);
      expect(await readFile(join(out, "ONBOARDING.md"), "utf8")).not.toContain("cargo build");
    }
  );
  it.each([false, true])(
    "omits hidden auto-members from generated guidance in fast=%s",
    async (fast) => {
      const f = await fixture({
        "crates/a/Cargo.toml":
          pkg("owned_a") + '[dependencies]\nowned_internal={path="../../internal"}\n',
        "internal/Cargo.toml": pkg("owned_internal"),
        "internal/src/lib.rs": "pub fn owned() {}\n",
      });
      const out = join(f.base, "output");
      const r = await f.run([
        f.repo,
        "--no-clone",
        "--no-cache",
        "--quiet",
        "--output",
        out,
        ...(fast ? ["--fast"] : []),
      ]);
      expect(r.status, r.stderr).toBe(0);
      expect(
        JSON.parse(await readFile(join(out, "repo_facts.json"), "utf8")).quickstart.commands
      ).toEqual([]);
      expect(await readFile(join(out, "ONBOARDING.md"), "utf8")).not.toContain("cargo build");
    }
  );
  it.each([false, true])(
    "preserves declared precedence and explicit analyzed commands in fast=%s",
    async (fast) => {
      for (const explicit of [false, true]) {
        const f = await fixture(
            {
              Makefile: "build:\n\t@echo owned never execute\ntest:\n\t@echo owned never execute\n",
            },
            false,
            explicit
          ),
          out = join(f.base, "output");
        const r = await f.run([
          f.repo,
          "--no-clone",
          "--no-cache",
          "--quiet",
          "--output",
          out,
          ...(fast ? ["--fast"] : []),
        ]);
        expect(r.status, r.stderr).toBe(0);
        expect(
          JSON.parse(await readFile(join(out, "repo_facts.json"), "utf8")).quickstart.commands.map(
            (t: { command: string }) => t.command
          )
        ).toEqual(
          explicit
            ? ["cargo test --workspace"]
            : ["make build", "make test", "cargo build", "cargo test"]
        );
      }
    }
  );
});
