import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runbookFacts } from "./runbook-facts.js";

const root = process.cwd();
export const remote = "https://github.com/owned/source-path-resilience";
export const ref = "release/v2(candidate)";
const prefix = "packages/source app";
export const directory = "src/core`[lib](v2)";
export const validFiles = [
  "read`me.ts",
  "ticks```tail.ts",
  "[bracket](name).ts",
  "café-🚀.ts",
  "space name.ts",
  ...(process.platform === "win32" ? [] : ["pipe|name.ts"]),
].map((name, index) => (index === 0 ? "src" : directory) + "/" + name);
export const rejectedPaths = [
  "src/\ud800.ts",
  "src/\udc00.ts",
  "../outside.ts",
  "src/../../outside.ts",
];
export const testDirectory = "tests/`checks`[v2](owned)";
export const docsDirectory = "docs/`guide`[v2](owned)";
export const workflow = ".github/workflows/check`[v2](owned).yml";
export const command = "npm run build -- --label 'read`me [x](y) | café 🚀'";
export const example =
  "export const label = 'read`me [x](y) | café 🚀';\nexport const unchanged = true;";
// Expected URLs are explicit UTF-8 oracles, independent of the production helper.
export const encodedFiles = [
  "read%60me.ts",
  "ticks%60%60%60tail.ts",
  "%5Bbracket%5D%28name%29.ts",
  "caf%C3%A9-%F0%9F%9A%80.ts",
  "space%20name.ts",
  ...(process.platform === "win32" ? [] : ["pipe%7Cname.ts"]),
];
export const sourceUrls = encodedFiles.map(
  (file, index) =>
    `${remote}/blob/release/v2%28candidate%29/packages/source%20app/${index === 0 ? "src" : "src/core%60%5Blib%5D%28v2%29"}/${file}`
);
export function literalPath(value: string, table = false): string {
  // Fixture expectations: one code fence beyond the longest maximal run;
  // malformed UTF-16 is displayed in reversible JSON notation.
  const raw = rejectedPaths.slice(0, 2).includes(value) ? JSON.stringify(value) : value;
  const content = table ? raw.replace(/\|/g, "\\|") : raw;
  const fence = "`".repeat(
    Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length)) + 1
  );
  return fence + content + fence;
}
export async function fixture(includeMalformed = true) {
  const modelPaths = includeMalformed ? [...validFiles, ...rejectedPaths] : validFiles;
  const base = await mkdtemp(join(tmpdir(), "bootcamp-source-path-resilience-"));
  const repo = join(base, "repo");
  const selected = join(repo, prefix);
  await mkdir(join(selected, directory), { recursive: true });
  await mkdir(join(selected, testDirectory), { recursive: true });
  await mkdir(join(selected, docsDirectory), { recursive: true });
  await mkdir(join(selected, ".github", "workflows"), { recursive: true });
  // Existing files outside the selected package must never become source links
  // through a model-provided traversal. Both one- and two-level escapes exist.
  await writeFile(join(repo, "packages", "outside.ts"), "export const outsideOwned = true;\n");
  await writeFile(join(repo, "outside.ts"), "export const outsideRootOwned = true;\n");
  await writeFile(join(selected, "package.json"), '{"name":"owned-source-path-package"}\n');
  await writeFile(
    join(selected, "README.md"),
    "# Owned source-path fixture\nCommands are documentation only.\n"
  );
  for (const file of validFiles)
    await writeFile(join(selected, file), "export const metadataOnly = true;\n");
  await writeFile(
    join(selected, testDirectory, "index.test.ts"),
    "export const metadataOnly = true;\n"
  );
  await writeFile(join(selected, docsDirectory, "index.md"), "# Owned docs\n");
  await writeFile(join(selected, workflow), "name: Owned checks\non: push\njobs: {}\n");
  const gitEnv = {
    PATH: process.env.PATH,
    HOME: base,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, env: gitEnv, stdio: "ignore" });
  git("init", "-b", "main");
  git("config", "user.name", "Owned Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("commit", "--no-gpg-sign", "-m", "Owned literal filenames");
  git("checkout", "-b", ref);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    env: gitEnv,
    encoding: "utf8",
  }).trim();
  const facts = runbookFacts();
  facts.repoName = "owned/source-path-resilience";
  facts.purpose = "Unrelated purpose survives malformed model paths";
  facts.sources = modelPaths;
  facts.structure.keyDirs = [
    {
      path: directory,
      purpose: "Owned literal source directory",
      keyFiles: modelPaths,
    },
  ];
  facts.structure.entrypoints = modelPaths.map((path, index) => ({
    path,
    type: "library",
    description: `Owned entrypoint ${index}`,
  }));
  facts.structure.testDirs = [testDirectory];
  facts.structure.docsDirs = [docsDirectory];
  facts.structure.sources = modelPaths;
  facts.quickstart.commands = [
    { name: "build", command, source: "README.md", description: "Documentation only; never run" },
  ];
  facts.architecture.overview = "Unrelated architecture survives malformed model paths";
  facts.architecture.components = [
    { name: "Owned literal component", directory, description: "Unchanged component description" },
  ];
  facts.architecture.codeExamples = [
    {
      title: "Unchanged code",
      file: validFiles[0],
      code: example,
      explanation: "Literal code remains untouched",
    },
  ];
  facts.architecture.sources = modelPaths;
  facts.ci.workflows = [
    { name: "Owned checks", file: workflow, triggers: ["push"], mainSteps: [] },
  ];
  facts.firstTasks = [
    {
      title: "Inspect owned paths",
      description: "A metadata-only starter task",
      difficulty: "beginner",
      category: "refactor",
      files: modelPaths,
      why: "Keep literal filenames visible",
    },
  ];
  const response = join(base, "response.json");
  await writeFile(response, JSON.stringify(facts));
  const preload = join(base, "owned-home.mjs");
  await writeFile(
    preload,
    "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>process.env.OWNED_PATH_HOME;syncBuiltinESMExports();"
  );
  return { base, repo, selected, sha, response, preload, facts };
}
export async function generate(
  owned: Awaited<ReturnType<typeof fixture>>,
  format: "markdown" | "html" | "pdf",
  explicitRef?: string,
  local = false,
  sourceRoot = root
) {
  const processBase = await mkdtemp(join(owned.base, "process-"));
  for (const dir of ["home", "cache", "tmp"]) await mkdir(join(processBase, dir));
  const output = join(processBase, "output");
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(join(sourceRoot, "node_modules", "tsx", "dist", "loader.mjs")).href,
      "--import",
      pathToFileURL(owned.preload).href,
      join(sourceRoot, "src", "cli.ts"),
      local ? owned.selected : remote,
      ...(local ? ["--no-clone"] : ["--subdir", prefix]),
      "--no-cache",
      "--quiet",
      "--style",
      "corporate",
      "--format",
      format,
      "--output",
      output,
      ...(explicitRef === undefined ? [] : ["--branch", explicitRef]),
    ],
    {
      cwd: processBase,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: owned.response,
        OWNED_PATH_HOME: join(processBase, "home"),
        HOME: join(processBase, "home"),
        USERPROFILE: join(processBase, "home"),
        XDG_CACHE_HOME: join(processBase, "cache"),
        TMPDIR: join(processBase, "tmp"),
        TMP: join(processBase, "tmp"),
        TEMP: join(processBase, "tmp"),
        TSX_DISABLE_CACHE: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.${pathToFileURL(owned.repo).href}.insteadOf`,
        GIT_CONFIG_VALUE_0: remote + ".git",
      },
    }
  );
  return { result, output };
}
