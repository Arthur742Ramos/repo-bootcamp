/**
 * Dependency Analysis Module
 * Extracts and visualizes dependencies from various package managers
 */

import { readFile } from "fs/promises";
import { join } from "path";
import categoryPatternsJson from "./data/category-patterns.json" with { type: "json" };

/**
 * Dependency information
 */
export interface Dependency {
  name: string;
  version: string;
  type: "runtime" | "dev" | "peer" | "optional";
  description?: string;
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
    (patterns as string[]).map(p => new RegExp(p)),
  ])
);

/**
 * Categorize a dependency based on its name
 */
function categorizeDependency(name: string): string | null {
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (patterns.some(p => p.test(name))) {
      return category;
    }
  }
  return null;
}

/**
 * Extract a version string from a TOML dependency value, which may be a quoted
 * scalar (`"1.0"`) or an inline table (`{ version = "1.0", features = [...] }`).
 */
function parseTomlVersion(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) {
    const inline = /version\s*=\s*["']([^"']+)["']/.exec(trimmed);
    return inline ? inline[1] : "*";
  }
  const quoted = /^["']([^"']+)["']/.exec(trimmed);
  if (quoted) return quoted[1];
  const token = trimmed.split(/[\s,]/)[0];
  return token || "*";
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
    // Keyed `${section}:${name}` so a `[dependencies.<crate>]` table can fill in
    // the version recorded by its header without creating a duplicate entry.
    const seen = new Map<string, Dependency>();

    const record = (
      section: "dependencies" | "dev-dependencies",
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
        type: section === "dev-dependencies" ? "dev" : "runtime",
      };
      seen.set(key, dep);
      (section === "dev-dependencies" ? dev : runtime).push(dep);
    };

    let section: "dependencies" | "dev-dependencies" | "" = "";
    let tableCrate: string | null = null;

    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;

      const header = /^\[+([^\]]+)\]+$/.exec(line);
      if (header) {
        tableCrate = null;
        const sub = /^(dependencies|dev-dependencies)(?:\.(.+))?$/.exec(header[1].trim());
        if (sub) {
          section = sub[1] as "dependencies" | "dev-dependencies";
          if (sub[2]) {
            // `[dependencies.<crate>]` detailed table — record the crate now;
            // its version arrives on a later `version = "..."` line.
            tableCrate = sub[2];
            record(section, tableCrate, "*");
          }
        } else {
          // Any other table (`[features]`, `[profile.release]`, `[[bin]]`, …)
          // clears state so its keys are not parsed as dependencies.
          section = "";
        }
        continue;
      }

      if (!section) continue;

      const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
      if (!kv) continue;

      if (tableCrate) {
        if (kv[1] === "version") {
          const v = /["']([^"']+)["']/.exec(kv[2]);
          record(section, tableCrate, v ? v[1] : "*");
        }
        continue;
      }

      record(section, kv[1], parseTomlVersion(kv[2]));
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
async function extractPythonDependencies(repoPath: string): Promise<DependencyAnalysis | null> {
  try {
    // Try pyproject.toml first
    let content: string;
    let packageManager = "poetry";

    try {
      content = await readFile(join(repoPath, "pyproject.toml"), "utf-8");
    } catch {
      // Fall back to requirements.txt
      try {
        content = await readFile(join(repoPath, "requirements.txt"), "utf-8");
        packageManager = "pip";
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
        const cleaned = trimmed.split(/\s+#/)[0].split(";")[0].trim();
        const match = cleaned.match(/^([A-Za-z0-9._-]+)(?:\[[^\]]*\])?\s*[=<>!~]*\s*(.*)$/);
        if (match) {
          const version = (match[2] || "").trim();
          runtime.push({ name: match[1], version: version || "*", type: "runtime" });
        }
      }
    } else {
      // Parse pyproject.toml. We split the file into TOML sections keyed by
      // their table header so each section's body ends cleanly at the next
      // `[header]` line (values like `extras = ["d"]` contain mid-line brackets
      // that naive regexes terminate on).
      const sections = new Map<string, string>();
      let currentHeader = "";
      let currentLines: string[] = [];
      const flush = (): void => {
        if (currentHeader) sections.set(currentHeader, currentLines.join("\n"));
      };
      for (const line of content.split("\n")) {
        const header = line.trim().match(/^\[\[?([^\]]+)\]\]?\s*$/);
        if (header) {
          flush();
          currentHeader = header[1].trim();
          currentLines = [];
        } else {
          currentLines.push(line);
        }
      }
      flush();

      // `key = value` TOML tables (legacy Poetry + dependency groups).
      const parseTable = (body: string, type: "runtime" | "dev", target: Dependency[]): void => {
        for (const line of body.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const match = trimmed.match(/^([A-Za-z0-9._-]+)\s*=\s*(.+)$/);
          if (!match) continue;
          if (type === "runtime" && match[1] === "python") continue;
          if (!target.some((d) => d.name === match[1])) {
            target.push({ name: match[1], version: parseTomlVersion(match[2]), type });
          }
        }
      };

      // PEP 508 array-of-strings (`["flask>=2.0", "requests[security]>=2.28"]`).
      // Strips extras and environment markers, mirroring requirements.txt.
      const parseRequirementArray = (body: string, type: "runtime" | "dev", target: Dependency[]): void => {
        for (const rawItem of body.split(",")) {
          const item = rawItem.replace(/["'\n\r]/g, "").trim();
          if (!item || item.startsWith("#")) continue;
          const cleaned = item.split(";")[0].trim();
          const match = cleaned.match(/^([A-Za-z0-9._-]+)(?:\[[^\]]*\])?\s*(.*)$/);
          if (!match) continue;
          const version = (match[2] || "").trim();
          if (!target.some((d) => d.name === match[1])) {
            target.push({ name: match[1], version: version || "*", type });
          }
        }
      };

      // Return each top-level `[ ... ]` array body in a section, bracket-balanced
      // so nested brackets (PEP 508 extras like `requests[security]`) don't
      // terminate extraction early.
      const arrayBodies = (body: string): string[] => {
        const out: string[] = [];
        for (let i = 0; i < body.length; i++) {
          if (body[i] !== "[") continue;
          let depth = 1;
          let j = i + 1;
          for (; j < body.length && depth > 0; j++) {
            if (body[j] === "[") depth++;
            else if (body[j] === "]") depth--;
          }
          out.push(body.slice(i + 1, j - 1));
          i = j - 1;
        }
        return out;
      };

      // Legacy Poetry (`[tool.poetry.dependencies]` / `dev-dependencies`).
      if (sections.has("tool.poetry.dependencies")) {
        parseTable(sections.get("tool.poetry.dependencies")!, "runtime", runtime);
      }
      if (sections.has("tool.poetry.dev-dependencies")) {
        parseTable(sections.get("tool.poetry.dev-dependencies")!, "dev", dev);
      }

      // Poetry 1.2+ dependency groups: `[tool.poetry.group.<name>.dependencies]`.
      // `dev`/`test` groups → dev; everything else → runtime.
      for (const [header, body] of sections) {
        const groupMatch = header.match(/^tool\.poetry\.group\.([A-Za-z0-9._-]+)\.dependencies$/);
        if (!groupMatch) continue;
        const groupName = groupMatch[1].toLowerCase();
        const isDev = groupName === "dev" || groupName === "test";
        parseTable(body, isDev ? "dev" : "runtime", isDev ? dev : runtime);
      }

      // PEP 621 `[project]` (uv, hatch, pdm, setuptools, modern Poetry): the
      // `dependencies = [...]` array. The first balanced array in the section
      // body is the dependencies list.
      if (sections.has("project")) {
        const projectBody = sections.get("project")!;
        const depsArray = projectBody.match(/dependencies\s*=\s*\[/);
        if (depsArray) {
          const tail = projectBody.slice(depsArray.index! + depsArray[0].length - 1);
          parseRequirementArray(arrayBodies(tail)[0] ?? "", "runtime", runtime);
        }
      }

      // PEP 621 optional dependencies: each extra is its own array. Treated as
      // runtime (installable features, not dev tooling).
      if (sections.has("project.optional-dependencies")) {
        for (const arr of arrayBodies(sections.get("project.optional-dependencies")!)) {
          parseRequirementArray(arr, "runtime", runtime);
        }
      }

      // PEP 735 dependency groups: `[dependency-groups]` (dev tooling).
      if (sections.has("dependency-groups")) {
        for (const arr of arrayBodies(sections.get("dependency-groups")!)) {
          parseRequirementArray(arr, "dev", dev);
        }
      }

      // Prefer a more specific package-manager label when detectable.
      if ([...sections.keys()].some((h) => h.startsWith("tool.poetry"))) {
        packageManager = "poetry";
      } else if (sections.has("project") || sections.has("dependency-groups")) {
        packageManager = "pip";
      }
    }

    if (runtime.length === 0 && dev.length === 0) return null;

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

    // Iterate every `require ( ... )` block — gofmt emits separate blocks for
    // direct and `// indirect` requirements.
    for (const block of content.matchAll(/require\s*\(([\s\S]*?)\)/g)) {
      for (const line of block[1].split("\n")) {
        const match = line.trim().match(/^([^\s]+)\s+(v[^\s]+)/);
        if (match) add(match[1], match[2]);
      }
    }

    // Single-line requires (`require x v1.2.3`).
    for (const match of content.matchAll(/^require\s+([^\s]+)\s+(v[^\s]+)/gm)) {
      add(match[1], match[2]);
    }

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
  // Try each package manager in order
  const extractors = [
    extractNpmDependencies,
    extractCargoDependencies,
    extractPythonDependencies,
    extractGoDependencies,
  ];

  for (const extractor of extractors) {
    const result = await extractor(repoPath);
    if (result) return result;
  }

  return null;
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

  // Group by categories
  if (deps.categories.length > 0) {
    for (const cat of deps.categories.slice(0, 8)) { // Top 8 categories
      const safeName = cat.name.replace(/[^a-zA-Z0-9]/g, "");
      lines.push(`  subgraph ${safeName}["${cat.name}"]`);
      
      // Show up to 5 deps per category
      for (const dep of cat.deps.slice(0, 5)) {
        const safeDepName = dep.replace(/[^a-zA-Z0-9]/g, "_");
        lines.push(`    ${safeDepName}["${dep}"]`);
      }
      if (cat.deps.length > 5) {
        lines.push(`    ${safeName}_more["+${cat.deps.length - 5} more"]`);
      }
      lines.push("  end");
      lines.push(`  APP --> ${safeName}`);
      lines.push("");
    }
  } else {
    // Fallback: show top runtime dependencies
    lines.push("  subgraph Runtime[\"Runtime Dependencies\"]");
    for (const dep of deps.runtime.slice(0, 10)) {
      const safeDepName = dep.name.replace(/[^a-zA-Z0-9]/g, "_");
      lines.push(`    ${safeDepName}["${dep.name}"]`);
    }
    if (deps.runtime.length > 10) {
      lines.push(`    runtime_more["+${deps.runtime.length - 10} more"]`);
    }
    lines.push("  end");
    lines.push("  APP --> Runtime");
    lines.push("");

    if (deps.dev.length > 0) {
      lines.push("  subgraph Dev[\"Dev Dependencies\"]");
      for (const dep of deps.dev.slice(0, 8)) {
        const safeDepName = dep.name.replace(/[^a-zA-Z0-9]/g, "_");
        lines.push(`    ${safeDepName}["${dep.name}"]`);
      }
      if (deps.dev.length > 8) {
        lines.push(`    dev_more["+${deps.dev.length - 8} more"]`);
      }
      lines.push("  end");
      lines.push("  APP -.-> Dev");
    }
  }

  return lines.join("\n");
}

/**
 * Generate markdown documentation for dependencies
 */
export function generateDependencyDocs(deps: DependencyAnalysis, projectName: string): string {
  const lines: string[] = [];

  lines.push("# Dependency Overview");
  lines.push("");
  lines.push(`This document provides an overview of the ${deps.totalCount} dependencies used in ${projectName}.`);
  lines.push("");

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
      lines.push(cat.deps.map(d => `- \`${d}\``).join("\n"));
      lines.push("");
    }
  }

  // Full runtime dependencies
  lines.push("## Runtime Dependencies");
  lines.push("");
  if (deps.runtime.length > 0) {
    lines.push("| Package | Version |");
    lines.push("|---------|---------|");
    for (const dep of deps.runtime.slice(0, 50)) {
      lines.push(`| ${dep.name} | ${dep.version} |`);
    }
    if (deps.runtime.length > 50) {
      lines.push(`| ... | +${deps.runtime.length - 50} more |`);
    }
  } else {
    lines.push("No runtime dependencies found.");
  }
  lines.push("");

  // Dev dependencies
  lines.push("## Development Dependencies");
  lines.push("");
  if (deps.dev.length > 0) {
    lines.push("| Package | Version |");
    lines.push("|---------|---------|");
    for (const dep of deps.dev.slice(0, 30)) {
      lines.push(`| ${dep.name} | ${dep.version} |`);
    }
    if (deps.dev.length > 30) {
      lines.push(`| ... | +${deps.dev.length - 30} more |`);
    }
  } else {
    lines.push("No development dependencies found.");
  }
  lines.push("");

  return lines.join("\n");
}
