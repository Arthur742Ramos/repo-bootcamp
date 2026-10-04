/**
 * Dependency Analysis Module
 * Extracts and visualizes dependencies from various package managers
 */

import { readFile } from "fs/promises";
import { isWellFormedSourceText, sourcePathCode } from "./source-links.js";
import { join } from "path";
import { scanTomlMetadata } from "./toml-metadata-scan.js";
import { projectCargoDependencies } from "./cargo-projection.js";
import { scanGoDependencyDeclarations } from "./go-dependency-literals.js";
import { POETRY_METADATA_PREFIX, projectPoetryDependencies } from "./poetry-projection.js";
import { tomlArrayBodies, tomlArrayStrings } from "./toml-string-scan.js";
import categoryPatternsJson from "./data/category-patterns.json" with { type: "json" };

/**
 * Dependency information
 */
export interface Dependency {
  name: string;
  version: string;
  type: "runtime" | "dev" | "peer" | "optional";
  description?: string;
  /** Present only when multiple ecosystems contribute dependencies. */
  ecosystem?: "node" | "rust" | "python" | "go";
  sourceFile?: string;
}

/**
 * Categorized dependencies
 */
export interface DependencyCategory {
  name: string;
  deps: string[];
}

/**
 * Full dependency analysis result
 */
export interface DependencyAnalysis {
  packageManager: string;
  /** Ordered contributing managers; omitted for single-ecosystem results. */
  packageManagers?: string[];
  totalCount: number;
  runtime: Dependency[];
  dev: Dependency[];
  peer: Dependency[];
  categories: DependencyCategory[];
}

/**
 * Known dependency categories for smart grouping (loaded from JSON, compiled to RegExp)
 */
const CATEGORY_PATTERNS: Record<string, RegExp[]> = Object.fromEntries(
  Object.entries(categoryPatternsJson).map(([cat, patterns]) => [
    cat,
    (patterns as string[]).map((p) => new RegExp(p)),
  ])
);

/**
 * Categorize a dependency based on its name
 */
function categorizeDependency(name: string): string | null {
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (patterns.some((p) => p.test(name))) {
      return category;
    }
  }
  return null;
}

/** PEP 508 URL markers require whitespace; URI semicolons are literal data. */
function withoutPyprojectRequirementMarker(item: string): string {
  const direct = item.match(/^[A-Za-z0-9._-]+(?:[ \t]*\[[^\]]*\])?[ \t]*@[ \t]*[^ \t\r\n]+/);
  if (direct) {
    const suffix = item.slice(direct[0].length);
    return /^[ \t]+;/.test(suffix) ? direct[0].trim() : item.trim();
  }
  return item.split(";")[0].trim();
}

/** Drop TOML line comments without changing hashes inside quoted strings. */
function stripTomlComments(content: string): string {
  const chunks: string[] = [];
  let start = 0;
  let quote = "";
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (quote) {
      // Basic strings escape quotes/backslashes; literal strings do not.
      if (quote[0] === '"' && character === "\\") {
        index++;
      } else if (content.startsWith(quote, index)) {
        const delimiter = quote[0];
        index += quote.length - 1;
        // Multiline strings can end with an extra one or two literal quotes.
        if (quote.length === 3) {
          for (let extra = 0; extra < 2 && content[index + 1] === delimiter; extra++) index++;
        }
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = content.startsWith(character.repeat(3), index) ? character.repeat(3) : character;
      index += quote.length - 1;
    } else if (character === "#") {
      let end = index + 1;
      while (end < content.length && content[end] !== "\r" && content[end] !== "\n") end++;
      chunks.push(content.slice(start, index), " ");
      start = end;
      index = end - 1;
    }
  }
  chunks.push(content.slice(start));
  return chunks.join("");
}

/**
 * Extract dependencies from package.json
 */
async function extractNpmDependencies(repoPath: string): Promise<DependencyAnalysis | null> {
  try {
    const content = await readFile(join(repoPath, "package.json"), "utf-8");
    const pkg = JSON.parse(content);

    const runtime: Dependency[] = [];
    const dev: Dependency[] = [];
    const peer: Dependency[] = [];
    const categoryMap = new Map<string, string[]>();

    // Extract runtime dependencies
    if (pkg.dependencies) {
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        runtime.push({ name, version: version as string, type: "runtime" });
        const cat = categorizeDependency(name);
        if (cat) {
          if (!categoryMap.has(cat)) categoryMap.set(cat, []);
          categoryMap.get(cat)!.push(name);
        }
      }
    }

    // Extract dev dependencies
    if (pkg.devDependencies) {
      for (const [name, version] of Object.entries(pkg.devDependencies)) {
        dev.push({ name, version: version as string, type: "dev" });
        const cat = categorizeDependency(name);
        if (cat) {
          if (!categoryMap.has(cat)) categoryMap.set(cat, []);
          categoryMap.get(cat)!.push(name);
        }
      }
    }

    // Extract peer dependencies
    if (pkg.peerDependencies) {
      for (const [name, version] of Object.entries(pkg.peerDependencies)) {
        peer.push({ name, version: version as string, type: "peer" });
      }
    }

    // Extract optional dependencies (folded into the runtime list, tagged
    // "optional" — they are installed at runtime when the platform allows).
    if (pkg.optionalDependencies) {
      for (const [name, version] of Object.entries(pkg.optionalDependencies)) {
        runtime.push({ name, version: version as string, type: "optional" });
        const cat = categorizeDependency(name);
        if (cat) {
          if (!categoryMap.has(cat)) categoryMap.set(cat, []);
          categoryMap.get(cat)!.push(name);
        }
      }
    }

    const categories: DependencyCategory[] = Array.from(categoryMap.entries())
      .map(([name, deps]) => ({ name, deps }))
      .sort((a, b) => b.deps.length - a.deps.length);

    return {
      packageManager: "npm",
      totalCount: runtime.length + dev.length + peer.length,
      runtime,
      dev,
      peer,
      categories,
    };
  } catch {
    // No package.json (or unparseable) — let the next extractor try. Stay silent
    // so machine-readable (`--json`) output on non-npm repos is never polluted.
    return null;
  }
}

/**
 * Extract dependencies from Cargo.toml (Rust)
 */
async function extractCargoDependencies(repoPath: string): Promise<DependencyAnalysis | null> {
  try {
    const content = await readFile(join(repoPath, "Cargo.toml"), "utf-8");

    const runtime: Dependency[] = [];
    const dev: Dependency[] = [];
    // Preserve the legacy section/name slots and last non-* version update
    // across global and target declarations; this is not constraint resolution.
    const seen = new Map<string, Dependency>();

    const record = (
      section: "dependencies" | "dev-dependencies" | "build-dependencies",
      name: string,
      version: string
    ): void => {
      const key = `${section}:${name}`;
      const existing = seen.get(key);
      if (existing) {
        if (version && version !== "*") existing.version = version;
        return;
      }
      const dep: Dependency = {
        name,
        version: version || "*",
        // Build-deps run only at compile time (build.rs) and dev-deps only in
        // tests/benches — neither ships in the runtime artifact, so both map to
        // "dev". Only `[dependencies]` (and target-specific `.dependencies`) are
        // runtime.
        type: section === "dependencies" ? "runtime" : "dev",
      };
      seen.set(key, dep);
      (section === "dependencies" ? runtime : dev).push(dep);
    };

    for (const dependency of projectCargoDependencies(scanTomlMetadata(content))) {
      record(dependency.section, dependency.name, dependency.version);
    }

    if (runtime.length === 0 && dev.length === 0) return null;

    return {
      packageManager: "cargo",
      totalCount: runtime.length + dev.length,
      runtime,
      dev,
      peer: [],
      categories: [],
    };
  } catch {
    // No Cargo.toml (or unparseable) — let the next extractor try. Silent so
    // `--json` output on non-Cargo repos is never polluted.
    return null;
  }
}

/**
 * Extract dependencies from pyproject.toml (Python)
 */
async function extractPythonDependencies(
  repoPath: string,
  recordSource?: (sourceFile: string) => void
): Promise<DependencyAnalysis | null> {
  try {
    // Try pyproject.toml first
    let content: string;
    let packageManager = "poetry";
    let sourceFile = "pyproject.toml";

    try {
      content = await readFile(join(repoPath, "pyproject.toml"), "utf-8");
    } catch {
      // Fall back to requirements.txt
      try {
        content = await readFile(join(repoPath, "requirements.txt"), "utf-8");
        packageManager = "pip";
        sourceFile = "requirements.txt";
      } catch {
        return null;
      }
    }

    const runtime: Dependency[] = [];
    const dev: Dependency[] = [];

    if (packageManager === "pip") {
      // Parse requirements.txt
      for (const rawLine of content.split("\n")) {
        const trimmed = rawLine.trim();
        // Skip blanks, comments, and pip option/include lines
        // (`-r`, `-e`, `-c`, `--hash`, `--index-url`, …).
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
        // Drop inline comments, environment markers, and extras before parsing.
        // Do this BEFORE the VCS/URL skip so a normal requirement with a URL in
        // a trailing comment (`requests==2.31 # see https://…`) isn't skipped.
        const cleaned = trimmed.split(/\s+#/)[0].split(";")[0].trim();
        if (!cleaned) continue;
        // Skip VCS, URL, archive, and local-path requirements — these have no
        // PyPI name to extract and the name regex below would otherwise coin a
        // bogus one (`git+https://…` → "git", a bare URL → "https", `./pkg` →
        // "."), inflating totalCount (which also feeds radar onboarding-risk).
        if (
          cleaned.includes("://") ||
          /^(?:git|hg|svn|bzr)\+/.test(cleaned) ||
          cleaned.startsWith(".") ||
          cleaned.startsWith("/")
        ) {
          continue;
        }
        const match = cleaned.match(/^([A-Za-z0-9._-]+)(?:[ \t]*\[[^\]]*\])?\s*[=<>!~]*\s*(.*)$/);
        if (match) {
          const version = (match[2] || "").trim();
          runtime.push({ name: match[1], version: version || "*", type: "runtime" });
        }
      }
    } else {
      const metadata = scanTomlMetadata(content);
      const poetry = projectPoetryDependencies(metadata);
      // Actual structural headers only: strings cannot invent section state.
      // Keep PEP array parsing/marker conventions separate from Poetry values.
      const sections = new Map<string, string>();
      const stripped = stripTomlComments(content);
      const safeHeaders = scanTomlMetadata(stripped).declarations.filter(
        (entry) => entry.kind === "table"
      );
      for (let index = 0; index < safeHeaders.length; index++) {
        const header = safeHeaders[index];
        for (const path of [
          ["project"],
          ["project", "optional-dependencies"],
          ["dependency-groups"],
        ]) {
          if (JSON.stringify(header.path) === JSON.stringify(path)) {
            sections.set(
              path.join("."),
              stripped.slice(header.end, safeHeaders[index + 1]?.offset ?? stripped.length)
            );
          }
        }
      }
      // PyPI identity is case-insensitive and folds separator runs; retain
      // the first accepted spelling/version independently in each target.
      const identities = new Map<Dependency[], Set<string>>();
      const addDependency = (
        name: string,
        version: string,
        type: "runtime" | "dev",
        target: Dependency[],
        description?: string
      ): void => {
        const identity = name.toLowerCase().replace(/[-_.]+/g, "-");
        let seen = identities.get(target);
        if (!seen) {
          seen = new Set<string>();
          identities.set(target, seen);
        }
        if (seen.has(identity)) return;
        seen.add(identity);
        target.push({ name, version, type, ...(description === undefined ? {} : { description }) });
      };

      // PEP 508 array-of-strings (`["flask>=2.0", "requests[security]>=2.28"]`).
      // Decode complete TOML literals before stripping PEP 508 markers. Quotes,
      // commas and brackets inside a marker are string content, not boundaries.
      // Strips extras and environment markers, mirroring requirements.txt.
      const parseRequirementArray = (
        body: string,
        type: "runtime" | "dev",
        target: Dependency[]
      ): void => {
        for (const quoted of tomlArrayStrings(body)) {
          const item = quoted.trim();
          if (!item || item.startsWith("#")) continue;
          const cleaned = withoutPyprojectRequirementMarker(item);
          const match = cleaned.match(/^([A-Za-z0-9._-]+)(?:[ \t]*\[[^\]]*\])?\s*(.*)$/);
          if (!match) continue;
          const version = (match[2] || "").trim();
          addDependency(match[1], version || "*", type, target);
        }
      };

      for (const dependency of poetry.dependencies) {
        addDependency(
          dependency.name,
          dependency.version,
          dependency.type,
          dependency.type === "runtime" ? runtime : dev,
          dependency.description
        );
      }

      // PEP 621 `[project]` (uv, hatch, pdm, setuptools, modern Poetry): the
      // `dependencies = [...]` array, ignoring quoted metadata and brackets
      // inside complete string literals.
      if (sections.has("project")) {
        const projectBody = sections.get("project")!;
        parseRequirementArray(
          tomlArrayBodies(projectBody, "dependencies")[0] ?? "",
          "runtime",
          runtime
        );
      }

      // PEP 621 optional dependencies: each extra is its own array. Treated as
      // runtime (installable features, not dev tooling).
      if (sections.has("project.optional-dependencies")) {
        for (const arr of tomlArrayBodies(sections.get("project.optional-dependencies")!)) {
          parseRequirementArray(arr, "runtime", runtime);
        }
      }

      // PEP 735 dependency groups: `[dependency-groups]` (dev tooling).
      if (sections.has("dependency-groups")) {
        for (const arr of tomlArrayBodies(sections.get("dependency-groups")!)) {
          parseRequirementArray(arr, "dev", dev);
        }
      }

      // Prefer a more specific package-manager label when detectable.
      if (poetry.sawPoetry) {
        packageManager = "poetry";
      } else if (sections.has("project") || sections.has("dependency-groups")) {
        packageManager = "pip";
      }
    }

    if (runtime.length === 0 && dev.length === 0) return null;
    recordSource?.(sourceFile);

    return {
      packageManager,
      totalCount: runtime.length + dev.length,
      runtime,
      dev,
      peer: [],
      categories: [],
    };
  } catch {
    return null;
  }
}

/**
 * Extract dependencies from go.mod (Go)
 */
async function extractGoDependencies(repoPath: string): Promise<DependencyAnalysis | null> {
  try {
    const content = await readFile(join(repoPath, "go.mod"), "utf-8");

    const runtime: Dependency[] = [];
    const seen = new Set<string>();
    const add = (name: string, version: string): void => {
      if (seen.has(name)) return;
      seen.add(name);
      runtime.push({ name, version, type: "runtime" });
    };

    for (const dependency of scanGoDependencyDeclarations(content))
      add(dependency.name, dependency.version);

    if (runtime.length === 0) return null;

    return {
      packageManager: "go",
      totalCount: runtime.length,
      runtime,
      dev: [],
      peer: [],
      categories: [],
    };
  } catch {
    return null;
  }
}

/**
 * Extract dependencies from the repository
 */
export async function extractDependencies(repoPath: string): Promise<DependencyAnalysis | null> {
  // Keep each extractor's own precedence and parsing rules. Only combine
  // ecosystems that actually contribute records at the selected root.
  let pythonSource = "pyproject.toml";
  const results = [
    {
      result: await extractNpmDependencies(repoPath),
      ecosystem: "node",
      sourceFile: "package.json",
    },
    {
      result: await extractCargoDependencies(repoPath),
      ecosystem: "rust",
      sourceFile: "Cargo.toml",
    },
    {
      result: await extractPythonDependencies(repoPath, (source) => {
        pythonSource = source;
      }),
      ecosystem: "python",
      sourceFile: pythonSource,
    },
    { result: await extractGoDependencies(repoPath), ecosystem: "go", sourceFile: "go.mod" },
  ] as const;
  const contributing = results.filter(({ result }) => result && result.totalCount > 0);
  // Return the original object for single ecosystems, including an empty npm
  // manifest when none of the other extractors finds dependencies.
  if (contributing.length < 2) {
    return contributing[0]?.result ?? results.find(({ result }) => result)?.result ?? null;
  }

  const combined: DependencyAnalysis = {
    packageManager: contributing[0].result!.packageManager,
    packageManagers: contributing.map(({ result }) => result!.packageManager),
    totalCount: 0,
    runtime: [],
    dev: [],
    peer: [],
    categories: [],
  };
  const categoryMap = new Map<string, string[]>();
  for (const { result, ecosystem, sourceFile } of contributing) {
    for (const type of ["runtime", "dev", "peer"] as const) {
      combined[type].push(...result![type].map((dep) => ({ ...dep, ecosystem, sourceFile })));
    }
    for (const category of result!.categories) {
      const names = categoryMap.get(category.name) ?? [];
      names.push(...category.deps.map((name) => `${name} (${ecosystem})`));
      categoryMap.set(category.name, names);
    }
    combined.totalCount += result!.totalCount;
  }
  combined.categories = Array.from(categoryMap, ([name, deps]) => ({ name, deps })).sort(
    (a, b) => b.deps.length - a.deps.length
  );
  return combined;
}

/**
 * Generate a Mermaid diagram showing dependency categories
 */
export function generateDependencyDiagram(deps: DependencyAnalysis, projectName: string): string {
  const lines: string[] = [];
  lines.push("graph TD");
  lines.push(`  subgraph "${projectName}"`);
  lines.push(`    APP[("${projectName}")]`);
  lines.push("  end");
  lines.push("");

  if (deps.packageManagers && deps.packageManagers.length > 1) {
    lines.unshift("---", "config:", "  flowchart:", "    padding: 5", "---");
    // Mixed results use the existing flat-list caps, rather than letting a
    // recognized Node category hide uncategorized records from other languages.
    const label = (value: string): string =>
      value
        .replace(/&/g, "#amp;")
        .replace(/"/g, "#quot;")
        .replace(/</g, "#lt;")
        .replace(/>/g, "#gt;")
        .replace(/[\r\n]+/g, " ");
    let previousGroup: string | undefined;
    for (const [group, title, list, cap] of [
      ["Runtime", "Runtime Dependencies", deps.runtime, 10],
      ["Dev", "Dev Dependencies", deps.dev, 8],
      ["Peer", "Peer Dependencies", deps.peer, 8],
    ] as const) {
      if (!list.length) continue;
      lines.push(`  subgraph ${group}["${title}"]`, "    direction TB");
      list.slice(0, cap).forEach((dep, index) => {
        lines.push(`    ${group}_${index}["${label(dep.name)} (${label(dep.ecosystem ?? "")})"]`);
      });
      const nodeIds = list.slice(0, cap).map((_, index) => `${group}_${index}`);
      if (list.length > cap) {
        lines.push(`    ${group}_more["+${list.length - cap} more"]`);
        nodeIds.push(`${group}_more`);
      }
      // Invisible links constrain layout only; unrelated packages have no
      // visible dependency edges between them.
      for (let index = 1; index < nodeIds.length; index++) {
        lines.push(`    ${nodeIds[index - 1]} ~~~ ${nodeIds[index]}`);
      }
      lines.push("  end");
      if (previousGroup) lines.push(`  ${previousGroup} ~~~ ${group}`);
      else lines.push(`  APP --> ${group}`);
      previousGroup = group;
      lines.push("");
    }
    return lines.join("\n");
  }

  lines.unshift("---", "config:", "  flowchart:", "    padding: 5", "    nodeSpacing: 5", "---");

  // Invisible links constrain vertical layout without adding dependency edges.
  const orderNodes = (nodeIds: string[]): void => {
    for (let index = 1; index < nodeIds.length; index++) {
      lines.push(`    ${nodeIds[index - 1]} ~~~ ${nodeIds[index]}`);
    }
  };

  // Group by categories
  if (deps.categories.length > 0) {
    const usedIds = new Set(
      deps.categories
        .slice(0, 8)
        .flatMap((cat) => [
          cat.name.replace(/[^a-zA-Z0-9]/g, ""),
          ...cat.deps.slice(0, 5).map((dep) => dep.replace(/[^a-zA-Z0-9]/g, "_")),
          `${cat.name.replace(/[^a-zA-Z0-9]/g, "")}_more`,
        ])
    );
    usedIds.add(projectName);
    let collectionId = "DependencyCategories";
    while (usedIds.has(collectionId)) collectionId += "_";
    lines.push(`  subgraph ${collectionId}["Dependency Categories"]`, "    direction TB");
    let previousCategory: string | undefined;
    for (const cat of deps.categories.slice(0, 8)) {
      // Top 8 categories
      const safeName = cat.name.replace(/[^a-zA-Z0-9]/g, "");
      lines.push(`  subgraph ${safeName}["${cat.name}"]`, "    direction TB");
      const nodeIds: string[] = [];

      // Show up to 5 deps per category
      for (const dep of cat.deps.slice(0, 5)) {
        const safeDepName = dep.replace(/[^a-zA-Z0-9]/g, "_");
        lines.push(`    ${safeDepName}["${dep}"]`);
        nodeIds.push(safeDepName);
      }
      if (cat.deps.length > 5) {
        lines.push(`    ${safeName}_more["+${cat.deps.length - 5} more"]`);
        nodeIds.push(`${safeName}_more`);
      }
      orderNodes(nodeIds);
      lines.push("  end");
      if (previousCategory) lines.push(`  ${previousCategory} ~~~ ${safeName}`);
      previousCategory = safeName;
      lines.push("");
    }
    lines.push("  end");
    lines.push(`  APP --> ${collectionId}`);
  } else {
    // Shared legacy IDs can occur across runtime/dev/build declarations. Adding
    // ordering links to those records creates layout cycles and overlapping
    // groups, so retain their existing unlinked layout without renaming nodes.
    const displayedIds = [
      ...deps.runtime.slice(0, 10).map((dep) => dep.name.replace(/[^a-zA-Z0-9]/g, "_")),
      ...(deps.runtime.length > 10 ? ["runtime_more"] : []),
      ...deps.dev.slice(0, 8).map((dep) => dep.name.replace(/[^a-zA-Z0-9]/g, "_")),
      ...(deps.dev.length > 8 ? ["dev_more"] : []),
    ];
    const canOrderFallback = new Set(displayedIds).size === displayedIds.length;
    // Fallback: show top runtime dependencies
    lines.push('  subgraph Runtime["Runtime Dependencies"]', "    direction TB");
    const runtimeIds: string[] = [];
    for (const dep of deps.runtime.slice(0, 10)) {
      const safeDepName = dep.name.replace(/[^a-zA-Z0-9]/g, "_");
      lines.push(`    ${safeDepName}["${dep.name}"]`);
      runtimeIds.push(safeDepName);
    }
    if (deps.runtime.length > 10) {
      lines.push(`    runtime_more["+${deps.runtime.length - 10} more"]`);
      runtimeIds.push("runtime_more");
    }
    if (canOrderFallback) orderNodes(runtimeIds);
    lines.push("  end");
    lines.push("  APP --> Runtime");
    lines.push("");

    if (deps.dev.length > 0) {
      lines.push('  subgraph Dev["Dev Dependencies"]', "    direction TB");
      const devIds: string[] = [];
      for (const dep of deps.dev.slice(0, 8)) {
        const safeDepName = dep.name.replace(/[^a-zA-Z0-9]/g, "_");
        lines.push(`    ${safeDepName}["${dep.name}"]`);
        devIds.push(safeDepName);
      }
      if (deps.dev.length > 8) {
        lines.push(`    dev_more["+${deps.dev.length - 8} more"]`);
        devIds.push("dev_more");
      }
      if (canOrderFallback) orderNodes(devIds);
      lines.push("  end");
      lines.push("  APP -.-> Dev");
      if (canOrderFallback) lines.push("  Runtime ~~~ Dev");
    }
  }

  return lines.join("\n");
}

/**
 * Generate markdown documentation for dependencies
 */
/** Keep manifest text inside one Markdown table cell. */
function dependencyTableCell(value: string): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}

/** Literal code spans cannot reinterpret declaration data as links/emphasis. */
function literalDependencyCell(value: string): string {
  if (!value) return "";
  let width = 1;
  for (const run of value.matchAll(/`+/g)) width = Math.max(width, run[0].length + 1);
  const fence = "`".repeat(width);
  // All-space code payloads retain Markdown padding; omit it in that case.
  if (/^ +$/.test(value)) return `${fence}${value}${fence}`;
  return `${fence} ${value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ")} ${fence}`;
}

export function generateDependencyDocs(deps: DependencyAnalysis, projectName: string): string {
  const lines: string[] = [];
  const mixed = (deps.packageManagers?.length ?? 0) > 1;
  const declaration = (dep: Dependency): string | undefined =>
    dep.description?.startsWith(POETRY_METADATA_PREFIX)
      ? dep.description.slice(POETRY_METADATA_PREFIX.length)
      : undefined;
  const versionCell = (dep: Dependency): string => {
    const value = String(dep.version);
    // Declaration metadata is data, even when a local filename contains inline
    // syntax. Plain legacy cells keep their existing Markdown representation.
    if (!isWellFormedSourceText(value)) return sourcePathCode(value, true);
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (code < 32 || code === 127) return sourcePathCode(value, true);
    }
    if (declaration(dep) !== undefined) return literalDependencyCell(value);
    if (value.trim() !== value) return sourcePathCode(value, true);
    if (
      ["`", "_", "[", "]", "\\", "&"].some((token) => value.includes(token)) ||
      value.includes("~~") ||
      /<(?:[A-Za-z!/?]|[^<> \t\r\n]*@)/.test(value) ||
      /\*[\s\S]+\*/.test(value)
    )
      return sourcePathCode(value, true);
    return dependencyTableCell(value);
  };
  const provenance = (dep: Dependency): string =>
    mixed
      ? ` | ${dependencyTableCell(dep.ecosystem ?? "")} | ${dependencyTableCell(dep.sourceFile ?? "")}`
      : "";

  lines.push("# Dependency Overview");
  lines.push("");
  lines.push(
    `This document provides an overview of the ${deps.totalCount} dependencies used in ${projectName}.`
  );
  lines.push("");

  if (mixed) {
    lines.push(`Package managers: ${deps.packageManagers!.join(", ")}.`);
    lines.push("");
  }

  // Summary table
  lines.push("## Summary");
  lines.push("");
  lines.push("| Type | Count |");
  lines.push("|------|-------|");
  lines.push(`| Runtime | ${deps.runtime.length} |`);
  lines.push(`| Development | ${deps.dev.length} |`);
  if (deps.peer.length > 0) {
    lines.push(`| Peer | ${deps.peer.length} |`);
  }
  lines.push(`| **Total** | **${deps.totalCount}** |`);
  lines.push("");

  // Dependency graph
  lines.push("## Dependency Graph");
  lines.push("");
  lines.push("```mermaid");
  lines.push(generateDependencyDiagram(deps, projectName));
  lines.push("```");
  lines.push("");

  // Categories breakdown
  if (deps.categories.length > 0) {
    lines.push("## By Category");
    lines.push("");
    for (const cat of deps.categories) {
      lines.push(`### ${cat.name}`);
      lines.push("");
      lines.push(cat.deps.map((d) => `- \`${d}\``).join("\n"));
      lines.push("");
    }
  }

  // Full runtime dependencies
  lines.push("## Runtime Dependencies");
  lines.push("");
  if (deps.runtime.length > 0) {
    lines.push(mixed ? "| Package | Version | Ecosystem | Manifest |" : "| Package | Version |");
    lines.push(mixed ? "|---------|---------|-----------|----------|" : "|---------|---------|");
    for (const dep of deps.runtime.slice(0, 50)) {
      lines.push(`| ${dependencyTableCell(dep.name)} | ${versionCell(dep)}${provenance(dep)} |`);
    }
    if (deps.runtime.length > 50) {
      lines.push(`| ... | +${deps.runtime.length - 50} more${mixed ? " | |" : ""} |`);
    }
  } else {
    lines.push("No runtime dependencies found.");
  }
  lines.push("");

  // Dev dependencies
  lines.push("## Development Dependencies");
  lines.push("");
  if (deps.dev.length > 0) {
    lines.push(mixed ? "| Package | Version | Ecosystem | Manifest |" : "| Package | Version |");
    lines.push(mixed ? "|---------|---------|-----------|----------|" : "|---------|---------|");
    for (const dep of deps.dev.slice(0, 30)) {
      lines.push(`| ${dependencyTableCell(dep.name)} | ${versionCell(dep)}${provenance(dep)} |`);
    }
    if (deps.dev.length > 30) {
      lines.push(`| ... | +${deps.dev.length - 30} more${mixed ? " | |" : ""} |`);
    }
  } else {
    lines.push("No development dependencies found.");
  }
  lines.push("");

  if (mixed && deps.peer.length) {
    lines.push(
      "## Peer Dependencies",
      "",
      "| Package | Version | Ecosystem | Manifest |",
      "|---------|---------|-----------|----------|"
    );
    for (const dep of deps.peer.slice(0, 30)) {
      lines.push(`| ${dependencyTableCell(dep.name)} | ${versionCell(dep)}${provenance(dep)} |`);
    }
    if (deps.peer.length > 30) lines.push(`| ... | +${deps.peer.length - 30} more | | |`);
    lines.push("");
  }

  const described = [
    ...deps.runtime.slice(0, 50),
    ...deps.dev.slice(0, 30),
    ...deps.peer.slice(0, 20),
  ].filter((dep) => declaration(dep) !== undefined);
  if (described.length) {
    lines.push("## Declared Poetry metadata", "");
    lines.push(
      "These are complete declared values, not resolved versions. A * version means no version constraint is declared; source, path, Git and marker restrictions remain in the metadata below. Ordered alternatives are descriptive and no branch is selected.",
      ""
    );
    lines.push(
      mixed
        ? "| Dependency | Kind | Declaration | Ecosystem | Manifest |"
        : "| Dependency | Kind | Declaration |"
    );
    lines.push(
      mixed
        ? "|------------|------|-------------|-----------|----------|"
        : "|------------|------|-------------|"
    );
    for (const dep of described) {
      lines.push(
        `| ${literalDependencyCell(dep.name)} | ${dep.type} | ${literalDependencyCell(declaration(dep)!)}${provenance(dep)} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
