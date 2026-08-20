/**
 * Task Discovery Module
 *
 * Deterministic, multi-ecosystem discovery of the runnable commands a newcomer
 * needs on Day 1 — "how do I build / test / run this repo?". Unlike the rest of
 * the onboarding kit, this module performs no AI inference: it parses the task
 * definition files that projects already ship (package.json scripts, Makefile,
 * justfile, go-task Taskfile, docker-compose, pyproject, composer.json) and maps
 * each declared task to the exact shell command that invokes it.
 *
 * Every parser is a pure `string -> DiscoveredTask[]` function so it can be unit
 * tested in isolation. `discoverTasks` is the only IO boundary; it reads the
 * candidate files through the symlink-safe {@link readContainedFile} reader and
 * concatenates the results in a stable order (package.json first, to preserve the
 * historical command strings the ingest pipeline emits).
 */

import { readContainedFile } from "./fs-safe.js";
import type { Command } from "./types.js";

/** Coarse grouping used for report sections and getting-started ordering. */
export type TaskCategory =
  "install" | "build" | "test" | "lint" | "dev" | "run" | "release" | "other";

/** JavaScript package managers whose `run` invocation we can emit. */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** A single runnable task discovered from a project's task-definition files. */
export interface DiscoveredTask {
  /** Short task name, e.g. `build`, `test`, `lint`. */
  name: string;
  /** The exact shell command to run, e.g. `npm run build`, `just test`. */
  command: string;
  /** Origin file, e.g. `package.json`, `Makefile`, `justfile`, `Taskfile`. */
  source: string;
  /** Coarse category used for grouping and getting-started ordering. */
  category: TaskCategory;
  /** Optional human description (script body, task `desc:`, preceding comment). */
  description?: string;
}

/** Options for {@link discoverTasks}. */
export interface DiscoverTasksOptions {
  /**
   * Force the package manager used to render package.json script commands
   * instead of detecting it from lockfiles. The ingest pipeline pins this to
   * `"npm"` so the generated onboarding kit keeps emitting byte-identical
   * `npm run <name>` strings across releases.
   */
  packageManager?: PackageManager;
}

/**
 * Display / getting-started order. Chosen to mirror a human's first session:
 * install dependencies, build, test, lint, then a dev or run loop.
 */
export const CATEGORY_ORDER: readonly TaskCategory[] = [
  "install",
  "build",
  "test",
  "lint",
  "dev",
  "run",
  "release",
  "other",
] as const;

/**
 * Ordered category matchers. The first entry whose any keyword is a substring of
 * the (lowercased) task name wins. Order is deliberate: `lint` is checked before
 * `test` so `typecheck` doesn't get bucketed by the `check` keyword, and `dev` is
 * checked before `run` so `serve`/`watch` loops read as development.
 */
const CATEGORY_MATCHERS: ReadonlyArray<readonly [TaskCategory, readonly string[]]> = [
  ["install", ["install", "bootstrap", "setup", "deps", "dependencies", "vendor", "restore"]],
  [
    "lint",
    [
      "lint",
      "format",
      "fmt",
      "prettier",
      "eslint",
      "clippy",
      "typecheck",
      "type-check",
      "tsc",
      "check-types",
      "style",
      "vet",
    ],
  ],
  [
    "test",
    [
      "test",
      "spec",
      "e2e",
      "unit",
      "integration",
      "coverage",
      "pytest",
      "vitest",
      "jest",
      "check",
      "verify",
    ],
  ],
  ["build", ["build", "compile", "bundle", "dist", "package", "codegen", "generate", "assets"]],
  ["dev", ["dev", "watch", "serve", "hot", "storybook", "preview"]],
  ["run", ["start", "run", "up", "launch", "exec", "server"]],
  ["release", ["release", "publish", "deploy", "version", "tag", "changeset", "bump"]],
];

/**
 * Classify a task by name using keyword heuristics. Deterministic and pure — the
 * same name always yields the same category.
 */
export function categorizeTask(name: string): TaskCategory {
  const n = name.toLowerCase();
  for (const [category, keywords] of CATEGORY_MATCHERS) {
    if (keywords.some((kw) => n.includes(kw))) return category;
  }
  return "other";
}

/** Parse the `scripts` map of a package.json into tasks for a given manager. */
export function parsePackageJsonScripts(
  content: string,
  pm: PackageManager = "npm"
): DiscoveredTask[] {
  let pkg: unknown;
  try {
    pkg = JSON.parse(content);
  } catch {
    return [];
  }
  const scripts = (pkg as { scripts?: unknown } | null)?.scripts;
  if (!scripts || typeof scripts !== "object") return [];
  const tasks: DiscoveredTask[] = [];
  for (const [name, body] of Object.entries(scripts as Record<string, unknown>)) {
    tasks.push({
      name,
      command: `${pm} run ${name}`,
      source: "package.json",
      category: categorizeTask(name),
      description: typeof body === "string" ? body : undefined,
    });
  }
  return tasks;
}

/**
 * Parse Makefile targets. Matches `name:` at column 0 while rejecting `name :=`
 * variable assignments (the `(?!=)` guard) and indented recipe bodies.
 */
export function parseMakefile(content: string): DiscoveredTask[] {
  const re = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:(?!=)/gm;
  const tasks: DiscoveredTask[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    tasks.push({
      name,
      command: `make ${name}`,
      source: "Makefile",
      category: categorizeTask(name),
    });
  }
  return tasks;
}

const JUST_RESERVED = new Set(["set", "export", "alias", "import", "mod"]);

/**
 * Parse `just` recipes from a justfile. Recipe definitions start at column 0 and
 * end in a colon; indented lines are recipe bodies. A `# comment` immediately
 * preceding a recipe becomes its description.
 */
export function parseJustfile(content: string): DiscoveredTask[] {
  const lines = content.split(/\r?\n/);
  const tasks: DiscoveredTask[] = [];
  const seen = new Set<string>();
  let pendingComment: string | undefined;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      pendingComment = trimmed.replace(/^#+\s*/, "") || undefined;
      continue;
    }
    if (trimmed === "") {
      pendingComment = undefined;
      continue;
    }
    // Indented lines are recipe bodies, not definitions.
    if (/^\s/.test(line)) {
      pendingComment = undefined;
      continue;
    }
    const m = line.match(/^@?([a-zA-Z_][a-zA-Z0-9_-]*)\s*(?:\s+[^:=]*?)?:(?!=)/);
    if (m && !JUST_RESERVED.has(m[1]) && !seen.has(m[1])) {
      seen.add(m[1]);
      tasks.push({
        name: m[1],
        command: `just ${m[1]}`,
        source: "justfile",
        category: categorizeTask(m[1]),
        description: pendingComment,
      });
    }
    pendingComment = undefined;
  }
  return tasks;
}

/**
 * Return the immediate children of a top-level YAML `blockKey:` mapping, in file
 * order. Only keys at the block's first indentation level are returned; nested
 * properties and comments are skipped. Used for go-task `tasks:` and
 * docker-compose `services:` blocks.
 */
function yamlBlockKeys(
  content: string,
  blockKey: string
): Array<{ key: string; startLine: number }> {
  const lines = content.split(/\r?\n/);
  const blockRe = new RegExp(`^${blockKey}:\\s*$`);
  const out: Array<{ key: string; startLine: number }> = [];
  let inBlock = false;
  let baseIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock) {
      if (blockRe.test(line)) {
        inBlock = true;
        baseIndent = -1;
      }
      continue;
    }
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (baseIndent === -1) {
      if (indent === 0) break; // block ended immediately (no children)
      baseIndent = indent;
    }
    if (indent < baseIndent) break; // dedent → end of block
    if (indent === baseIndent) {
      const km = line.slice(indent).match(/^([A-Za-z0-9_.-]+):/);
      if (km) out.push({ key: km[1], startLine: i });
    }
  }
  return out;
}

/** Parse go-task `Taskfile.yml` tasks, capturing `desc:`/`summary:` when present. */
export function parseTaskfile(content: string): DiscoveredTask[] {
  const lines = content.split(/\r?\n/);
  const keys = yamlBlockKeys(content, "tasks");
  const tasks: DiscoveredTask[] = [];
  for (let k = 0; k < keys.length; k++) {
    const { key, startLine } = keys[k];
    if (key === "default") continue; // the default task runs as bare `task`
    const end = k + 1 < keys.length ? keys[k + 1].startLine : lines.length;
    let description: string | undefined;
    for (let i = startLine + 1; i < end; i++) {
      const dm = lines[i].match(/^\s+(?:desc|summary):\s*["']?(.+?)["']?\s*$/);
      if (dm) {
        description = dm[1];
        break;
      }
    }
    tasks.push({
      name: key,
      command: `task ${key}`,
      source: "Taskfile",
      category: categorizeTask(key),
      description,
    });
  }
  return tasks;
}

/** Parse docker-compose services into `docker compose up <service>` run tasks. */
export function parseDockerCompose(content: string): DiscoveredTask[] {
  return yamlBlockKeys(content, "services").map(({ key }) => ({
    name: key,
    command: `docker compose up ${key}`,
    source: "docker-compose",
    category: "run" as TaskCategory,
  }));
}

/**
 * Parse Python `pyproject.toml` console-script entry points. Poetry scripts
 * (`[tool.poetry.scripts]`) run via `poetry run <name>`; PEP 621 scripts
 * (`[project.scripts]`) install as bare `<name>` executables.
 */
export function parsePyproject(content: string): DiscoveredTask[] {
  const lines = content.split(/\r?\n/);
  const tasks: DiscoveredTask[] = [];
  let section = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#") || line === "") continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    const isPoetry = section === "tool.poetry.scripts";
    const isPep621 = section === "project.scripts";
    if (!isPoetry && !isPep621) continue;
    const kv = line.match(/^["']?([A-Za-z0-9_.-]+)["']?\s*=/);
    if (!kv) continue;
    const name = kv[1];
    tasks.push({
      name,
      command: isPoetry ? `poetry run ${name}` : name,
      source: "pyproject.toml",
      category: categorizeTask(name),
    });
  }
  return tasks;
}

/** Parse Composer `scripts` into `composer run <name>` tasks. */
export function parseComposer(content: string): DiscoveredTask[] {
  let pkg: unknown;
  try {
    pkg = JSON.parse(content);
  } catch {
    return [];
  }
  const scripts = (pkg as { scripts?: unknown } | null)?.scripts;
  if (!scripts || typeof scripts !== "object") return [];
  const tasks: DiscoveredTask[] = [];
  for (const [name, body] of Object.entries(scripts as Record<string, unknown>)) {
    const description =
      typeof body === "string"
        ? body
        : Array.isArray(body)
          ? body.filter((b) => typeof b === "string").join(" && ")
          : undefined;
    tasks.push({
      name,
      command: `composer run ${name}`,
      source: "composer.json",
      category: categorizeTask(name),
      description: description || undefined,
    });
  }
  return tasks;
}

/**
 * Detect the JavaScript package manager for a repo. The package.json
 * `packageManager` field wins; otherwise lockfiles are consulted, falling back
 * to npm.
 */
export async function detectPackageManager(repoPath: string): Promise<PackageManager> {
  try {
    const pkg = JSON.parse(await readContainedFile(repoPath, "package.json")) as {
      packageManager?: unknown;
    };
    const field = typeof pkg.packageManager === "string" ? pkg.packageManager : "";
    if (field.startsWith("pnpm")) return "pnpm";
    if (field.startsWith("yarn")) return "yarn";
    if (field.startsWith("bun")) return "bun";
    if (field.startsWith("npm")) return "npm";
  } catch {
    // No package.json, or unparseable — fall through to lockfile detection.
  }
  const exists = async (rel: string): Promise<boolean> => {
    try {
      await readContainedFile(repoPath, rel);
      return true;
    } catch {
      return false;
    }
  };
  if (await exists("pnpm-lock.yaml")) return "pnpm";
  if (await exists("yarn.lock")) return "yarn";
  if (await exists("bun.lockb")) return "bun";
  return "npm";
}

/** File candidates for each ecosystem, tried in order (first hit wins). */
const MAKEFILE_NAMES = ["Makefile", "makefile", "GNUmakefile"];
const JUSTFILE_NAMES = ["justfile", "Justfile", ".justfile"];
const TASKFILE_NAMES = ["Taskfile.yml", "Taskfile.yaml", "taskfile.yml", "taskfile.yaml"];
const COMPOSE_NAMES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];

/** Drop duplicate tasks that share both a source and a name (stable, keeps first). */
function dedupeTasks(tasks: DiscoveredTask[]): DiscoveredTask[] {
  const seen = new Set<string>();
  const out: DiscoveredTask[] = [];
  for (const task of tasks) {
    const key = `${task.source}\u0000${task.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(task);
  }
  return out;
}

/**
 * Discover every runnable task in a repository by parsing the task-definition
 * files it ships. Reads are symlink-safe and best-effort: an unreadable or
 * malformed file contributes no tasks rather than throwing. Results are ordered
 * package.json → Makefile → justfile → Taskfile → docker-compose → pyproject →
 * composer.json so the ingest pipeline keeps emitting stable command lists.
 */
export async function discoverTasks(
  repoPath: string,
  opts: DiscoverTasksOptions = {}
): Promise<DiscoveredTask[]> {
  const pm = opts.packageManager ?? (await detectPackageManager(repoPath));

  const read = async (rel: string): Promise<string | null> => {
    try {
      return await readContainedFile(repoPath, rel);
    } catch {
      return null;
    }
  };
  const readFirst = async (names: readonly string[]): Promise<string | null> => {
    for (const name of names) {
      const content = await read(name);
      if (content !== null) return content;
    }
    return null;
  };

  const tasks: DiscoveredTask[] = [];

  const pkg = await read("package.json");
  if (pkg) tasks.push(...parsePackageJsonScripts(pkg, pm));

  const makefile = await readFirst(MAKEFILE_NAMES);
  if (makefile) tasks.push(...parseMakefile(makefile));

  const just = await readFirst(JUSTFILE_NAMES);
  if (just) tasks.push(...parseJustfile(just));

  const taskfile = await readFirst(TASKFILE_NAMES);
  if (taskfile) tasks.push(...parseTaskfile(taskfile));

  const compose = await readFirst(COMPOSE_NAMES);
  if (compose) tasks.push(...parseDockerCompose(compose));

  const pyproject = await read("pyproject.toml");
  if (pyproject) tasks.push(...parsePyproject(pyproject));

  const composer = await read("composer.json");
  if (composer) tasks.push(...parseComposer(composer));

  return dedupeTasks(tasks);
}

/**
 * Map discovered tasks onto the legacy {@link Command} shape stored on
 * `ScanResult.commands`. The `description` key is omitted when absent so objects
 * stay structurally identical to the pre-refactor extractor output.
 */
export function toCommands(tasks: DiscoveredTask[]): Command[] {
  return tasks.map((task) => {
    const command: Command = { name: task.name, command: task.command, source: task.source };
    if (task.description !== undefined) command.description = task.description;
    return command;
  });
}

/**
 * Suggest a first-session command sequence: install, then build, then test, then
 * a dev or run loop — using the first discovered task in each category. Returns
 * only the steps that actually exist for the repo.
 */
export function suggestGettingStarted(tasks: DiscoveredTask[]): DiscoveredTask[] {
  const pick = (category: TaskCategory): DiscoveredTask | undefined =>
    tasks.find((t) => t.category === category);
  const sequence: DiscoveredTask[] = [];
  const install = pick("install");
  if (install) sequence.push(install);
  const build = pick("build");
  if (build) sequence.push(build);
  const test = pick("test");
  if (test) sequence.push(test);
  const devOrRun = pick("dev") ?? pick("run");
  if (devOrRun) sequence.push(devOrRun);
  return sequence;
}
