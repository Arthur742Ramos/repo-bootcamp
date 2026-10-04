import type {
  scanTomlMetadata,
  TomlMetadataTable,
  TomlMetadataValue,
} from "./toml-metadata-scan.js";

type CargoKind = "dependencies" | "dev-dependencies" | "build-dependencies";
export interface CargoDependencyDeclaration {
  section: CargoKind;
  name: string;
  version: string;
}

const kinds: CargoKind[] = ["dependencies", "dev-dependencies", "build-dependencies"];
// Cargo package names allow Unicode alphanumeric characters, '-' and '_'.
// crates.io publishing restrictions are narrower and do not apply to local data.
// https://doc.rust-lang.org/cargo/reference/manifest.html#the-name-field
const validName = (name: string): boolean =>
  name.length > 0 && !/[^\p{Alphabetic}\p{Number}_-]/u.test(name);

function declaredVersion(value: TomlMetadataValue): string | null {
  if (typeof value === "string") return value.length ? value : null;
  if (!(value instanceof Map)) return null;
  if (value.has("version")) {
    const version = value.get("version");
    return typeof version === "string" && version.length ? version : null;
  }
  // Preserve the existing unresolved '*' display for source/inherited forms.
  // No path/Git/registry lookup, target evaluation or workspace resolution occurs.
  if (
    typeof value.get("path") === "string" ||
    typeof value.get("git") === "string" ||
    value.get("workspace") === true
  )
    return "*";
  // Unsupported attribute-only maps and arrays are not dependency declarations.
  return null;
}

/** Complete semantic declarations in source order; caller retains legacy dedup. */
export function projectCargoDependencies(
  document: ReturnType<typeof scanTomlMetadata>
): CargoDependencyDeclaration[] {
  if (!document.complete) return [];
  const families: { path: string[]; table: TomlMetadataTable; section: CargoKind }[] = [];
  const add = (table: TomlMetadataTable, path: string[]): void => {
    for (const section of kinds) {
      const value = table.get(section);
      if (value instanceof Map) families.push({ path: [...path, section], table: value, section });
    }
  };
  add(document.root, []);
  const targets = document.root.get("target");
  if (targets instanceof Map) {
    for (const [target, table] of targets) if (table instanceof Map) add(table, ["target", target]);
  }
  const ordered: (CargoDependencyDeclaration & { offset: number })[] = [];
  for (const family of families) {
    for (const [name, value] of family.table) {
      if (!validName(name)) continue;
      const version = declaredVersion(value);
      if (version === null) continue;
      const path = [...family.path, name];
      const occurrence = document.occurrences.find(
        (entry) =>
          entry.path.length >= path.length && path.every((key, index) => entry.path[index] === key)
      );
      if (occurrence)
        ordered.push({ section: family.section, name, version, offset: occurrence.offset });
    }
  }
  return ordered
    .sort((a, b) => a.offset - b.offset)
    .map(({ section, name, version }) => ({ section, name, version }));
}
