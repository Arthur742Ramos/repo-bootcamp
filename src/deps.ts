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

    // Simple TOML parsing for dependencies
    const sections = content.split(/\[([^\]]+)\]/);
    let currentSection = "";

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i].trim();
      if (section === "dependencies" || section === "dev-dependencies") {
        currentSection = section;
        continue;
      }

      if (currentSection && i % 2 === 0) {
        const lines = section.split("\n");
        for (const line of lines) {
          const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*["']?([^"'\s]+)/);
          if (match) {
            const dep: Dependency = {
              name: match[1],
              version: match[2],
              type: currentSection === "dev-dependencies" ? "dev" : "runtime",
            };
            if (currentSection === "dev-dependencies") {
              dev.push(dep);
            } else {
              runtime.push(dep);
            }
          }
        }
      }
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
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)([=<>!]+)?(.+)?/);
        if (match) {
          runtime.push({
            name: match[1],
            version: match[3] || "*",
            type: "runtime",
          });
        }
      }
    } else {
      // Parse pyproject.toml (simplified)
      const depsMatch = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\[|$)/);
      if (depsMatch) {
        const lines = depsMatch[1].split("\n");
        for (const line of lines) {
          const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*["']?([^"'\n]+)/);
          if (match && match[1] !== "python") {
            runtime.push({
              name: match[1],
              version: match[2],
              type: "runtime",
            });
          }
        }
      }

      const devDepsMatch = content.match(/\[tool\.poetry\.dev-dependencies\]([\s\S]*?)(?:\[|$)/);
      if (devDepsMatch) {
        const lines = devDepsMatch[1].split("\n");
        for (const line of lines) {
          const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*["']?([^"'\n]+)/);
          if (match) {
            dev.push({
              name: match[1],
              version: match[2],
              type: "dev",
            });
          }
        }
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
    const requireMatch = content.match(/require\s*\(([\s\S]*?)\)/);

    if (requireMatch) {
      const lines = requireMatch[1].split("\n");
      for (const line of lines) {
        const match = line.trim().match(/^([^\s]+)\s+(v[^\s]+)/);
        if (match) {
          runtime.push({
            name: match[1],
            version: match[2],
            type: "runtime",
          });
        }
      }
    }

    // Also check for single-line requires
    const singleRequires = content.matchAll(/^require\s+([^\s]+)\s+(v[^\s]+)/gm);
    for (const match of singleRequires) {
      runtime.push({
        name: match[1],
        version: match[2],
        type: "runtime",
      });
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
