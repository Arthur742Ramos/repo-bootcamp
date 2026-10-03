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

import { hasContainedFile, readContainedFile } from "./fs-safe.js";
import yaml, { FAILSAFE_SCHEMA, load, Type } from "js-yaml";
import type { Command } from "./types.js";
import { lstat, realpath, stat } from "fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { isPathInsideDir } from "./utils.js";

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
   * instead of detecting it from the manifest or lockfiles. The ingest pipeline
   * passes its resolved manager so stack metadata and task commands agree.
   */
  packageManager?: PackageManager;
  /** Selected, scanned file paths (POSIX relative paths); restricts included Taskfiles. */
  taskfileFiles?: ReadonlySet<string>;
  /** Successful contained Taskfile reads, for effective scan fingerprints. */
  onTaskfileRead?: (path: string, content: string) => void;
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

/** Locate a literal Make delimiter, respecting backslash quoting. */
function makeDelimiter(line: string, delimiter: string): number {
  let escaped = false;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === "\\") {
      escaped = !escaped;
      continue;
    }
    if (line[index] === delimiter && !escaped) return index;
    escaped = false;
  }
  return -1;
}

function makeWithoutComment(line: string): string {
  const comment = makeDelimiter(line, "#");
  return comment < 0 ? line : line.slice(0, comment);
}

function makeContinues(line: string): boolean {
  let backslashes = 0;
  for (let index = line.length - 1; index >= 0 && line[index] === "\\"; index--) backslashes++;
  return backslashes % 2 === 1;
}

/**
 * Discover literal public Make targets without evaluating Makefile expressions.
 * Rule names retain file order; assignments and multiline variable bodies do
 * not declare rules. Special targets, patterns, and indented recipes are omitted.
 */
export function parseMakefile(content: string): DiscoveredTask[] {
  const tasks: DiscoveredTask[] = [];
  const lines = content.split(/\r?\n/);
  let defineDepth = 0;
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    const isRecipe = line.startsWith("\t");
    const fragments: string[] = [];
    // Consume continuations before classifying a line, including recipe and
    // comment payloads. Only literal rule syntax is inspected, never executed.
    while (index + 1 < lines.length && makeContinues(line)) {
      const fragment = line.slice(0, -1).trimEnd();
      if (!fragments.length || fragment) fragments.push(fragment);
      line = lines[++index].trimStart();
    }
    if (fragments.length) {
      fragments.push(line);
      line = fragments.join(" ");
    }
    // Tabs identify recipes, including literal define/endef strings in a recipe.
    if (isRecipe) continue;
    if (defineDepth) {
      const directive = makeWithoutComment(line);
      if (/^\s*(?:(?:override|export)\s+)*define(?:\s|$)/.test(directive)) defineDepth++;
      else if (/^\s*endef\s*$/.test(directive)) defineDepth--;
      continue;
    }
    line = makeWithoutComment(line);
    if (/^\s*(?:(?:override|export)\s+)*define(?:\s|$)/.test(line)) {
      defineDepth++;
      continue;
    }
    const rule = line.match(
      /^([a-zA-Z_][a-zA-Z0-9_.-]*(?:[ \t]+[a-zA-Z_][a-zA-Z0-9_.-]*)*)[ \t]*::?(.*)$/
    );
    if (!rule) continue;
    const recipe = makeDelimiter(rule[2], ";");
    const remainder = (recipe < 0 ? rule[2] : rule[2].slice(0, recipe)).trimStart();
    // :=/::=/:::= global assignments and target-specific assignments are data,
    // even when their left side happens to resemble a public task name.
    if (/^[:?!+]*=/.test(remainder)) continue;
    if (/^(?:(?:override|export|unexport|private)\s+)*[^\s:=?!+]+\s*(?::+|[?!+])?=/.test(remainder))
      continue;
    for (const name of rule[1].split(/[ \t]+/)) {
      tasks.push({
        name,
        command: `make ${name}`,
        source: "Makefile",
        category: categorizeTask(name),
      });
    }
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

// Keep scalar names/descriptions as strings while supporting standard YAML
// merge keys. Broader YAML tags (including executable/custom types) are rejected.
const TASK_YAML_SCHEMA = FAILSAFE_SCHEMA.extend({
  implicit: [
    new Type("tag:yaml.org,2002:merge", {
      kind: "scalar",
      resolve: (value) => value === "<<" || value === null,
    }),
  ],
});
// js-yaml exposes its built-in types, but @types/js-yaml omits that public export.
const yamlTypes = (yaml as typeof yaml & { types: Record<string, Type> }).types;
// A standard set contains null values. The string-preserving schema leaves
// spelled nulls as strings, so accept those spellings within this tag only.
const composeSetType = new Type("tag:yaml.org,2002:set", {
  kind: "mapping",
  resolve: (value) =>
    value === null ||
    (isMapping(value) &&
      Object.values(value).every(
        (entry) => entry === null || (typeof entry === "string" && /^(?:~|null)?$/i.test(entry))
      )),
  construct: (value) => value ?? {},
});
// Standard explicit data tags are valid Compose YAML. Keep implicit names as
// strings and leave Taskfile's schema unchanged; custom tags remain rejected.
const COMPOSE_YAML_SCHEMA = TASK_YAML_SCHEMA.extend({
  explicit: [...Object.values(yamlTypes), composeSetType],
});
function isMapping(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const TASK_INTERNAL_TRUE = new Set([
  "y",
  "Y",
  "yes",
  "Yes",
  "YES",
  "true",
  "True",
  "TRUE",
  "on",
  "On",
  "ON",
]);

/** Parse public go-task tasks without evaluating templates or executing commands. */
function loadTaskfile(content: string): Record<string, unknown> | null {
  let document: unknown;
  try {
    document = load(content, { schema: TASK_YAML_SCHEMA });
  } catch {
    return null;
  }
  return isMapping(document) ? document : null;
}

function taskIsInternal(definition: unknown): boolean {
  return (
    isMapping(definition) &&
    (definition.internal === true ||
      (typeof definition.internal === "string" && TASK_INTERNAL_TRUE.has(definition.internal)))
  );
}

function* taskfileTasks(
  document: Record<string, unknown>,
  namespace = "",
  includeInternal = false
): Generator<DiscoveredTask> {
  if (!isMapping(document.tasks)) return;
  for (const [name, definition] of Object.entries(document.tasks)) {
    // Emit shell-safe names verbatim, including Task's colon-separated names.
    // Keep the existing default-task behavior (it runs as bare `task`).
    if ((!namespace && name === "default") || !/^[A-Za-z0-9_.][A-Za-z0-9_.:-]*$/.test(name))
      continue;
    if (!includeInternal && taskIsInternal(definition)) continue;
    if (
      definition !== null &&
      typeof definition !== "string" &&
      !Array.isArray(definition) &&
      !isMapping(definition)
    )
      continue;
    const description = isMapping(definition)
      ? typeof definition.desc === "string"
        ? definition.desc
        : typeof definition.summary === "string"
          ? definition.summary
          : undefined
      : undefined;
    const qualifiedName = namespace ? `${namespace}:${name}` : name;
    yield {
      name: qualifiedName,
      command: `task ${qualifiedName}`,
      source: "Taskfile",
      category: categorizeTask(name),
      description,
    };
  }
}

export function parseTaskfile(content: string): DiscoveredTask[] {
  const document = loadTaskfile(content);
  return document ? [...taskfileTasks(document)] : [];
}

// Discovery is best-effort metadata reading, not a Task interpreter. Bound both
// physical input and namespace expansion; the public pure parser stays unchanged.
const TASKFILE_LIMITS = {
  files: 64,
  contexts: 128,
  depth: 16,
  fileBytes: 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
  tasks: 2000,
  outputBytes: 1024 * 1024,
};
const TASK_FALSE = new Set([
  "n",
  "N",
  "no",
  "No",
  "NO",
  "false",
  "False",
  "FALSE",
  "off",
  "Off",
  "OFF",
]);
function taskBoolean(value: unknown): boolean | null {
  if (
    value === undefined ||
    value === false ||
    (typeof value === "string" && TASK_FALSE.has(value))
  )
    return false;
  if (value === true || (typeof value === "string" && TASK_INTERNAL_TRUE.has(value))) return true;
  return null;
}

interface TaskfileEntry {
  path: string;
  physical: string;
  bytes: number;
}

async function discoverTaskfiles(
  repoPath: string,
  allowedFiles?: ReadonlySet<string>,
  onRead?: (path: string, content: string) => void
): Promise<DiscoveredTask[]> {
  let root: string;
  try {
    root = await realpath(repoPath);
  } catch {
    return [];
  }
  const documents = new Map<string, Record<string, unknown> | null>();
  let contexts = 0;
  let totalBytes = 0;
  let outputBytes = 0;
  let nameBytes = 0;
  const tasks: DiscoveredTask[] = [];
  const names = new Set<string>();

  const entry = async (path: string): Promise<TaskfileEntry | null> => {
    const target = resolve(repoPath, path);
    if (!isPathInsideDir(resolve(repoPath), target)) return null;
    try {
      const physical = await realpath(target);
      if (!isPathInsideDir(root, physical)) return null;
      const info = await stat(physical);
      return info.isFile() ? { path, physical, bytes: info.size } : null;
    } catch {
      return null;
    }
  };

  const selected = (file: TaskfileEntry): TaskfileEntry | "skipped" =>
    !allowedFiles || allowedFiles.has(file.path.split(sep).join("/")) ? file : "skipped";
  const exists = async (path: string): Promise<boolean> => {
    try {
      await lstat(resolve(repoPath, path));
      return true;
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code || "")) return false;
      throw error;
    }
  };
  const select = async (path: string): Promise<TaskfileEntry | "skipped" | null> => {
    const direct = await entry(path);
    if (direct) return selected(direct);
    // A symlink outside the scan root is skipped, including directory aliases.
    // Never substitute a different default file for an inaccessible primary.
    if (await exists(path)) {
      const physical = await realpath(resolve(repoPath, path));
      if (!isPathInsideDir(root, physical)) return "skipped";
    }
    // File candidates are also safe to try beneath a literal directory. No
    // ancestor search: the selected repository scope remains the only root.
    for (const filename of TASKFILE_NAMES) {
      const found = await entry(join(path, filename));
      // An excluded primary file cannot make a lower-precedence Taskfile win.
      if (found) return selected(found);
      if (await exists(join(path, filename))) {
        const physical = await realpath(resolve(repoPath, path, filename));
        if (!isPathInsideDir(root, physical)) return "skipped";
        throw new Error("Invalid Taskfile entry");
      }
    }
    return null;
  };

  const visit = async (
    file: TaskfileEntry,
    namespace: string,
    ancestry: ReadonlySet<string>,
    depth: number,
    visible = true
  ): Promise<void> => {
    if (
      ++contexts > TASKFILE_LIMITS.contexts ||
      depth > TASKFILE_LIMITS.depth ||
      ancestry.has(file.physical)
    )
      throw new Error("Taskfile traversal limit or cycle");
    let document = documents.get(file.physical);
    if (!documents.has(file.physical)) {
      if (
        documents.size >= TASKFILE_LIMITS.files ||
        file.bytes > TASKFILE_LIMITS.fileBytes ||
        totalBytes + file.bytes > TASKFILE_LIMITS.totalBytes
      )
        throw new Error("Taskfile input limit");
      const content = await readContainedFile(repoPath, file.path);
      const bytes = Buffer.byteLength(content);
      if (bytes > TASKFILE_LIMITS.fileBytes || totalBytes + bytes > TASKFILE_LIMITS.totalBytes)
        throw new Error("Taskfile input limit");
      totalBytes += bytes;
      onRead?.(file.path.split(sep).join("/"), content);
      document = loadTaskfile(content);
      documents.set(file.physical, document);
    }
    if (!document) throw new Error("Invalid Taskfile");
    for (const task of taskfileTasks(document, namespace, true)) {
      if (names.has(task.name)) throw new Error("Duplicate Taskfile task");
      if (names.size >= TASKFILE_LIMITS.tasks) throw new Error("Taskfile task limit");
      nameBytes += Buffer.byteLength(task.name);
      if (nameBytes > TASKFILE_LIMITS.outputBytes) throw new Error("Taskfile name limit");
      names.add(task.name);
      const localName = namespace ? task.name.slice(namespace.length + 1) : task.name;
      if (!visible || taskIsInternal((document.tasks as Record<string, unknown>)[localName]))
        continue;
      outputBytes += Buffer.byteLength(JSON.stringify(task));
      if (tasks.length >= TASKFILE_LIMITS.tasks || outputBytes > TASKFILE_LIMITS.outputBytes)
        throw new Error("Taskfile output limit");
      tasks.push(task);
    }
    if (!isMapping(document.includes)) return;
    const ancestors = new Set([...ancestry, file.physical]);
    for (const [name, definition] of Object.entries(document.includes)) {
      if (++contexts > TASKFILE_LIMITS.contexts) throw new Error("Taskfile traversal limit");
      if (!/^[A-Za-z0-9_.][A-Za-z0-9_.:-]*$/.test(name)) continue;
      const include = typeof definition === "string" ? { taskfile: definition } : definition;
      if (!isMapping(include) || typeof include.taskfile !== "string") continue;
      const internal = taskBoolean(include.internal);
      const optional = taskBoolean(include.optional);
      // Alias alternatives are not emitted; they do not change canonical names.
      // Flatten/excludes/variables and unknown include options need Task evaluation.
      if (
        internal === null ||
        optional === null ||
        Object.keys(include).some(
          (key) => !["taskfile", "dir", "internal", "optional", "aliases"].includes(key)
        )
      )
        continue;
      if (
        include.aliases !== undefined &&
        (!Array.isArray(include.aliases) ||
          include.aliases.some((alias) => typeof alias !== "string"))
      )
        continue;
      const literal = (value: unknown): value is string =>
        typeof value === "string" &&
        !/[{}$~\0\r\n]/.test(value) &&
        (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || isAbsolute(value));
      if (!literal(include.taskfile) || (include.dir !== undefined && !literal(include.dir)))
        continue;
      const target = resolve(repoPath, dirname(file.path), include.taskfile);
      if (!isPathInsideDir(resolve(repoPath), target)) continue;
      const relativeTarget = relative(resolve(repoPath), target);
      const child = await select(relativeTarget);
      if (child === "skipped") continue;
      if (!child && optional) continue;
      if (!child) throw new Error("Missing required Taskfile");
      await visit(
        child,
        namespace ? `${namespace}:${name}` : name,
        ancestors,
        depth + 1,
        visible && !internal
      );
    }
  };

  try {
    for (const filename of TASKFILE_NAMES) {
      const file = await entry(filename);
      if (!file) continue;
      await visit(file, "", new Set(), 0);
      return tasks;
    }
  } catch {
    // Cyclic, malformed, or over-budget local graphs contribute no commands.
    return [];
  }
  return [];
}

/** Parse docker-compose services into `docker compose up <service>` run tasks. */
export function parseDockerCompose(content: string): DiscoveredTask[] {
  let document: unknown;
  try {
    document = load(content, { schema: COMPOSE_YAML_SCHEMA });
  } catch {
    return [];
  }
  if (!isMapping(document) || !isMapping(document.services)) return [];
  const tasks: DiscoveredTask[] = [];
  for (const [name, definition] of Object.entries(document.services)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || !isMapping(definition)) continue;
    tasks.push({
      name,
      // Compose allows leading hyphens in service names; stop option parsing.
      command: `docker compose up ${name.startsWith("-") ? "-- " : ""}${name}`,
      source: "docker-compose",
      category: "run",
    });
  }
  return tasks;
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
    const header = line.match(/^\[([^\]]+)\]\s*(?:#.*)?$/);
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
    const manager = field.match(/^(npm|pnpm|yarn|bun)(?:@|$)/)?.[1];
    if (manager) return manager as PackageManager;
  } catch {
    // No package.json, or unparseable — fall through to lockfile detection.
  }
  if (await hasContainedFile(repoPath, "pnpm-lock.yaml")) return "pnpm";
  if (await hasContainedFile(repoPath, "yarn.lock")) return "yarn";
  if (await hasContainedFile(repoPath, "bun.lock")) return "bun";
  if (await hasContainedFile(repoPath, "bun.lockb")) return "bun";
  return "npm";
}

/** File candidates for each ecosystem, tried in order (first hit wins). */
const MAKEFILE_NAMES = ["GNUmakefile", "makefile", "Makefile"];
const JUSTFILE_NAMES = ["justfile", "Justfile", ".justfile"];
const TASKFILE_NAMES = [
  "Taskfile.yml",
  "taskfile.yml",
  "Taskfile.yaml",
  "taskfile.yaml",
  "Taskfile.dist.yml",
  "taskfile.dist.yml",
  "Taskfile.dist.yaml",
  "taskfile.dist.yaml",
];
const COMPOSE_NAMES = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"];

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

  tasks.push(...(await discoverTaskfiles(repoPath, opts.taskfileFiles, opts.onTaskfileRead)));

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
