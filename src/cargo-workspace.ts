/** Bounded single-level workspace evidence; no Cargo or general glob evaluation. */
import { lstat, opendir, realpath } from "fs/promises";
import { isAbsolute, join, posix } from "path";
import { isPathInsideDir } from "./utils.js";
import { readKey, statements, stringValue, tablePath } from "./python-script-declarations.js";

function hasControl(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Reject links in relative components while allowing the selected root's physical alias. */
export async function unlinkedCargoPath(root: string, path: string): Promise<boolean> {
  const relative = posix.normalize(path);
  if (
    isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith("../") ||
    relative.includes("\\") ||
    hasControl(relative)
  )
    return false;
  try {
    const canonical = await realpath(root);
    let target = canonical;
    for (const part of relative === "." ? [] : relative.split("/")) {
      target = join(target, part);
      if ((await lstat(target)).isSymbolicLink()) return false;
    }
    return isPathInsideDir(canonical, await realpath(target));
  } catch {
    return false;
  }
}

interface Topology {
  status:
    "complete" | "unavailable" | "prefix-limit" | "entry-limit" | "ambiguous" | "member-limit";
  prefixes: Array<{ path: string; type: string }>;
  entries?: Array<{ path: string; type: string }>;
  members?: string[];
}

function literalPath(path: string): boolean {
  return (
    !!path &&
    !isAbsolute(path) &&
    !/[:\\*?{}]/.test(path) &&
    !path.includes("[") &&
    !path.includes("]") &&
    !hasControl(path) &&
    !path.split("/").some((part) => !part || part === "." || part === "..")
  );
}

/** Complete direct entry lists precede content selection; incomplete lists are never retained. */
export async function cargoMemberTopology(
  root: string,
  declarations: readonly string[]
): Promise<Topology> {
  const paths = [
    ...new Set(declarations.filter((path) => path.endsWith("/*")).map((path) => path.slice(0, -2))),
  ].sort();
  if (paths.length > 64) return { status: "prefix-limit", prefixes: [] };
  const prefixes: Topology["prefixes"] = [];
  for (const path of paths) {
    let type = "unavailable";
    try {
      const metadata = await lstat(join(root, path));
      type = metadata.isSymbolicLink()
        ? "link"
        : metadata.isDirectory()
          ? "directory"
          : metadata.isFile()
            ? "file"
            : "other";
      if (type === "directory" && !(await unlinkedCargoPath(root, path))) type = "unavailable";
    } catch {
      /* no observation can prove a missing/unreadable prefix */
    }
    prefixes.push({ path, type });
  }
  const result: Topology = { status: "unavailable", prefixes };
  if (prefixes.some((prefix) => prefix.type !== "directory")) return result;
  const entries: NonNullable<Topology["entries"]> = [];
  try {
    for (const prefix of prefixes) {
      const directory = await opendir(join(root, prefix.path));
      for await (const entry of directory) {
        if (entries.length >= 512) return { status: "entry-limit", prefixes };
        const path = posix.join(prefix.path, entry.name);
        const metadata = await lstat(join(root, path));
        const type = metadata.isSymbolicLink()
          ? "link"
          : metadata.isDirectory()
            ? "directory"
            : metadata.isFile()
              ? "file"
              : "other";
        entries.push({ path, type });
      }
    }
  } catch {
    return result;
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const members = declarations.filter((path) => !path.endsWith("/*"));
  for (const prefix of prefixes) {
    const children = entries.filter((entry) => posix.dirname(entry.path) === prefix.path);
    if (
      children.some((entry) => entry.type !== "directory" && entry.type !== "file") ||
      !children.some((entry) => entry.type === "directory")
    )
      return { status: "ambiguous", prefixes, entries };
    members.push(
      ...children.filter((entry) => entry.type === "directory").map((entry) => entry.path)
    );
  }
  if (members.some((path) => !literalPath(path)) || new Set(members).size !== members.length)
    return { status: "ambiguous", prefixes, entries };
  if (members.length > 64) return { status: "member-limit", prefixes, entries };
  return { status: "complete", prefixes, entries, members: members.sort() };
}

interface Dependencies {
  count: number;
  paths: Array<{ name: string; path: string }>;
}
const CLASSES = new Set(["dependencies", "dev-dependencies", "build-dependencies"]);
const LEGACY_CLASSES = new Set(["dev_dependencies", "build_dependencies"]);
const INHERITED = new Set(["package", "dependencies", "lints"]);
// Finite common registry-version subset: literal numeric versions, caret/tilde or wildcard.
const VERSION = /^(?:\*|[~^]?(?:0|[1-9]\d{0,8})(?:\.(?:0|[1-9]\d{0,8})){0,2})$/;

function pathValue(value: string): string | undefined {
  const path = stringValue(value);
  if (
    !path ||
    isAbsolute(path) ||
    /[:\\*?{}]/.test(path) ||
    path.includes("[") ||
    path.includes("]") ||
    hasControl(path) ||
    path.split("/").some((part) => !part)
  )
    return;
  return path;
}

function inlinePath(value: string): string | undefined {
  if (!value.startsWith("{") || !value.endsWith("}")) return;
  const body = value.slice(1, -1).trim(),
    key = readKey(body, 0);
  if (!key || key.value !== "path") return;
  const rest = body.slice(key.end).trim();
  return rest.startsWith("=") ? pathValue(rest.slice(1).trim()) : undefined;
}

/** Only completely recognized dependency projections can prove a closed member set. */
export function cargoDependencies(content: string): Dependencies | undefined {
  const result: Dependencies = { count: 0, paths: [] };
  let table: string[] = [];
  let dependency: string | undefined;
  let list = false;
  const tables = new Set<string>(),
    fields = new Set<string>();
  const detailed = new Set<string>(),
    detailedPaths = new Set<string>();
  const parsed = statements(content);
  while (true) {
    const next = parsed.next();
    if (next.done)
      return next.value && [...detailed].every((key) => detailedPaths.has(key))
        ? result
        : undefined;
    const statement = next.value;
    if (!statement) continue;
    if (statement.startsWith("[")) {
      const path = tablePath(statement);
      if (!path) return;
      table = path;
      dependency = undefined;
      list = false;
      if (
        ["patch", "replace", "project", "lints"].includes(path[0]) ||
        LEGACY_CLASSES.has(path[0]) ||
        (path[0] === "workspace" && INHERITED.has(path[1])) ||
        (path[0] === "package" && path.length > 1 && path[1] !== "metadata")
      )
        return;
      const index = CLASSES.has(path[0])
        ? 0
        : path[0] === "target" && path.length >= 3 && CLASSES.has(path[2])
          ? 2
          : -1;
      if (index < 0) {
        if (path[0] === "target") return;
        continue;
      }
      if (path.length !== index + 1 && path.length !== index + 2) return;
      const key = JSON.stringify(path);
      if (tables.has(key) || fields.has(key)) return;
      tables.add(key);
      list = path.length === index + 1;
      if (!list) {
        dependency = path[index + 1];
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(dependency)) return;
        detailed.add(key);
        if (++result.count > 512) return;
      }
      continue;
    }
    const key = readKey(statement, 0);
    if (!key) return;
    const rest = statement.slice(key.end).trim();
    const relevantRoot =
      !table.length &&
      (CLASSES.has(key.value) ||
        LEGACY_CLASSES.has(key.value) ||
        ["target", "patch", "replace", "workspace", "package", "project", "lints"].includes(
          key.value
        ));
    // Whole/dotted root declarations and workspace inline inheritance are outside this projection.
    if (
      relevantRoot ||
      (table.length === 1 && table[0] === "workspace" && INHERITED.has(key.value)) ||
      (table.length === 1 &&
        table[0] === "package" &&
        key.value !== "metadata" &&
        (rest.startsWith(".") || /^=\s*\{/.test(rest)))
    )
      return;
    if (!list && !dependency) continue;
    if (!rest.startsWith("=")) return;
    const identifier = JSON.stringify([...table, key.value]);
    if (fields.has(identifier) || (list && tables.has(identifier))) return;
    fields.add(identifier);
    const value = rest.slice(1).trim();
    if (dependency) {
      if (key.value !== "path") return;
      const path = pathValue(value);
      if (!path) return;
      detailedPaths.add(JSON.stringify(table));
      result.paths.push({ name: dependency, path });
    } else {
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key.value)) return;
      if (++result.count > 512) return;
      const version = stringValue(value);
      if (version !== undefined) {
        if (!VERSION.test(version)) return;
        continue;
      }
      const path = inlinePath(value);
      if (!path) return;
      result.paths.push({ name: key.value, path });
    }
  }
}
