import type {
  TomlMetadataTable,
  TomlMetadataValue,
  scanTomlMetadata,
} from "./toml-metadata-scan.js";

export const POETRY_METADATA_PREFIX = "Declared Poetry metadata: ";
export interface PoetryDependency {
  name: string;
  version: string;
  type: "runtime" | "dev";
  description?: string;
}
interface Family {
  path: string[];
  phase: number;
  offset: number;
  type: "runtime" | "dev";
}

// Functional field sets from poetry-core's dependency schema. This is typed
// metadata validation, not marker evaluation, source lookup or constraint solving.
const common = ["python", "platform", "markers", "optional", "extras"];
const rules: { required?: string; fields: Set<string> }[] = [
  {
    required: "version",
    fields: new Set(["version", ...common, "allow-prereleases", "allows-prereleases", "source"]),
  },
  {
    required: "git",
    fields: new Set([
      "git",
      "branch",
      "tag",
      "rev",
      "subdirectory",
      ...common,
      "allow-prereleases",
      "allows-prereleases",
      "develop",
    ]),
  },
  { required: "file", fields: new Set(["file", "subdirectory", ...common]) },
  { required: "path", fields: new Set(["path", "subdirectory", ...common, "develop"]) },
  { required: "url", fields: new Set(["url", "subdirectory", ...common]) },
  { fields: new Set(["python", "platform", "markers", "allow-prereleases", "source", "develop"]) },
];
const flags = new Set(["optional", "develop", "allow-prereleases", "allows-prereleases"]);
const validName = (name: string): boolean => name.length > 0 && !/[^A-Za-z0-9._-]/.test(name);

function acceptedObject(value: TomlMetadataTable): boolean {
  for (const [key, field] of value) {
    if (key === "extras") {
      if (!Array.isArray(field) || !field.every((item) => typeof item === "string")) return false;
    } else if (flags.has(key)) {
      if (typeof field !== "boolean") return false;
    } else if (typeof field !== "string") return false;
  }
  return rules.some(
    (rule) =>
      (!rule.required || value.has(rule.required)) &&
      [...value.keys()].every((key) => rule.fields.has(key))
  );
}
function acceptedSingle(value: TomlMetadataValue): boolean {
  return typeof value === "string" || (value instanceof Map && acceptedObject(value));
}
function accepted(value: TomlMetadataValue): boolean {
  return Array.isArray(value)
    ? value.length > 0 && value.every(acceptedSingle)
    : acceptedSingle(value);
}

/** Complete ordered alternatives, sorted object fields; no branch is selected. */
export function serializePoetryMetadata(value: TomlMetadataValue): string {
  const plain = (item: TomlMetadataValue): unknown => {
    if (item instanceof Map)
      return Object.fromEntries(
        [...item]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, field]) => [key, plain(field)])
      );
    if (Array.isArray(item)) return item.map(plain);
    return item;
  };
  return JSON.stringify(plain(value));
}
function tableAt(root: TomlMetadataTable, path: string[]): TomlMetadataValue | undefined {
  let value: TomlMetadataValue = root;
  for (const key of path) {
    if (!(value instanceof Map)) return undefined;
    const next = value.get(key);
    if (next === undefined) return undefined;
    value = next;
  }
  return value;
}
function family(path: string[], offset: number): Family | null {
  if (path[0] !== "tool" || path[1] !== "poetry") return null;
  if (path[2] === "dependencies")
    return { path: path.slice(0, 3), phase: 0, offset, type: "runtime" };
  if (path[2] === "dev-dependencies")
    return { path: path.slice(0, 3), phase: 1, offset, type: "dev" };
  if (path[2] === "group" && path[4] === "dependencies" && validName(path[3] ?? "")) {
    const dev = ["dev", "test"].includes(path[3].toLowerCase());
    return { path: path.slice(0, 5), phase: 2, offset, type: dev ? "dev" : "runtime" };
  }
  return null;
}

/** Finish and validate every dependency before first-wins admission by caller. */
export function projectPoetryDependencies(document: ReturnType<typeof scanTomlMetadata>): {
  dependencies: PoetryDependency[];
  sawPoetry: boolean;
} {
  const namespace = tableAt(document.root, ["tool", "poetry"]);
  const sawPoetry = namespace !== undefined;
  if (!document.complete) return { dependencies: [], sawPoetry };
  const paths: string[][] = [
    ["tool", "poetry", "dependencies"],
    ["tool", "poetry", "dev-dependencies"],
  ];
  const groups = tableAt(document.root, ["tool", "poetry", "group"]);
  if (groups instanceof Map) {
    for (const group of groups.keys())
      if (validName(group)) paths.push(["tool", "poetry", "group", group, "dependencies"]);
  }
  const occurrences = document.occurrences ?? document.declarations;
  const families: Family[] = [];
  for (const path of paths) {
    if (!(tableAt(document.root, path) instanceof Map)) continue;
    const occurrence = occurrences.find(
      (entry) =>
        entry.path.length >= path.length && path.every((key, index) => entry.path[index] === key)
    );
    if (occurrence) {
      const item = family(path, occurrence.offset);
      if (item) families.push(item);
    }
  }
  const dependencies: PoetryDependency[] = [];
  for (const item of families.sort((a, b) => a.phase - b.phase || a.offset - b.offset)) {
    const values = tableAt(document.root, item.path);
    if (!(values instanceof Map)) continue;
    for (const [name, value] of values) {
      if (!validName(name) || (item.type === "runtime" && name === "python") || !accepted(value))
        continue;
      const version =
        typeof value === "string"
          ? value
          : value instanceof Map
            ? ((value.get("version") as string | undefined) ?? "*")
            : serializePoetryMetadata(value);
      // Ordinary scalar and version-only declarations keep their existing API
      // shape. Semantic origin/marker/alternative information remains visible
      // through the already-public optional description field.
      const structured =
        Array.isArray(value) ||
        (value instanceof Map && (value.size !== 1 || !value.has("version")));
      const literal =
        [...version].some(
          (character) => "`[]".includes(character) || character.charCodeAt(0) < 32
        ) ||
        (version.match(/\*/g)?.length ?? 0) > 1 ||
        version.trim() !== version;
      const description =
        structured || literal ? POETRY_METADATA_PREFIX + serializePoetryMetadata(value) : undefined;
      dependencies.push({
        name,
        version,
        type: item.type,
        ...(description === undefined ? {} : { description }),
      });
    }
  }
  return { dependencies, sawPoetry };
}
