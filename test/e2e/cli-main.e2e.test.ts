import { execFileSync } from "child_process";
import { once } from "events";
import { pathToFileURL } from "url";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "fs/promises";
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
