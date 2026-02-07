/**
 * Change Impact Map Module
 * Analyzes import graphs to determine affected files when changes are made
 */

import { readFile } from "fs/promises";
import { join, dirname, basename, relative } from "path";
import type { FileInfo, ChangeImpact } from "./types.js";
import importPatternsJson from "./data/import-patterns.json" with { type: "json" };

/**
 * Import pattern matchers for different languages (loaded from JSON, compiled to RegExp)
 */
const IMPORT_PATTERNS: Record<string, RegExp[]> = Object.fromEntries(
  Object.entries(importPatternsJson.importPatterns).map(([lang, patterns]) => [
    lang,
    (patterns as string[]).map(p => {
      const isMultiline = lang === "python";
      return new RegExp(p, isMultiline ? "gm" : "g");
    }),
  ])
);

/**
 * File extension to language mapping
 */
const EXT_TO_LANG: Record<string, string> = importPatternsJson.extToLang;

/**
 * Extract imports from a file
 */
function extractImports(content: string, filePath: string): string[] {
  const ext = "." + filePath.split(".").pop();
  const lang = EXT_TO_LANG[ext];
  if (!lang) return [];

  const patterns = IMPORT_PATTERNS[lang];
  if (!patterns) return [];

  const imports: string[] = [];

  for (const pattern of patterns) {
    // Reset regex state
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1]) {
        imports.push(match[1]);
      }
    }
  }

  return imports;
}

/**
 * Resolve a relative import to an absolute path
 */
function resolveImport(
  importPath: string,
  fromFile: string,
  files: FileInfo[]
): string | null {
  // Skip external packages
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    return null;
  }

  const fromDir = dirname(fromFile);
  let resolved = join(fromDir, importPath);

  // Normalize path
  resolved = resolved.replace(/\\/g, "/");

  // Try exact match first
  if (files.some(f => f.path === resolved)) {
    return resolved;
  }

  // Try adding extensions
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go"];
  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (files.some(f => f.path === withExt)) {
      return withExt;
    }
  }

  // Try index files
  for (const ext of extensions) {
    const indexPath = join(resolved, `index${ext}`);
    if (files.some(f => f.path === indexPath)) {
      return indexPath;
    }
  }

  return null;
}

/**
 * Build import graph for the repository
 */
export async function buildImportGraph(
  repoPath: string,
  files: FileInfo[]
): Promise<Map<string, { imports: string[]; importedBy: string[] }>> {
  const graph = new Map<string, { imports: string[]; importedBy: string[] }>();

  // Initialize all files
  for (const file of files) {
    if (!file.isDirectory) {
      graph.set(file.path, { imports: [], importedBy: [] });
    }
  }

  // Parse source files
  const sourceFiles = files.filter(f => 
    !f.isDirectory &&
    /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(f.path) &&
    !f.path.includes("node_modules") &&
    f.size < 100000
  );

  for (const file of sourceFiles) {
    try {
      const content = await readFile(join(repoPath, file.path), "utf-8");
      const imports = extractImports(content, file.path);

      const resolvedImports: string[] = [];
      for (const imp of imports) {
        const resolved = resolveImport(imp, file.path, files);
        if (resolved) {
          resolvedImports.push(resolved);
          
          // Update importedBy for the target
          const targetNode = graph.get(resolved);
          if (targetNode && !targetNode.importedBy.includes(file.path)) {
            targetNode.importedBy.push(file.path);
          }
        }
      }

      const node = graph.get(file.path);
      if (node) {
        node.imports = resolvedImports;
      }
    } catch {
      // Skip unreadable files
    }
  }

  return graph;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find tests related to a file
 */
function findRelatedTests(filePath: string, files: FileInfo[]): string[] {
  const fileName = escapeRegex(basename(filePath).replace(/\.[^.]+$/, ""));
  const fileDir = escapeRegex(dirname(filePath));

  const testPatterns = [
    // Same directory with .test/.spec suffix
    new RegExp(`^${fileDir}/${fileName}\\.(test|spec)\\.[^.]+$`),
    // __tests__ directory
    new RegExp(`^${fileDir}/__tests__/${fileName}\\.[^.]+$`),
    // test directory at root
    new RegExp(`^test/.*${fileName}.*\\.[^.]+$`),
    new RegExp(`^tests/.*${fileName}.*\\.[^.]+$`),
  ];

  return files
    .filter(f => !f.isDirectory && testPatterns.some(p => p.test(f.path)))
    .map(f => f.path);
}

/**
 * Find docs related to a file
 */
function findRelatedDocs(filePath: string, files: FileInfo[]): string[] {
  const fileName = basename(filePath).replace(/\.[^.]+$/, "");
  const fileDir = dirname(filePath);

  // Look for markdown files that might reference this file
  const docFiles = files.filter(f => 
    !f.isDirectory && 
    /\.(md|mdx|rst|txt)$/.test(f.path) &&
    !f.path.includes("node_modules")
  );

  // Simple heuristic: docs in same directory or docs/ folder with similar names
  return docFiles
    .filter(f => {
      const docDir = dirname(f.path);
      const docName = basename(f.path).toLowerCase();
      return (
        docDir === fileDir ||
        docDir.includes("docs") ||
        docName.includes(fileName.toLowerCase())
      );
    })
    .map(f => f.path)
    .slice(0, 5); // Limit to 5
}

/**
 * Analyze impact of changing a specific file
 */
export async function analyzeChangeImpact(
  repoPath: string,
  files: FileInfo[],
  targetFile: string,
  graph?: Map<string, { imports: string[]; importedBy: string[] }>
): Promise<ChangeImpact> {
  // Build graph if not provided
  const importGraph = graph || await buildImportGraph(repoPath, files);

  const node = importGraph.get(targetFile);
  const imports = node?.imports || [];
  const importedBy = node?.importedBy || [];

  // Find transitively affected files (1 level deep)
  const affectedFiles = new Set<string>();
  for (const file of importedBy) {
    affectedFiles.add(file);
    const fileNode = importGraph.get(file);
    if (fileNode) {
      for (const transitive of fileNode.importedBy) {
        affectedFiles.add(transitive);
      }
    }
  }

  // Find related tests
  const affectedTests = findRelatedTests(targetFile, files);
  
  // Also find tests for affected files
  for (const affected of affectedFiles) {
    const tests = findRelatedTests(affected, files);
    for (const test of tests) {
      if (!affectedTests.includes(test)) {
        affectedTests.push(test);
      }
    }
  }

  // Find related docs
  const affectedDocs = findRelatedDocs(targetFile, files);

  return {
    file: targetFile,
    affectedFiles: Array.from(affectedFiles),
    affectedTests,
    affectedDocs,
    importedBy,
    imports,
  };
}

/**
 * Generate IMPACT.md documentation
 */
export function generateImpactDocs(
  impacts: ChangeImpact[],
  projectName: string
): string {
  const lines: string[] = [];

  lines.push("# Change Impact Analysis");
  lines.push("");
  lines.push(`Impact analysis for **${projectName}**.`);
  lines.push("");
  lines.push("This document shows how changes to key files would affect other parts of the codebase.");
  lines.push("");

  for (const impact of impacts) {
    lines.push(`## \`${impact.file}\``);
    lines.push("");

    // Imports
    if (impact.imports.length > 0) {
      lines.push("**Imports:**");
      for (const imp of impact.imports.slice(0, 10)) {
        lines.push(`- \`${imp}\``);
      }
      if (impact.imports.length > 10) {
        lines.push(`- ... and ${impact.imports.length - 10} more`);
      }
      lines.push("");
    }

    // Imported by
    if (impact.importedBy.length > 0) {
      lines.push("**Imported by:**");
      for (const imp of impact.importedBy.slice(0, 10)) {
        lines.push(`- \`${imp}\``);
      }
      if (impact.importedBy.length > 10) {
        lines.push(`- ... and ${impact.importedBy.length - 10} more`);
      }
      lines.push("");
    }

    // Affected files
    if (impact.affectedFiles.length > 0) {
      lines.push("**Potentially affected files:**");
      for (const file of impact.affectedFiles.slice(0, 10)) {
        lines.push(`- \`${file}\``);
      }
      if (impact.affectedFiles.length > 10) {
        lines.push(`- ... and ${impact.affectedFiles.length - 10} more`);
      }
      lines.push("");
    }

    // Tests
    if (impact.affectedTests.length > 0) {
      lines.push("**Tests to run:**");
      for (const test of impact.affectedTests) {
        lines.push(`- \`${test}\``);
      }
      lines.push("");
    }

    // Docs
    if (impact.affectedDocs.length > 0) {
      lines.push("**Related documentation:**");
      for (const doc of impact.affectedDocs) {
        lines.push(`- \`${doc}\``);
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get top entry points for impact analysis
 */
export function getKeyFilesForImpact(files: FileInfo[]): string[] {
  const keyPatterns = [
    /^src\/index\.(ts|js|tsx|jsx)$/,
    /^source\/index\.(ts|js|tsx|jsx)$/,
    /^src\/main\.(ts|js)$/,
    /^source\/main\.(ts|js)$/,
    /^src\/app\.(ts|js|tsx|jsx)$/,
    /^src\/server\.(ts|js)$/,
    /^src\/cli\.(ts|js)$/,
    /^index\.(ts|js)$/,
    /^src\/[^/]+\.(ts|js)$/, // Top-level src files
    /^source\/[^/]+\.(ts|js)$/, // Top-level source files
    /^lib\/[^/]+\.(ts|js)$/, // Top-level lib files
  ];

  const keyFiles: string[] = [];

  for (const pattern of keyPatterns) {
    for (const file of files) {
      if (!file.isDirectory && pattern.test(file.path) && !keyFiles.includes(file.path)) {
        keyFiles.push(file.path);
        if (keyFiles.length >= 10) break;
      }
    }
    if (keyFiles.length >= 10) break;
  }

  return keyFiles;
}
