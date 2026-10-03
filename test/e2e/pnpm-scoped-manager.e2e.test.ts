import { execFileSync } from "child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it } from "vitest";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup() {
  const temp = await mkdtemp(join(tmpdir(), "pnpm-scope-cli-"));
  dirs.push(temp);
  const repo = join(temp, "repo"),
    app = join(repo, "packages/app");
  await mkdir(join(app, "src"), { recursive: true });
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({
      packageManager: "pnpm@11.14.0",
      dependencies: { outerOnly: "1" },
      scripts: { outer: "NEVER_RUN" },
    })
  );
  await writeFile(join(repo, "pnpm-workspace.yaml"), "packages: ['packages/*']\n");
  await writeFile(
    join(app, "package.json"),
    JSON.stringify({
      name: "app",
      scripts: { build: "node NEVER_RUN.cjs", test: "node NEVER_RUN.cjs" },
      dependencies: { sibling: "workspace:*" },
    })
  );
  await writeFile(join(app, "README.md"), "# Selected app\n");
  await writeFile(join(app, "src/index.ts"), "export const app = true;\n");
  await writeFile(
    join(app, "NEVER_RUN.cjs"),
    'throw new Error("Fixture scripts must not execute");'
  );
  const facts = {
    repoName: "owned/app",
    purpose: "Workspace app",
    description: "Offline",
    stack: {
      languages: ["TypeScript"],
      frameworks: [],
      packageManager: null,
      buildSystem: "npm",
      hasDocker: false,
      hasCi: false,
    },
    quickstart: {
      prerequisites: [],
      steps: ["Read README.md"],
      commands: [],
      commonErrors: [],
      sources: ["README.md"],
    },
    structure: { keyDirs: [], entrypoints: [], testDirs: [], docsDirs: [], sources: [] },
    ci: { workflows: [], mainChecks: [], sources: [] },
    contrib: { howToAddFeature: [], howToAddTest: [], sources: [] },
    architecture: { overview: "Small app", components: [], sources: [] },
    firstTasks: [],
  };
  const response = join(temp, "response.json"),
    preload = join(temp, "owned-home.mjs");
  await writeFile(response, JSON.stringify(facts));
  await writeFile(
    preload,
    `import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>${JSON.stringify(join(temp, "home"))};syncBuiltinESMExports();`
  );
  const env = { ...process.env, NODE_ENV: "test", REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response };
  delete env.NODE_OPTIONS;
  const run = (args: string[]) =>
    execFileSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(join(process.cwd(), "node_modules/tsx/dist/loader.mjs")).href,
        "--import",
        pathToFileURL(preload).href,
        join(process.cwd(), "src/cli.ts"),
        ...args,
      ],
      {
        cwd: temp,
        env,
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  return { temp, repo, app, response, facts, run };
}
describe("actual selected pnpm workspace journeys", () => {
  it("keeps standalone tasks scoped and child overrides/exclusions/root/direct input compatible", async () => {
    const { repo, app, run } = await setup();
    const commands = (args: string[]) =>
      JSON.parse(run(args)).tasks.map((t: { command: string }) => t.command);
    expect(commands(["tasks", repo, "--subdir", "packages/app", "--json"])).toEqual([
      "pnpm run build",
      "pnpm run test",
    ]);
    expect(commands(["tasks", app, "--json"])).toEqual(["npm run build", "npm run test"]);
    expect(commands(["tasks", repo, "--json"])).toEqual(["pnpm run outer"]);
    await writeFile(
      join(repo, "pnpm-workspace.yaml"),
      "packages: ['!packages/app','packages/*']\n"
    );
    expect(commands(["tasks", repo, "--subdir", "packages/app", "--json"])).toEqual([
      "npm run build",
      "npm run test",
    ]);
    await writeFile(join(repo, "pnpm-workspace.yaml"), "packages: ['packages/*']\n");
    await writeFile(join(app, "package-lock.json"), "metadata only");
    expect(commands(["tasks", repo, "--subdir", "packages/app", "--json"])).toEqual([
      "npm run build",
      "npm run test",
    ]);
  });
  it.each(
    [false, true].flatMap((fast) => ["markdown", "html", "pdf"].map((format) => ({ fast, format })))
  )(
    "emits practical selected install/run commands in $format fast=$fast without root dependencies",
    async ({ fast, format }) => {
      const { temp, repo, run } = await setup(),
        out = join(temp, "out");
      run([
        repo,
        "--no-clone",
        "--no-cache",
        "--subdir",
        "packages/app",
        "--style",
        "corporate",
        "--format",
        format,
        "--output",
        out,
        ...(fast ? ["--fast"] : []),
      ]);
      const guide = await readFile(
        join(out, `ONBOARDING.${format === "markdown" ? "md" : "html"}`),
        "utf8"
      );
      expect(guide).toContain("pnpm install");
      expect(guide).toContain("pnpm run build");
      expect(guide).toContain("pnpm run test");
      expect(guide).not.toMatch(/\bnpm install/);
      const facts = JSON.parse(await readFile(join(out, "repo_facts.json"), "utf8"));
      expect(facts.stack.packageManager).toBe("pnpm");
      expect(facts.quickstart.commands.map((c: { command: string }) => c.command)).toEqual([
        "pnpm run build",
        "pnpm run test",
      ]);
      const deps = await readFile(
        join(out, `DEPENDENCIES.${format === "markdown" ? "md" : "html"}`),
        "utf8"
      );
      expect(deps).toContain("sibling");
      expect(deps).not.toContain("outerOnly");
    }
  );
  it("keeps explicit facts commands while still correcting detected default install guidance", async () => {
    const { temp, repo, response, facts, run } = await setup();
    const out = join(temp, "out");
    await writeFile(
      response,
      JSON.stringify({
        ...facts,
        quickstart: {
          ...facts.quickstart,
          commands: [{ name: "manual", command: "keep explicit", source: "README.md" }],
        },
      })
    );
    run([repo, "--no-clone", "--no-cache", "--subdir", "packages/app", "--output", out]);
    const result = JSON.parse(await readFile(join(out, "repo_facts.json"), "utf8"));
    expect(result.quickstart.commands.map((c: { command: string }) => c.command)).toEqual([
      "keep explicit",
    ]);
    expect(await readFile(join(out, "ONBOARDING.md"), "utf8")).toContain("pnpm install");
  });
});
