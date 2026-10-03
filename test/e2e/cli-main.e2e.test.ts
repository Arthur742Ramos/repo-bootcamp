import { execFileSync } from "child_process";
import { once } from "events";
import { pathToFileURL } from "url";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import type { RepoFacts } from "../../src/types.js";
import { runCli, spawnCli, waitForOutput } from "./helpers.js";

async function createFixtureRepo(baseDir: string): Promise<string> {
  const repoDir = join(baseDir, "fixture-cli-repo");
  await mkdir(join(repoDir, "src"), { recursive: true });
  await mkdir(join(repoDir, "test"), { recursive: true });
  await mkdir(join(repoDir, ".github", "workflows"), { recursive: true });

  await writeFile(
    join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-cli-repo",
        version: "1.0.0",
        engines: { node: ">=20.0.0" },
        scripts: {
          build: "echo build",
          test: "echo test",
        },
        dependencies: {
          express: "^4.0.0 || ^5.0.0",
        },
        devDependencies: {
          vitest: "^4.0.0",
          typescript: "^5.0.0",
        },
      },
      null,
      2
    ),
    "utf-8"
  );

  await writeFile(
    join(repoDir, "README.md"),
    "# Fixture CLI Repo\n\nA local repository used for CLI end-to-end tests.\n",
    "utf-8"
  );
  await writeFile(
    join(repoDir, "src", "index.ts"),
    'import express from "express";\nexport const app = express();\n',
    "utf-8"
  );
  await writeFile(
    join(repoDir, "src", "utils.ts"),
    "export function sum(a: number, b: number) {\n  return a + b;\n}\n",
    "utf-8"
  );
  await writeFile(
    join(repoDir, "test", "utils.test.ts"),
    'import { sum } from "../src/utils";\nconsole.log(sum(1, 2));\n',
    "utf-8"
  );
  await writeFile(
    join(repoDir, ".github", "workflows", "ci.yml"),
    "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
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

function buildMockFacts(repoName: string): RepoFacts {
  return {
    repoName,
    purpose: "A local fixture repo for end-to-end CLI coverage",
    description: "Minimal Express application used to verify the full generator command.",
    confidence: "high",
    sources: ["README.md", "package.json"],
    stack: {
      languages: ["TypeScript"],
      frameworks: ["Express"],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: true,
    },
    quickstart: {
      prerequisites: ["Node.js 20+"],
      steps: ["npm install", "npm test"],
      commands: [
        { name: "test", command: "npm test", source: "package.json" },
        { name: "build", command: "npm run build", source: "package.json" },
      ],
      commonErrors: [],
      sources: ["README.md"],
    },
    structure: {
      keyDirs: [{ path: "src/", purpose: "Source code", keyFiles: ["src/index.ts"] }],
      entrypoints: [{ path: "src/index.ts", type: "main", description: "Express app entrypoint" }],
      testDirs: ["test"],
      docsDirs: [],
      sources: ["src/index.ts", "package.json"],
    },
    ci: {
      workflows: [
        {
          name: "CI",
          file: ".github/workflows/ci.yml",
          triggers: ["push"],
          mainSteps: ["npm test"],
        },
      ],
      mainChecks: ["Tests pass"],
      sources: [".github/workflows/ci.yml"],
    },
    contrib: {
      howToAddFeature: ["Create code in src/", "Add or update tests"],
      howToAddTest: ["Add a .test.ts file in test/"],
      codeStyle: "TypeScript with straightforward module structure",
      sources: ["README.md"],
    },
    architecture: {
      overview: "Small Express application with a utility module and a single entrypoint.",
      components: [
        { name: "Application", description: "Express app bootstrap", directory: "src/" },
      ],
      dataFlow: "CLI or HTTP interaction -> app logic -> response",
      keyAbstractions: [{ name: "app", description: "Express application instance" }],
      codeExamples: [
        {
          title: "Express app bootstrap",
          file: "src/index.ts",
          code: "export const app = express();",
          explanation: "Initializes the application instance exported by the module.",
        },
      ],
      sources: ["src/index.ts"],
    },
    firstTasks: [
      {
        title: "Add a health check route",
        description: "Expose a `/health` endpoint for smoke checks.",
        difficulty: "beginner",
        category: "feature",
        files: ["src/index.ts"],
        why: "It touches the entrypoint and produces an immediately testable improvement.",
      },
    ],
    runbook: {
      applicable: false,
      deploySteps: [],
      observability: [],
      incidents: [],
      sources: [],
    },
  };
}

describe("bootcamp CLI", () => {
  const tempDirs: string[] = [];
  const children: ReturnType<typeof spawnCli>[] = [];

  afterEach(async () => {
    await Promise.all(
      children.splice(0).map(async ({ child }) => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");
          await once(child, "close");
        }
      })
    );
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it.each([
    ["standard", "release/v2"],
    ["fast", "release/v2"],
    ["standard", "v2.0"],
    ["fast", "v2.0"],
  ])("recreates the analyzed %s checkout for remote ref %s", async (mode, ref) => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-ref-kit-"));
    tempDirs.push(tempDir);
    const repo = await createFixtureRepo(tempDir);
    execFileSync("git", ["checkout", "-b", "release/v2"], { cwd: repo, stdio: "ignore" });
    const selected = join(repo, "packages", "release app");
    await mkdir(join(selected, "src"), { recursive: true });
    await writeFile(
      join(selected, "package.json"),
      JSON.stringify({ name: "release-app", scripts: { test: "echo fixture" } })
    );
    await writeFile(join(selected, "src", "index.ts"), "export const releaseOnly = true;\n");
    execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["commit", "--no-gpg-sign", "-m", "Release-only package"], {
      cwd: repo,
      stdio: "ignore",
    });
    execFileSync("git", ["tag", "v2.0"], { cwd: repo, stdio: "ignore" });
    const expectedSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf-8",
    }).trim();
    execFileSync("git", ["checkout", "main"], { cwd: repo, stdio: "ignore" });
    const url = "https://github.com/owned/fixture-cli-repo";
    const response = join(tempDir, "response.json");
    await writeFile(response, JSON.stringify(buildMockFacts("owned/fixture-cli-repo")));
    const env = {
      NODE_ENV: "test",
      REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(repo).href}.insteadOf`,
      GIT_CONFIG_VALUE_0: url + ".git",
    };
    const output = join(tempDir, "output");
    const result = await runCli(
      [
        url,
        "--branch",
        ref,
        "--subdir",
        "packages/release app",
        "--no-cache",
        "--quiet",
        "--output",
        output,
        ...(mode === "fast" ? ["--fast"] : []),
      ],
      env,
      60_000,
      tempDir
    );
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    const guide = await readFile(join(output, "ONBOARDING.md"), "utf-8");
    expect(guide).toContain(`git clone --branch '${ref}' -- '${url}.git'`);
    expect(guide).toContain("cd -- 'fixture-cli-repo/packages/release app'");
    expect(guide).toContain("npm test");
    const manifest = JSON.parse(await readFile(join(output, "ANALYSIS_MANIFEST.json"), "utf-8"));
    expect(manifest.repository.commitSha).toBe(expectedSha);
    expect(manifest.repository.branch).toBe(ref === "v2.0" ? "HEAD" : "release/v2");
    const sourceRef = ref === "v2.0" ? expectedSha : "release/v2";
    const codemap = await readFile(join(output, "CODEMAP.md"), "utf-8");
    expect(codemap).toContain(
      `https://github.com/owned/fixture-cli-repo/blob/${sourceRef}/packages/release%20app/src/index.ts`
    );
    if (ref === "v2.0") expect(codemap).not.toContain("/blob/HEAD/");

    const clone = guide.split("\n").find((line) => line.startsWith("git clone "))!;
    const cloneArgs = clone.match(/^git clone --branch '([^']+)' -- '([^']+)'$/)!;
    expect(cloneArgs).not.toBeNull();
    const verify = join(tempDir, "verify");
    await mkdir(verify);
    execFileSync("git", ["clone", "--branch", cloneArgs[1], "--", cloneArgs[2]], {
      cwd: verify,
      env: { ...process.env, ...env },
      stdio: "ignore",
    });
    const cloned = join(verify, "fixture-cli-repo");
    expect(
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: cloned, encoding: "utf-8" }).trim()
    ).toBe(expectedSha);
    expect(
      await readFile(join(cloned, "packages", "release app", "src", "index.ts"), "utf-8")
    ).toContain("releaseOnly");
    expect(await readdir(join(tempDir, ".tmp"))).toEqual([]);
  });

  it.each(["standard", "fast"])(
    "preserves literal command text in saved %s Markdown, HTML and PDF-ready exports",
    async (mode) => {
      const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-command-markdown-"));
      tempDirs.push(tempDir);
      const repo = await createFixtureRepo(tempDir);
      const facts = buildMockFacts(`local/${basename(repo)}`);
      const commands = [
        { name: "install", command: "echo 'install```literal```'", source: "README.md" },
        { name: "test literal", command: "npm run 'test`literal`'", source: "package.json" },
        { name: "dev literal", command: "npm run 'dev```literal```'", source: "package.json" },
        { name: "build", command: "printf 'first\n```\nlast'  ", source: "README.md" },
      ];
      facts.quickstart.commands = commands;
      const response = join(tempDir, "response.json");
      await writeFile(response, JSON.stringify(facts));
      for (const format of ["markdown", "html", "pdf"]) {
        const output = join(tempDir, format);
        const result = await runCli(
          [
            repo,
            "--no-clone",
            "--no-cache",
            ...(mode === "fast" ? ["--fast"] : []),
            "--format",
            format,
            "--output",
            output,
          ],
          {
            NODE_ENV: "test",
            REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
          }
        );
        expect(result.exitCode, result.stderr).toBe(0);
        const actual = JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8"));
        expect(actual.quickstart.commands).toEqual(commands);
        const extension = format === "markdown" ? ".md" : ".html";
        for (const name of ["BOOTCAMP", "ONBOARDING"]) {
          const document = await readFile(join(output, name + extension), "utf8");
          if (format === "markdown") {
            for (const command of commands) expect(document).toContain(command.command);
            expect(document).toContain("````bash");
          } else {
            const code = [...document.matchAll(/<code(?: [^>]*)?>([\s\S]*?)<\/code>/g)].map(
              (match) =>
                match[1]
                  .replaceAll("&quot;", '"')
                  .replaceAll("&lt;", "<")
                  .replaceAll("&gt;", ">")
                  .replaceAll("&amp;", "&")
            );
            for (const command of commands) expect(code).toContain(command.command);
            expect(document).toContain('tabindex="0" role="region" aria-label="Code block"');
          }
        }
      }
    },
    60_000
  );

  it.each(["standard", "fast"])(
    "uses only public zero-argument Just commands in saved %s onboarding guidance",
    async (mode) => {
      const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-just-kit-"));
      tempDirs.push(tempDir);
      const repo = join(tempDir, "repo");
      const selected = join(repo, "packages", "app");
      await mkdir(selected, { recursive: true });
      await writeFile(join(repo, "justfile"), "outer:\n    @echo outer\n");
      await writeFile(join(repo, ".justfile"), "other:\n    @echo other\n");
      await writeFile(
        join(selected, "Justfile"),
        `dev target:
    @echo {{target}}
[private]
setup:
    @echo helper
_helper:
    @echo helper
build mode='debug':
    @echo {{mode}}
test *FILES:
    @echo {{FILES}}
`
      );
      const facts = buildMockFacts(`local/${basename(repo)}`);
      facts.stack.packageManager = undefined;
      facts.quickstart.commands = [];
      facts.quickstart.steps = ["Read the repository setup guide"];
      const response = join(tempDir, "response.json");
      const output = join(tempDir, "out");
      await writeFile(response, JSON.stringify(facts));
      const result = await runCli(
        [
          repo,
          "--no-clone",
          "--no-cache",
          "--subdir",
          "packages/app",
          ...(mode === "fast" ? ["--fast"] : []),
          "--output",
          output,
        ],
        { NODE_ENV: "test", REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response }
      );
      expect(result.exitCode).toBe(0);
      const generated = JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8"));
      expect(
        generated.quickstart.commands.map((command: { command: string }) => command.command)
      ).toEqual(["just build", "just test"]);
      expect(generated.quickstart.steps).toEqual(facts.quickstart.steps);
      const onboarding = await readFile(join(output, "ONBOARDING.md"), "utf8");
      const bootcamp = await readFile(join(output, "BOOTCAMP.md"), "utf8");
      for (const document of [onboarding, bootcamp]) {
        expect(document).toContain("just build");
        expect(document).toContain("just test");
        expect(document).not.toContain("just dev");
        expect(document).not.toContain("just setup");
        expect(document).not.toContain("just _helper");
        expect(document).not.toContain("just outer");
      }
    },
    60_000
  );

  it.each(["standard", "fast"])(
    "uses scoped native Cargo defaults in saved %s guidance and retains explicit analysis commands",
    async (mode) => {
      const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-cargo-kit-"));
      tempDirs.push(tempDir);
      const repo = join(tempDir, "repo");
      const selected = join(repo, "crates", "core");
      await mkdir(join(selected, "src"), { recursive: true });
      await writeFile(
        join(repo, "Cargo.toml"),
        '[workspace]\nmembers=["crates/core"]\nresolver="2"\n'
      );
      await writeFile(
        join(selected, "Cargo.toml"),
        '[package]\nname="owned-core"\nversion="0.1.0"\nedition="2021"\n'
      );
      await writeFile(join(selected, "src/lib.rs"), "pub fn answer() -> u32 { 42 }\n");
      const facts = buildMockFacts("local/owned-rust");
      facts.stack = {
        languages: ["Rust"],
        frameworks: [],
        packageManager: "cargo",
        buildSystem: "cargo",
        hasCi: false,
        hasDocker: false,
      };
      facts.quickstart.commands = [];
      facts.quickstart.steps = ["Read the repository setup guide"];
      const response = join(tempDir, "response.json");
      await writeFile(response, JSON.stringify(facts));
      const args = [
        repo,
        "--no-clone",
        "--no-cache",
        "--subdir",
        "crates/core",
        ...(mode === "fast" ? ["--fast"] : []),
      ];
      const output = join(tempDir, "out");
      const result = await runCli([...args, "--output", output], {
        NODE_ENV: "test",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
      });
      expect(result.exitCode).toBe(0);
      const generated = JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8"));
      expect(
        generated.quickstart.commands.map((command: { command: string }) => command.command)
      ).toEqual(["cargo build", "cargo test"]);
      expect(generated.quickstart.steps).toEqual(facts.quickstart.steps);
      for (const document of ["ONBOARDING.md", "BOOTCAMP.md"]) {
        const text = await readFile(join(output, document), "utf8");
        expect(text).toContain("cargo build");
        expect(text).toContain("cargo test");
        expect(text).not.toContain("cargo run");
        expect(text).not.toContain("cargo install");
      }
      facts.quickstart.commands = [
        { name: "build", command: "cargo build --release", source: "README.md" },
        { name: "test", command: "cargo test --lib", source: "README.md" },
      ];
      await writeFile(response, JSON.stringify(facts));
      const explicit = join(tempDir, "explicit");
      const explicitResult = await runCli([...args, "--output", explicit], {
        NODE_ENV: "test",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
      });
      expect(explicitResult.exitCode).toBe(0);
      expect(
        JSON.parse(await readFile(join(explicit, "repo_facts.json"), "utf8")).quickstart.commands
      ).toEqual(facts.quickstart.commands);
      const excluded = join(tempDir, "excluded");
      facts.quickstart.commands = [];
      await writeFile(response, JSON.stringify(facts));
      const excludedResult = await runCli(
        [...args, "--exclude", "src/lib.rs", "--output", excluded],
        { NODE_ENV: "test", REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response }
      );
      expect(excludedResult.exitCode).toBe(0);
      expect(
        JSON.parse(await readFile(join(excluded, "repo_facts.json"), "utf8")).quickstart.commands
      ).toEqual([]);
    },
    60_000
  );

  it.each(["standard", "fast"])(
    "keeps literal package script commands in the generated %s guide",
    async (mode) => {
      const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-package-script-kit-"));
      tempDirs.push(tempDir);
      const repo = await createFixtureRepo(tempDir);
      await writeFile(
        join(repo, "package.json"),
        JSON.stringify({
          name: "fixture-cli-repo",
          private: true,
          scripts: {
            "build app": "echo build",
            "test unit": "echo unit",
            "test'quoted": "echo quote",
            "dev;literal": "echo dev",
            "--test": "echo option",
          },
        })
      );
      const facts = buildMockFacts(`local/${basename(repo)}`);
      facts.quickstart.commands = [];
      facts.quickstart.steps = ["Read the repository setup guide"];
      const response = join(tempDir, "response.json");
      const output = join(tempDir, "out");
      await writeFile(response, JSON.stringify(facts));
      const result = await runCli(
        [
          repo,
          "--no-clone",
          "--no-cache",
          ...(mode === "fast" ? ["--fast"] : []),
          "--output",
          output,
        ],
        {
          NODE_ENV: "test",
          REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
        }
      );
      expect(result.exitCode).toBe(0);
      const generated = JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8"));
      const commands = [
        "npm run 'build app'",
        "npm run 'test unit'",
        `npm run 'test'"'"'quoted'`,
        "npm run 'dev;literal'",
        "npm run -- --test",
      ];
      expect(
        generated.quickstart.commands.map((command: { command: string }) => command.command)
      ).toEqual(commands);
      expect(
        generated.quickstart.commands.map((command: { name: string }) => command.name)
      ).toEqual(["build app", "test unit", "test'quoted", "dev;literal", "--test"]);
      expect(generated.quickstart.steps).toEqual(facts.quickstart.steps);
      const onboarding = await readFile(join(output, "ONBOARDING.md"), "utf8");
      const bootcamp = await readFile(join(output, "BOOTCAMP.md"), "utf8");
      for (const command of commands)
        expect(onboarding).toContain(`\`\`\`bash\n${command}\n\`\`\``);
      expect(onboarding).toContain("## Running Tests\n\n```bash\nnpm run 'test unit'\n```");
      for (const command of commands) expect(bootcamp).toContain(`\`${command}\``);
      expect(bootcamp).toContain("Build/verify: `npm run 'build app'`");
      expect(onboarding).not.toContain("```bash\nnpm run test unit\n```");
    },
    60_000
  );

  it.each(["standard", "fast"])(
    "uses scoped local Task commands when the saved %s response has no commands",
    async (mode) => {
      const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-task-kit-"));
      tempDirs.push(tempDir);
      const repo = join(tempDir, "repo");
      const selected = join(repo, "packages", "app");
      await mkdir(join(selected, "taskfiles"), { recursive: true });
      await writeFile(join(repo, "Taskfile.yml"), "version: '3'\ntasks: {outer: 'echo outer'}");
      await writeFile(
        join(selected, "Taskfile.yml"),
        "version: '3'\nincludes: {app: './taskfiles/app.yml', ignored: {taskfile: './ignored.yml', optional: true}}\n"
      );
      await writeFile(
        join(selected, "taskfiles", "app.yml"),
        "version: '3'\ntasks:\n  build: {desc: Build app, cmds: ['echo build']}\n  test: {desc: Test app, cmds: ['echo test']}\n"
      );
      await writeFile(
        join(selected, "ignored.yml"),
        "version: '3'\ntasks: {secret: 'echo secret'}"
      );
      const facts = buildMockFacts(`local/${basename(repo)}`);
      facts.stack.packageManager = undefined;
      facts.quickstart.commands = [];
      facts.quickstart.steps = ["Read the repository setup guide"];
      const response = join(tempDir, "response.json");
      const output = join(tempDir, "out");
      await writeFile(response, JSON.stringify(facts));
      const result = await runCli(
        [
          repo,
          "--no-clone",
          "--no-cache",
          "--subdir",
          "packages/app",
          "--exclude",
          "ignored.yml",
          ...(mode === "fast" ? ["--fast"] : []),
          "--output",
          output,
        ],
        {
          NODE_ENV: "test",
          REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
        }
      );
      expect(result.exitCode).toBe(0);
      const generated = JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8"));
      expect(
        generated.quickstart.commands.map((command: { command: string }) => command.command)
      ).toEqual(["task app:build", "task app:test"]);
      expect(generated.quickstart.steps).toEqual(facts.quickstart.steps);
      const onboarding = await readFile(join(output, "ONBOARDING.md"), "utf8");
      const bootcamp = await readFile(join(output, "BOOTCAMP.md"), "utf8");
      expect(onboarding).toContain("task app:test");
      expect(bootcamp).toContain("task app:build");
      expect(bootcamp).not.toContain("task outer");
      expect(bootcamp).not.toContain("task ignored:secret");
    },
    60_000
  );

  it.each([
    ["default", "markdown"],
    ["default", "html"],
    ["default", "pdf"],
    ["excluded", "html"],
    ["plugin", "pdf"],
    ["quiet", "html"],
    ["json", "html"],
    ["quiet-json", "html"],
    ["preview", "html"],
    ["aliases", "html"],
    ["case", "html"],
    ["case-output-alias", "html"],
  ])("reports only emitted files for %s (%s)", async (mode, format) => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-output-summary-"));
    tempDirs.push(tempDir);
    const repo = join(tempDir, "repo");
    const output = join(tempDir, "out");
    await mkdir(repo);
    if (mode === "case-output-alias") {
      const actual = join(tempDir, "OwnedOutput");
      await mkdir(actual);
      await symlink(actual, output, "junction");
    } else await mkdir(output);
    await writeFile(join(repo, "README.md"), "# Output summary fixture\n");
    await writeFile(join(output, "UNRELATED.txt"), "Keep this pre-existing file");
    const response = join(tempDir, "response.json");
    await writeFile(response, JSON.stringify(buildMockFacts("local/summary-fixture")));
    if (mode === "excluded") {
      await writeFile(
        join(tempDir, ".bootcamprc.json"),
        JSON.stringify({
          output: { excludeDocs: ["BOOTCAMP.md", "ONBOARDING.md", "SECURITY.md"] },
        })
      );
    }
    if (["plugin", "aliases", "case", "case-output-alias"].includes(mode)) {
      const plugin = join(tempDir, "formatter.mjs");
      await writeFile(
        plugin,
        mode === "case" || mode === "case-output-alias"
          ? "export default {type:'formatter',name:'summary-case',formatDocuments(docs){return docs.filter(d=>d.name==='BOOTCAMP.md').flatMap(d=>[d,{...d,name:'bootcamp.md'}]).concat({name:'SUMMARY.json',content:'plugin metadata'},{name:'analysis_manifest.json',content:'plugin metadata'});}};"
          : mode === "aliases"
            ? "export default {type:'formatter',name:'summary-aliases',formatDocuments(docs){return docs.filter(d=>d.name==='BOOTCAMP.md').flatMap(d=>[d,{...d,name:'./BOOTCAMP.md'}]).concat({name:'./summary.json',content:'plugin metadata'},{name:'./ANALYSIS_MANIFEST.json',content:'plugin metadata'});}};"
            : "export default {type:'formatter',name:'summary-fixture',formatDocuments(docs){return docs.filter(d=>d.name!=='SECURITY.md').map(d=>d.name==='BOOTCAMP.md'?{...d,name:'WELCOME.md'}:d).concat({name:'PLUGIN_GUIDE.md',content:'# Plugin guide'},{name:'summary.json',content:'plugin metadata'},{name:'ANALYSIS_MANIFEST.json',content:'plugin metadata'});}};"
      );
      await writeFile(
        join(tempDir, ".bootcamprc.json"),
        JSON.stringify({ plugins: [pathToFileURL(plugin).href] })
      );
    }
    const quiet = mode === "quiet" || mode === "quiet-json";
    const jsonOnly = mode === "json" || mode === "quiet-json";
    const result = await runCli(
      [
        repo,
        "--no-clone",
        "--no-cache",
        "--format",
        format,
        "--output",
        output,
        ...(quiet ? ["--quiet"] : []),
        ...(jsonOnly ? ["--json-only"] : []),
        ...(mode === "preview" ? ["--create-issues", "--dry-run"] : []),
      ],
      { NODE_ENV: "test", REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response },
      60_000,
      tempDir
    );
    expect(result.exitCode).toBe(0);
    const files = (await readdir(output)).filter((name) => name !== "UNRELATED.txt").sort();
    const summary = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
    expect([...summary.files].sort()).toEqual(files);
    expect(new Set(summary.files).size).toBe(files.length);
    expect(summary.repo).toMatch(/^local\//);
    const manifest = JSON.parse(await readFile(join(output, "ANALYSIS_MANIFEST.json"), "utf8"));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.repository.fullName).toBe(summary.repo);
    expect(await readFile(join(output, "UNRELATED.txt"), "utf8")).toBe(
      "Keep this pre-existing file"
    );
    const stdout = result.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    const combined = (result.stdout + result.stderr).replace(/\x1b\[[0-9;]*m/g, "");
    const advertised = [...stdout.matchAll(/^  [├└]── (.+?)(?: +→.*)?$/gm)].map(
      (match) => match[1]
    );
    if (quiet || jsonOnly) expect(advertised).toEqual([]);
    else expect(advertised.sort()).toEqual(files);
    if (quiet) {
      expect(stdout.trim()).toBe(jsonOnly ? "" : output);
      expect(stdout).not.toContain("Next step");
    } else {
      expect(combined).toContain(`Generated ${files.length} files (including manifest)`);
      const next = stdout.match(/Next step: open (.+)/)?.[1];
      expect(next).toBeDefined();
      expect(await readFile(next!, "utf8")).not.toBe("");
    }
    expect(files).not.toContain("DEPENDENCIES.html");
    expect(files).not.toContain("DEPENDENCIES.md");
    if (mode === "excluded") {
      expect(advertised).not.toContain("BOOTCAMP.html");
      expect(stdout).not.toContain(`open ${output}/BOOTCAMP.html`);
    }
    if (mode === "plugin") {
      expect(files).toContain("WELCOME.html");
      expect(files).toContain("PLUGIN_GUIDE.html");
      expect(stdout).not.toContain(`open ${output}/BOOTCAMP.html`);
    }
    if (jsonOnly)
      expect(files).toEqual(["ANALYSIS_MANIFEST.json", "repo_facts.json", "summary.json"]);
    if (mode === "preview") expect(files).toContain("ISSUES_PREVIEW.html");
    if (mode === "aliases")
      expect(files).toEqual(["ANALYSIS_MANIFEST.json", "BOOTCAMP.html", "summary.json"]);
    if (mode === "case" || mode === "case-output-alias") {
      const expectedPaths = [
        "BOOTCAMP.html",
        "bootcamp.html",
        "SUMMARY.json",
        "analysis_manifest.json",
        "ANALYSIS_MANIFEST.json",
        "summary.json",
      ];
      const actualNames = await Promise.all(
        expectedPaths.map(async (name) => basename(await realpath(join(output, name))))
      );
      expect(files).toEqual([...new Set(actualNames)].sort());
      expect(files).not.toContain("ONBOARDING.html");
      expect(files).not.toContain("repo_facts.json");
    }
  });

  it("generates the onboarding kit through the real CLI process", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-cli-e2e-"));
    tempDirs.push(tempDir);

    const repoPath = await createFixtureRepo(tempDir);
    const outputDir = join(tempDir, "bootcamp-output");
    const responseFile = join(tempDir, "mock-response.json");
    const repoName = `local/${basename(repoPath)}`;
    await writeFile(responseFile, JSON.stringify(buildMockFacts(repoName), null, 2), "utf-8");

    const result = await runCli([repoPath, "--no-clone", "--output", outputDir, "--style", "oss"], {
      NODE_ENV: "test",
      REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Bootcamp Generated Successfully");
    expect(result.stderr).not.toContain("Analysis failed");
    expect(result.stderr).not.toContain("Document generation failed");

    const writtenFiles = await readdir(outputDir);
    expect(writtenFiles).toEqual(
      expect.arrayContaining([
        "BOOTCAMP.md",
        "ONBOARDING.md",
        "ARCHITECTURE.md",
        "CODEMAP.md",
        "FIRST_TASKS.md",
        "SECURITY.md",
        "RADAR.md",
        "DEPENDENCIES.md",
        "METRICS.md",
        "HEALTH.md",
        "diagrams.mmd",
        "repo_facts.json",
      ])
    );

    const health = await readFile(join(outputDir, "HEALTH.md"), "utf-8");
    expect(health).toContain("# Repo Health");
    expect(health).toContain("## Onboarding Readiness");

    const facts = JSON.parse(await readFile(join(outputDir, "repo_facts.json"), "utf-8"));
    expect(facts.repoName).toBe(repoName);
    expect(facts.stack.frameworks).toContain("Express");

    const bootcamp = await readFile(join(outputDir, "BOOTCAMP.md"), "utf-8");
    expect(bootcamp).toContain("fixture-cli-repo");
    const dependencies = await readFile(join(outputDir, "DEPENDENCIES.md"), "utf-8");
    expect(dependencies).toContain(String.raw`| express | ^4.0.0 \|\| ^5.0.0 |`);
  }, 90_000);
  it.each([
    [
      "requirements",
      { "requirements.txt": "# Empty requirements\n", "app.py": "pass\n" },
      "pip",
      null,
    ],
    [
      "setuptools",
      {
        "pyproject.toml":
          '[build-system]\nrequires = ["setuptools"]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "fixture"\nversion = "0.1.0"\n',
        "app.py": "pass\n",
      },
      "pip",
      null,
    ],
    [
      "uv",
      {
        "pyproject.toml": '[project]\nname = "fixture"\nversion = "0.1.0"\n',
        "uv.lock": "version = 1\n",
        "app.py": "pass\n",
      },
      "uv",
      null,
    ],
    [
      "poetry",
      {
        "pyproject.toml": '[project]\nname = "fixture"\nversion = "0.1.0"\n',
        "poetry.lock": "# Poetry lockfile\n",
        "app.py": "pass\n",
      },
      "poetry",
      "poetry install --with dev",
    ],
    [
      "rust",
      {
        "Cargo.toml": '[package]\nname = "fixture"\nversion = "0.1.0"\n[lib]\npath = "lib.rs"\n',
        "lib.rs": "pub fn sample() {}\n",
      },
      "cargo",
      null,
    ],
    [
      "documented-python",
      { "requirements.txt": "# Empty requirements\n", "app.py": "pass\n" },
      "pip",
      "python3 -m pip install -r requirements.txt",
    ],
    [
      "documented-uv",
      {
        "pyproject.toml": '[project]\nname = "fixture"\nversion = "0.1.0"\n',
        "uv.lock": "version = 1\n",
        "app.py": "pass\n",
      },
      "uv",
      "uv sync --frozen --group dev",
    ],
  ] as const)(
    "generates evidence-based installation guidance for %s through the real CLI",
    async (_name, files, manager, installCommand) => {
      const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-install-cli-"));
      tempDirs.push(tempDir);
      const repoPath = join(tempDir, "repo");
      await mkdir(repoPath);
      for (const [path, contents] of Object.entries(files)) {
        await writeFile(join(repoPath, path), contents);
      }
      await writeFile(
        join(repoPath, "README.md"),
        `# Setup\n${installCommand || "See CONTRIBUTING.md for setup."}\n`
      );
      const facts = buildMockFacts("local/repo");
      facts.stack = {
        languages: [manager === "cargo" ? "Rust" : "Python"],
        frameworks: [],
        buildSystem: "",
        packageManager: null,
        hasDocker: false,
        hasCi: false,
      };
      facts.quickstart.commands = installCommand
        ? [{ name: "install", command: installCommand, source: "README.md" }]
        : [];
      const responseFile = join(tempDir, "response.json");
      await writeFile(responseFile, JSON.stringify(facts));
      const outputDir = join(tempDir, "generated");
      const result = await runCli(
        [repoPath, "--no-clone", "--no-cache", "--output", outputDir, "--style", "oss"],
        {
          NODE_ENV: "test",
          REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile,
        }
      );
      expect(result.exitCode).toBe(0);
      const generatedFacts = JSON.parse(
        await readFile(join(outputDir, "repo_facts.json"), "utf-8")
      );
      expect(generatedFacts.stack.packageManager).toBe(manager);
      const onboarding = await readFile(join(outputDir, "ONBOARDING.md"), "utf-8");
      if (installCommand) {
        expect(onboarding).toContain(`# Install dependencies\n${installCommand}\n\`\`\``);
      } else {
        expect(onboarding).toContain("Follow the repository's README or contribution guide");
        expect(onboarding).not.toContain("# Install dependencies");
        expect(onboarding).not.toContain(`${manager} install`);
        expect(onboarding).not.toContain("npm install");
      }
    },
    90_000
  );

  it.each([
    [
      "install",
      [{ name: "install", command: "uv sync --frozen --group dev", source: "README.md" }],
      false,
      null,
    ],
    [
      "paths",
      [{ name: "latest", command: "node ./scripts/server-test.js", source: "README.md" }],
      false,
      null,
    ],
    [
      "node-dev",
      [
        { name: "install", command: "npm install --save-dev", source: "README.md" },
        { name: "launch", command: "npm run app:dev", source: "README.md" },
      ],
      true,
      null,
    ],
    [
      "python-tests",
      [
        { name: "install", command: "uv sync --group dev", source: "README.md" },
        { name: "verify", command: "uv run --group dev pytest", source: "README.md" },
      ],
      false,
      "uv run --group dev pytest",
    ],
    [
      "test-watch",
      [{ name: "verify", command: "npm run test:watch", source: "README.md" }],
      false,
      "npm run test:watch",
    ],
    [
      "mixed-test-watch-build",
      [{ name: "unit tests", command: "npm run watch:test-build", source: "README.md" }],
      false,
      "npm run watch:test-build",
    ],
    ["named-server", [{ name: "server", command: "node app.js", source: "README.md" }], true, null],
    [
      "script-server",
      [{ name: "launch", command: "npm run server", source: "README.md" }],
      true,
      null,
    ],
    [
      "uv-filename",
      [{ name: "inspect", command: "uv run dev-tools.py --self-test", source: "README.md" }],
      false,
      null,
    ],
    [
      "poetry-filename",
      [{ name: "inspect", command: "poetry run build-tools.py", source: "README.md" }],
      false,
      null,
    ],
  ] as const)(
    "uses accurate command roles in real CLI guidance for %s",
    async (_name, commands, hasDev, testCommand) => {
      const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-command-cli-"));
      tempDirs.push(tempDir);
      const repoPath = join(tempDir, "repo");
      await mkdir(repoPath);
      await writeFile(
        join(repoPath, "package.json"),
        JSON.stringify({ name: "fixture", version: "1.0.0" })
      );
      await writeFile(join(repoPath, "index.js"), "export const sample = 1;\n");
      await writeFile(
        join(repoPath, "README.md"),
        `# Commands\n${commands.map((c) => c.command).join("\n")}\n`
      );
      const facts = buildMockFacts("local/repo");
      facts.quickstart.commands = commands.map((command) => ({ ...command }));
      const responseFile = join(tempDir, "response.json");
      await writeFile(responseFile, JSON.stringify(facts));
      const outputDir = join(tempDir, "generated");
      const result = await runCli(
        [repoPath, "--no-clone", "--no-cache", "--output", outputDir, "--style", "oss"],
        {
          NODE_ENV: "test",
          REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile,
        }
      );
      expect(result.exitCode).toBe(0);
      const onboarding = await readFile(join(outputDir, "ONBOARDING.md"), "utf-8");
      const bootcamp = await readFile(join(outputDir, "BOOTCAMP.md"), "utf-8");
      expect(onboarding.includes("Start the dev server/watch mode")).toBe(hasDev);
      expect(bootcamp.includes("Run the dev server:")).toBe(hasDev);
      if (_name.endsWith("-filename")) {
        expect(bootcamp).not.toContain(`Build/verify: \`${commands[0].command}\``);
      }
      if (testCommand) {
        expect(onboarding).toContain(`## Running Tests\n\n\`\`\`bash\n${testCommand}\n\`\`\``);
      } else {
        expect(onboarding).toContain("_No test command detected_");
      }
      const install = commands.find((command) => command.name === "install");
      if (install) {
        expect(onboarding).toContain(`# Install dependencies\n${install.command}`);
        expect(bootcamp).not.toContain(`Build/verify: \`${install.command}\``);
      }
    },
    90_000
  );

  it.each(["html", "pdf"] as const)(
    "generates a navigable %s kit through the real CLI",
    async (format) => {
      const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-export-cli-"));
      tempDirs.push(tempDir);
      const repoPath = await createFixtureRepo(tempDir);
      const outputDir = join(tempDir, "output");
      const responseFile = join(tempDir, "mock-response.json");
      await writeFile(responseFile, JSON.stringify(buildMockFacts(`local/${basename(repoPath)}`)));
      const result = await runCli(
        [repoPath, "--no-clone", "--no-cache", "--output", outputDir, "--format", format],
        { NODE_ENV: "test", REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile }
      );
      expect(result.exitCode).toBe(0);
      const files = await readdir(outputDir);
      expect(files).toContain("ONBOARDING.html");
      expect(files).not.toContain("ONBOARDING.md");
      const bootcamp = await readFile(join(outputDir, "BOOTCAMP.html"), "utf-8");
      expect(bootcamp).toContain('href="./ONBOARDING.html"');
      expect(bootcamp).toContain('href="./ARCHITECTURE.html"');
      const tasks = await readFile(join(outputDir, "FIRST_TASKS.html"), "utf-8");
      expect(tasks).toContain('href="./ARCHITECTURE.html"');
      const dependencies = await readFile(join(outputDir, "DEPENDENCIES.html"), "utf-8");
      expect(dependencies).toContain("<td>^4.0.0 || ^5.0.0</td>");
      for (const file of files.filter((name) => name.endsWith(".html"))) {
        const content = await readFile(join(outputDir, file), "utf-8");
        for (const match of content.matchAll(/href="\.\/([^"?#]+\.html)(?:[?#][^"]*)?"/g)) {
          expect(files).toContain(decodeURIComponent(match[1]));
        }
      }
    },
    90_000
  );

  it.each(
    (["markdown", "html", "pdf"] as const).flatMap((format) =>
      [false, true].map((reports) => ({ format, reports }))
    )
  )(
    "links only emitted optional documents in $format output (reports=$reports)",
    async ({ format, reports }) => {
      const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-optional-navigation-"));
      tempDirs.push(tempDir);
      const repoPath = await createFixtureRepo(tempDir);
      if (!reports) {
        await Promise.all(
          ["package.json", "src", "test", ".github"].map((name) =>
            rm(join(repoPath, name), { recursive: true, force: true })
          )
        );
      }
      const responseFile = join(tempDir, "response.json");
      await writeFile(responseFile, JSON.stringify(buildMockFacts(`local/${basename(repoPath)}`)));
      const outputDir = join(tempDir, "output");
      const result = await runCli(
        [
          repoPath,
          "--no-clone",
          "--no-cache",
          "--output",
          outputDir,
          "--format",
          format,
          ...(reports ? ["--style", "corporate"] : []),
        ],
        { NODE_ENV: "test", REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile }
      );
      expect(result.exitCode).toBe(0);
      const extension = format === "markdown" ? "md" : "html";
      const files = await readdir(outputDir);
      const content = await readFile(join(outputDir, `BOOTCAMP.${extension}`), "utf-8");
      const navigation =
        format === "markdown"
          ? content.slice(content.lastIndexOf("## Next Steps"))
          : content.slice(content.lastIndexOf(">Next Steps</h2>"));
      for (const name of ["DEPENDENCIES", "IMPACT"]) {
        expect(files.includes(`${name}.${extension}`)).toBe(reports);
        expect(navigation.includes(`./${name}.${extension}`)).toBe(reports);
        if (reports)
          expect(
            (await readFile(join(outputDir, `${name}.${extension}`), "utf-8")).length
          ).toBeGreaterThan(100);
      }
      expect(navigation).toContain(`./ONBOARDING.${extension}`);
      expect(content).not.toContain("bootcamp-navigation:");
      const links =
        format === "markdown"
          ? [...navigation.matchAll(/\]\(\.\/([^)]*)\)/g)].map((match) => match[1])
          : [...navigation.matchAll(/href="\.\/([^"?#]*)"/g)].map((match) => match[1]);
      for (const target of links) expect(files).toContain(target);
    },
    90_000
  );

  it("omits excluded core and optional navigation while preserving explicit repository links", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-excluded-navigation-"));
    tempDirs.push(tempDir);
    const repoPath = await createFixtureRepo(tempDir);
    await writeFile(
      join(repoPath, ".bootcamprc.json"),
      JSON.stringify({
        output: { excludeDocs: ["ONBOARDING.md", "DEPENDENCIES.md", "IMPACT.md"] },
      })
    );
    const input = buildMockFacts(`local/${basename(repoPath)}`);
    input.description = "Explicit repository instructions: [DEPENDENCIES.md](./DEPENDENCIES.md)";
    const responseFile = join(tempDir, "response.json");
    await writeFile(responseFile, JSON.stringify(input));
    const outputDir = join(tempDir, "output");
    const result = await runCli(
      [repoPath, "--no-clone", "--no-cache", "--output", outputDir, "--style", "corporate"],
      { NODE_ENV: "test", REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile },
      60_000,
      repoPath
    );
    expect(result.exitCode).toBe(0);
    const files = await readdir(outputDir);
    const content = await readFile(join(outputDir, "BOOTCAMP.md"), "utf-8");
    expect(content).toContain(input.description);
    const navigation = content.slice(content.lastIndexOf("## Next Steps"));
    for (const name of ["ONBOARDING.md", "DEPENDENCIES.md", "IMPACT.md"]) {
      expect(files).not.toContain(name);
      expect(navigation).not.toContain(`./${name}`);
    }
    expect(navigation).toContain("./ARCHITECTURE.md");
  }, 90_000);

  it("generates extended analysis from the selected package instead of the outer manifest", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-scoped-cli-"));
    tempDirs.push(tempDir);
    const repoPath = await createFixtureRepo(tempDir);
    const subdir = "packages/my app";
    const selectedRoot = join(repoPath, subdir);
    await mkdir(join(selectedRoot, "src"), { recursive: true });
    await writeFile(
      join(selectedRoot, "package.json"),
      JSON.stringify({ name: "selected-app", dependencies: { "child-runtime": "^1.0.0" } })
    );
    await writeFile(join(selectedRoot, "README.md"), "# Selected package\n");
    await writeFile(join(selectedRoot, "src", "index.ts"), "export const publicValue = true;\n");
    execFileSync("git", ["add", "packages"], { cwd: repoPath });
    execFileSync("git", ["commit", "-m", "add child", "--no-gpg-sign"], {
      cwd: repoPath,
      stdio: "ignore",
    });
    await writeFile(
      join(selectedRoot, "src", "index.ts"),
      "const token = process.env.CHILD_TOKEN;\n"
    );
    execFileSync("git", ["add", "packages"], { cwd: repoPath });
    execFileSync("git", ["commit", "-m", "change child", "--no-gpg-sign"], {
      cwd: repoPath,
      stdio: "ignore",
    });
    const outputDir = join(tempDir, "output");
    const responseFile = join(tempDir, "mock-response.json");
    await writeFile(responseFile, JSON.stringify(buildMockFacts(`local/${basename(repoPath)}`)));
    const result = await runCli(
      [
        repoPath,
        "--no-clone",
        "--subdir",
        subdir,
        "--no-cache",
        "--compare",
        "HEAD~1",
        "--output",
        outputDir,
      ],
      {
        NODE_ENV: "test",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile,
      }
    );
    expect(result.exitCode).toBe(0);
    const onboarding = await readFile(join(outputDir, "ONBOARDING.md"), "utf-8");
    const reportedPath = onboarding.match(/^cd -- '(.+)'$/m)?.[1];
    expect(reportedPath).toBeTruthy();
    expect(await realpath(reportedPath!)).toBe(await realpath(selectedRoot));
    expect(onboarding).not.toContain("git clone");
    expect(onboarding.indexOf(`cd -- '${reportedPath}'`)).toBeLessThan(
      onboarding.indexOf("npm install")
    );
    const dependencies = await readFile(join(outputDir, "DEPENDENCIES.md"), "utf-8");
    expect(dependencies).toContain("child-runtime");
    expect(dependencies).not.toContain("express");
    const diff = await readFile(join(outputDir, "DIFF.md"), "utf-8");
    expect(diff).toContain("CHILD_TOKEN");
    expect(diff).toContain("publicValue");
    const summary = JSON.parse(await readFile(join(outputDir, "summary.json"), "utf-8"));
    expect(summary.deps).toEqual({ total: 1, runtime: 1, dev: 0 });
    expect(
      JSON.parse(await readFile(join(repoPath, "package.json"), "utf-8")).dependencies
    ).toHaveProperty("express");
  }, 90_000);
  it.each([
    { isLocal: false, keepTemp: false },
    { isLocal: false, keepTemp: true },
    { isLocal: true, keepTemp: false },
  ])(
    "settles clone ownership after a real interactive transcript failure ($isLocal/$keepTemp)",
    async ({ isLocal, keepTemp }) => {
      const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-interactive-failure-"));
      tempDirs.push(tempDir);
      const repoPath = await createFixtureRepo(tempDir);
      const outputDir = join(tempDir, "output");
      // Generation succeeds; the interactive transcript cannot replace this directory.
      await mkdir(join(outputDir, "TRANSCRIPT.md"), { recursive: true });
      await writeFile(
        join(outputDir, "TRANSCRIPT.md", "preserve.txt"),
        "Preserve existing output."
      );
      const responseFile = join(tempDir, "response.json");
      await writeFile(responseFile, JSON.stringify(buildMockFacts("fixture-owner/fixture-repo")));
      const spawned = spawnCli(
        [
          isLocal ? repoPath : "https://github.com/fixture-owner/fixture-repo",
          "--output",
          outputDir,
          "--no-cache",
          "--interactive",
          "--transcript",
          ...(isLocal ? ["--no-clone"] : []),
          ...(keepTemp ? ["--keep-temp"] : []),
        ],
        {
          NODE_ENV: "test",
          REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responseFile,
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: `url.${pathToFileURL(repoPath).href}.insteadOf`,
          GIT_CONFIG_VALUE_0: "https://github.com/fixture-owner/fixture-repo.git",
          HOME: join(tempDir, "home"),
        },
        tempDir
      );
      children.push(spawned);
      const closed = once(spawned.child, "close");
      await waitForOutput(spawned.getOutput, "Ready!", 60_000);
      spawned.child.stdin.end("exit\n");
      const [exitCode] = await closed;
      expect(exitCode).toBe(1);
      expect(spawned.getOutput().stderr).toContain("EISDIR");
      expect(await readFile(join(outputDir, "TRANSCRIPT.md", "preserve.txt"), "utf8")).toBe(
        "Preserve existing output."
      );
      expect(
        JSON.parse(await readFile(join(outputDir, "ANALYSIS_MANIFEST.json"), "utf8"))
      ).toHaveProperty("schemaVersion");
      expect(await readFile(join(repoPath, "README.md"), "utf8")).toContain("Fixture CLI Repo");
      if (!isLocal) {
        const clones = await readdir(join(tempDir, ".tmp"));
        expect(clones).toHaveLength(keepTemp ? 1 : 0);
        if (keepTemp) {
          expect(await readFile(join(tempDir, ".tmp", clones[0], "README.md"), "utf8")).toContain(
            "Fixture CLI Repo"
          );
        }
      }
    },
    90_000
  );
});
