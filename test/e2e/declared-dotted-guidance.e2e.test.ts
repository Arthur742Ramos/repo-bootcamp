import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { dottedGuidanceFacts } from "../helpers/dotted-guidance-facts.js";

const ownedDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    ownedDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-dotted-e2e-"));
  ownedDirectories.push(base);
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "index.ts"), "export const metadataOnly = true;\n");
  await writeFile(join(repo, "README.md"), "# Owned library fixture\nRecipes are not executed.\n");
  const response = join(base, "response.json");
  await writeFile(response, JSON.stringify(dottedGuidanceFacts()));
  const wrapper = join(base, "owned-cli.mjs");
  await writeFile(
    wrapper,
    "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';import {pathToFileURL} from 'node:url';os.homedir=()=>process.env.OWNED_DOTTED_HOME;syncBuiltinESMExports();process.argv[1]=process.env.OWNED_DOTTED_ENTRY;await import(pathToFileURL(process.env.OWNED_DOTTED_ENTRY));"
  );
  for (const dir of ["home", "tmp", "node-cache", "npm-cache"]) await mkdir(join(base, dir));
  return { base, repo, response, wrapper };
}

async function generate(owned: Awaited<ReturnType<typeof fixture>>, format: "markdown" | "html") {
  const output = join(owned.base, format);
  const originalHome = process.env.HOME;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(join(process.cwd(), "node_modules", "tsx", "dist", "loader.mjs")).href,
      owned.wrapper,
      owned.repo,
      "--no-clone",
      "--no-cache",
      "--style",
      "corporate",
      "--format",
      format,
      "--output",
      output,
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        NODE_ENV: "test",
        OWNED_DOTTED_HOME: join(owned.base, "home"),
        OWNED_DOTTED_ENTRY: join(process.cwd(), "src", "cli.ts"),
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: owned.response,
        TMPDIR: join(owned.base, "tmp"),
        NODE_COMPILE_CACHE: join(owned.base, "node-cache"),
        npm_config_cache: join(owned.base, "npm-cache"),
        TSX_DISABLE_CACHE: "1",
        FORCE_COLOR: "0",
      },
    }
  );
  expect(result.status, result.stderr + result.stdout).toBe(0);
  expect(process.env.HOME).toBe(originalHome);
  const extension = format === "markdown" ? ".md" : ".html";
  return {
    bootcamp: await readFile(join(output, "BOOTCAMP" + extension), "utf8"),
    onboarding: await readFile(join(output, "ONBOARDING" + extension), "utf8"),
    runbook: await readFile(join(output, "RUNBOOK" + extension), "utf8"),
    facts: JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8")),
  };
}

async function declare(
  owned: Awaited<ReturnType<typeof fixture>>,
  runner: "npm" | "task",
  names: string[]
) {
  if (runner === "npm") {
    await writeFile(
      join(owned.repo, "package.json"),
      JSON.stringify({
        name: "owned-dot-fixture",
        scripts: Object.fromEntries(
          names.map((name) => [
            name,
            "node -e \"require('fs').writeFileSync('recipe-was-executed.txt','bad')\"",
          ])
        ),
      })
    );
  } else {
    await writeFile(
      join(owned.repo, "Taskfile.yml"),
      "version: '3'\ntasks:\n" +
        names.map((name) => `  '${name}': {cmds: ['touch recipe-was-executed.txt']}\n`).join("")
    );
  }
}

describe("actual declared dotted command guidance", () => {
  it.each([
    ["npm", ""],
    ["npm", "app:"],
    ["task", ""],
    ["task", "app:"],
  ] as const)(
    "uses declared %s %s dotted build/test tasks in Markdown and HTML",
    async (runner, namespace) => {
      const owned = await fixture();
      const build = namespace + "build.prod",
        test = namespace + "test.unit";
      await declare(owned, runner, [build, test]);
      const prefix = runner === "npm" ? "npm run" : "task";
      for (const format of ["markdown", "html"] as const) {
        const docs = await generate(owned, format);
        expect(docs.bootcamp).toContain(`${prefix} ${build}`);
        expect(docs.onboarding).toContain(`${prefix} ${test}`);
        expect(docs.onboarding).not.toContain(
          format === "markdown" ? "*No test command detected*" : "<em>No test command detected</em>"
        );
        expect(docs.facts.quickstart.commands).toContainEqual(
          expect.objectContaining({
            name: build,
            command: `${prefix} ${build}`,
            source: runner === "npm" ? "package.json" : "Taskfile",
          })
        );
      }
      await expect(readFile(join(owned.repo, "recipe-was-executed.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  );

  it.each(["npm", "task"] as const)(
    "keeps declared %s setup/filename/unknown targets conservative",
    async (runner) => {
      const owned = await fixture();
      await declare(owned, runner, [
        "setup.test",
        "install.build",
        "build.js",
        "test.py",
        "build.preview",
        "test.fast",
        "contest",
      ]);
      for (const format of ["markdown", "html"] as const) {
        const docs = await generate(owned, format);
        expect(docs.bootcamp).not.toContain("Build/verify:");
        expect(docs.onboarding).toContain(
          format === "markdown" ? "*No test command detected*" : "<em>No test command detected</em>"
        );
        expect(docs.onboarding).not.toContain("Start the dev server/watch mode");
        expect(docs.onboarding).toContain("build.js");
      }
    }
  );

  it.each(["npm", "task"] as const)(
    "vetoes supplied semantic labels for actual %s setup targets",
    async (runner) => {
      const owned = await fixture();
      await declare(owned, runner, ["setup.test", "install.build"]);
      const response = dottedGuidanceFacts();
      const prefix = runner === "npm" ? "npm run" : "task",
        source = runner === "npm" ? "package.json" : "Taskfile";
      response.quickstart.commands = [
        { name: "dev", command: `${prefix} setup.test`, source },
        { name: "test", command: `${prefix} install.build`, source },
      ];
      await writeFile(owned.response, JSON.stringify(response));
      const docs = await generate(owned, "markdown");
      expect(docs.bootcamp).not.toContain("Build/verify:");
      expect(docs.onboarding).toContain("*No test command detected*");
      expect(docs.onboarding).not.toContain("Start the dev server/watch mode");
    }
  );

  it.each(["npm", "task"] as const)(
    "does not infer extra-argument dotted %s commands",
    async (runner) => {
      const owned = await fixture();
      await declare(owned, runner, ["build.prod", "test.unit"]);
      const response = dottedGuidanceFacts();
      const prefix = runner === "npm" ? "npm run" : "task",
        source = runner === "npm" ? "package.json" : "Taskfile";
      response.quickstart.commands = [
        {
          name: "build.prod",
          command: `${prefix} build.prod ${runner === "npm" ? "-- --target=prod" : "setup"}`,
          source,
        },
        {
          name: "test.unit",
          command: `${prefix} test.unit ${runner === "npm" ? "--if-present" : "build.prod"}`,
          source,
        },
      ];
      await writeFile(owned.response, JSON.stringify(response));
      const docs = await generate(owned, "markdown");
      expect(docs.bootcamp).not.toContain("Build/verify:");
      expect(docs.onboarding).toContain("*No test command detected*");
      expect(docs.facts.quickstart.commands).toEqual(response.quickstart.commands);
    }
  );

  it("retains Make dotted goal ambiguity without promoting file or phony names", async () => {
    const owned = await fixture();
    await writeFile(
      join(owned.repo, "Makefile"),
      ".PHONY: build.prod test.unit\nbuild.prod:\n\t@touch recipe-was-executed.txt\ntest.unit:\n\t@touch recipe-was-executed.txt\n"
    );
    const docs = await generate(owned, "markdown");
    expect(docs.bootcamp).not.toContain("Build/verify:");
    expect(docs.onboarding).toContain("*No test command detected*");
    expect(docs.onboarding).toContain("make build.prod");
    await expect(readFile(join(owned.repo, "recipe-was-executed.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
