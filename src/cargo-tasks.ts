/** Static Cargo command qualification, without invoking Cargo or evaluating TOML. */
import { hasContainedFile, readContainedFile } from "./fs-safe.js";
import { readdir, realpath, stat } from "fs/promises";
import { isAbsolute, join, posix } from "path";
import { isPathInsideDir } from "./utils.js";
import {
  readKey,
  statements,
  stringArray,
  stringValue,
  tablePath,
} from "./python-script-declarations.js";
import { cargoDependencies, cargoMemberTopology, unlinkedCargoPath } from "./cargo-workspace.js";

interface CargoManifest {
  package?: { name: string; autolib: boolean; autobins: boolean };
  workspace?: { members: string[]; defaults?: string[] };
}

const TARGET_TABLES = new Set(["lib", "bin", "example", "test", "bench"]);
const MAX_MEMBERS = 64;
const MAX_CARGO_BYTES = 2 * 1024 * 1024;

function paths(value: string, wildcard = false): string[] | undefined {
  const array = stringArray(value, 0);
  if (!array || array.end !== value.length || array.value.length > MAX_MEMBERS) return;
  const paths: string[] = [];
  for (const path of array.value) {
    const literal = wildcard && path.endsWith("/*") ? path.slice(0, -2) : path;
    if (
      !literal ||
      isAbsolute(literal) ||
      /[\\*?{}]/.test(literal) ||
      literal.includes("[") ||
      literal.includes("]") ||
      literal.split("/").some((part) => part === "" || part === "." || part === "..")
    )
      return;
    for (const char of path) {
      const code = char.charCodeAt(0);
      if (code < 32 || code === 127) return;
    }
    paths.push(path);
  }
  if (new Set(paths).size !== paths.length) return;
  return paths;
}

/** Relevant literal declarations only; unrelated metadata is not interpreted. */
export function cargoManifest(content: string): CargoManifest | undefined {
  return parseCargoManifest(content);
}

function parseCargoManifest(content: string, wildcard = false): CargoManifest | undefined {
  const manifest: CargoManifest = {};
  let section: "package" | "workspace" | undefined;
  const tables = new Set<string>();
  const fields = new Set<string>();
  const parsed = statements(content);
  let autolib = true;
  let autobins = true;
  while (true) {
    const next = parsed.next();
    if (next.done) {
      if (!next.value) return;
      break;
    }
    const statement = next.value;
    if (!statement) continue;
    if (statement.startsWith("[")) {
      const array = statement.startsWith("[[") && statement.endsWith("]]");
      const path = tablePath(array ? statement.slice(1, -1) : statement);
      if (!path || TARGET_TABLES.has(path[0])) return;
      section =
        path.length === 1 && (path[0] === "package" || path[0] === "workspace")
          ? path[0]
          : undefined;
      if (section) {
        if (array || tables.has(section)) return;
        tables.add(section);
        if (section === "workspace") manifest.workspace = { members: [] };
      }
      continue;
    }
    if (!section) continue;
    const key = readKey(statement, 0);
    if (!key) return;
    const relevant =
      section === "package"
        ? ["name", "autolib", "autobins", "workspace"]
        : ["members", "default-members", "exclude"];
    if (!relevant.includes(key.value)) continue;
    const identifier = `${section}.${key.value}`;
    if (fields.has(identifier)) return;
    fields.add(identifier);
    const rest = statement.slice(key.end).trim();
    if (!rest.startsWith("=")) return;
    const value = rest.slice(1).trim();
    if (section === "package") {
      if (key.value === "workspace") return;
      if (key.value === "name") {
        const name = stringValue(value);
        if (!name || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) return;
        manifest.package = { name, autolib: true, autobins: true };
      } else {
        if (value !== "true" && value !== "false") return;
        if (key.value === "autolib") autolib = value === "true";
        else autobins = value === "true";
      }
    } else {
      if (key.value === "exclude") return;
      const entries = paths(value, wildcard && key.value === "members");
      if (!entries) return;
      if (key.value === "members") manifest.workspace!.members = entries;
      else manifest.workspace!.defaults = entries;
    }
  }
  if (tables.has("package") && !manifest.package) return;
  if (!manifest.package && !manifest.workspace) return;
  if (manifest.workspace) {
    const { members, defaults } = manifest.workspace;
    if (!manifest.package && members.length === 0) return;
    if (
      defaults &&
      (defaults.length === 0 ||
        (!members.some((member) => member.endsWith("/*")) &&
          defaults.some((member) => !members.includes(member))))
    )
      return;
  }
  if (manifest.package) Object.assign(manifest.package, { autolib, autobins });
  return manifest;
}

export interface CargoDiscoveryOptions {
  /** Selected scan inventory; all qualifying manifests and targets must be included. */
  files?: ReadonlySet<string>;
  /** Contained manifests actually loaded for effective cache evidence. */
  onRead?: (path: string, content: string) => void;
  /** Bounded directory/declared membership evidence; never manifest contents. */
  onWorkspaceEvidence?: (path: string, evidence: string) => void;
}

/** Recognize ordinary implicit Cargo targets and contained literal workspace members. */
export async function hasCargoTasks(
  root: string,
  options: CargoDiscoveryOptions = {}
): Promise<boolean> {
  let loadedBytes = 0;
  let strictWorkspace = false;
  const contents = new Map<string, string>();
  const included = (path: string): boolean => !options.files || options.files.has(path);
  const read = async (path: string): Promise<CargoManifest | undefined> => {
    if (!included(path)) return;
    try {
      const [realRoot, target] = await Promise.all([realpath(root), realpath(join(root, path))]);
      if (!isPathInsideDir(realRoot, target)) return;
      const metadata = await stat(target);
      if (!metadata.isFile() || metadata.size > MAX_CARGO_BYTES - loadedBytes) return;
      const content = await readContainedFile(root, path);
      loadedBytes += Buffer.byteLength(content);
      if (loadedBytes > MAX_CARGO_BYTES) return;
      options.onRead?.(path, content);
      contents.set(path, content);
      return path === "Cargo.toml" ? parseCargoManifest(content, true) : cargoManifest(content);
    } catch {
      return;
    }
  };
  const exists = async (path: string): Promise<boolean> =>
    included(path) &&
    (!strictWorkspace || (await unlinkedCargoPath(root, path))) &&
    hasContainedFile(root, path);
  const eligible = async (
    directory: string,
    pkg: NonNullable<CargoManifest["package"]>
  ): Promise<boolean> => {
    const path = (relative: string): string => posix.join(directory, relative);
    if (pkg.autolib && (await exists(path("src/lib.rs")))) return true;
    if (!pkg.autobins) return false;
    if (await exists(path("src/main.rs"))) return true;
    if (options.files) {
      for (const file of options.files) {
        const relative = posix.relative(directory || ".", file);
        if (
          /^src\/bin\/[A-Za-z_][A-Za-z0-9_-]*(?:\.rs|\/main\.rs)$/.test(relative) &&
          (await exists(file))
        )
          return true;
      }
      return false;
    }
    // Standalone tasks has no scan inventory: enumerate only immediate implicit bin paths.
    try {
      const [realRoot, bins] = await Promise.all([
        realpath(root),
        realpath(join(root, path("src/bin"))),
      ]);
      if (!isPathInsideDir(realRoot, bins)) return false;
      const entries = await readdir(bins, { withFileTypes: true });
      if (entries.length > 512) return false;
      for (const entry of entries) {
        if (
          entry.isFile() &&
          /^[A-Za-z_][A-Za-z0-9_-]*\.rs$/.test(entry.name) &&
          (await exists(path(`src/bin/${entry.name}`)))
        )
          return true;
        if (
          entry.isDirectory() &&
          /^[A-Za-z_][A-Za-z0-9_-]*$/.test(entry.name) &&
          (await exists(path(`src/bin/${entry.name}/main.rs`)))
        )
          return true;
      }
    } catch {
      // Unreadable or out-of-scope targets cannot qualify a convention.
    }
    return false;
  };
  const manifest = await read("Cargo.toml");
  if (!manifest) return false;
  if (manifest.workspace?.members.some((member) => member.endsWith("/*"))) {
    strictWorkspace = true;
    const topology = await cargoMemberTopology(root, manifest.workspace.members);
    const evidence: Record<string, unknown> = {
      ...topology,
      defaults: manifest.workspace.defaults,
      qualified: false,
    };
    try {
      if (!topology.members || !(await unlinkedCargoPath(root, "Cargo.toml"))) return false;
      const members = topology.members;
      if (manifest.workspace.defaults?.some((member) => !members.includes(member))) return false;
      const rootDependencies = cargoDependencies(contents.get("Cargo.toml")!);
      if (!rootDependencies || (!manifest.package && rootDependencies.count)) return false;
      const packages = new Map<string, NonNullable<CargoManifest["package"]>>();
      const names = new Set<string>();
      if (manifest.package) packages.set("", manifest.package);
      for (const member of members) {
        if (
          !(await unlinkedCargoPath(root, member)) ||
          !(await unlinkedCargoPath(root, posix.join(member, "Cargo.toml")))
        )
          return false;
        const child = await read(posix.join(member, "Cargo.toml"));
        if (!child?.package || child.workspace) return false;
        packages.set(member, child.package);
      }
      const edges = new Map<string, string[]>();
      let declarations = 0;
      for (const [directory, pkg] of packages) {
        if (names.has(pkg.name) || !(await eligible(directory, pkg))) return false;
        names.add(pkg.name);
        const dependencies = directory
          ? cargoDependencies(contents.get(posix.join(directory, "Cargo.toml"))!)
          : rootDependencies;
        if (!dependencies || (declarations += dependencies.count) > 512) return false;
        const targets: string[] = [];
        for (const dependency of dependencies.paths) {
          const target = posix.normalize(posix.join(directory, dependency.path));
          const member = target === "." ? "" : target;
          if (
            packages.get(member)?.name !== dependency.name ||
            !(await unlinkedCargoPath(root, member || "."))
          )
            return false;
          targets.push(member);
        }
        edges.set(directory, targets);
      }
      // Decline cycles rather than infer an executable recipe from membership alone.
      const done = new Set<string>(),
        visiting = new Set<string>();
      const acyclic = (member: string): boolean => {
        if (visiting.has(member)) return false;
        if (done.has(member)) return true;
        visiting.add(member);
        if (!(edges.get(member) ?? []).every(acyclic)) return false;
        visiting.delete(member);
        done.add(member);
        return true;
      };
      if (![...packages.keys()].every(acyclic)) return false;
      evidence.dependencies = [...edges].map(([member, targets]) => [member, [...targets].sort()]);
      evidence.qualified = true;
      return true;
    } finally {
      options.onWorkspaceEvidence?.("Cargo.toml", JSON.stringify(evidence));
    }
  }
  if (manifest.package && !(await eligible("", manifest.package))) return false;
  if (manifest.workspace) {
    const names = new Set(manifest.package ? [manifest.package.name] : []);
    for (const member of manifest.workspace.members) {
      const child = await read(posix.join(member, "Cargo.toml"));
      if (
        !child?.package ||
        child.workspace ||
        names.has(child.package.name) ||
        !(await eligible(member, child.package))
      )
        return false;
      names.add(child.package.name);
    }
  }
  return true;
}
