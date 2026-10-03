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

interface CargoManifest {
  package?: { name: string; autolib: boolean; autobins: boolean };
  workspace?: { members: string[]; defaults?: string[] };
}

const TARGET_TABLES = new Set(["lib", "bin", "example", "test", "bench"]);
const MAX_MEMBERS = 64;
const MAX_CARGO_BYTES = 2 * 1024 * 1024;

function paths(value: string): string[] | undefined {
  const array = stringArray(value, 0);
  if (!array || array.end !== value.length || array.value.length > MAX_MEMBERS) return;
  const paths: string[] = [];
  for (const path of array.value) {
    if (
      !path ||
      isAbsolute(path) ||
      /[\\*?{}]/.test(path) ||
      path.includes("[") ||
      path.includes("]") ||
      path.split("/").some((part) => part === "" || part === "." || part === "..")
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
      const entries = paths(value);
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
    if (defaults && (defaults.length === 0 || defaults.some((member) => !members.includes(member))))
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
}

/** Recognize ordinary implicit Cargo targets and contained literal workspace members. */
export async function hasCargoTasks(
  root: string,
  options: CargoDiscoveryOptions = {}
): Promise<boolean> {
  let loadedBytes = 0;
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
      return cargoManifest(content);
    } catch {
      return;
    }
  };
  const exists = async (path: string): Promise<boolean> =>
    included(path) && hasContainedFile(root, path);
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
