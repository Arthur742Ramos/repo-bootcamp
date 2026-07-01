/**
 * Change Impact Map Module
 * Analyzes import graphs to determine affected files when changes are made
 */

import { readFile } from "fs/promises";
import { join, dirname, basename } from "path";
import { readContainedFile } from "./ingest.js";
import type { FileInfo, ChangeImpact } from "./types.js";
import type { CyclesSummary } from "./cycles.js";
import { escapeRegex } from "./utils.js";
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

  // Go imports are parsed structurally (single + grouped block forms) so every
  // path in a `import ( ... )` block is captured, not just the last one.
  if (lang === "go") return extractGoImports(content);

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
 * Extract import paths from a Go source file. Handles the single form
 * (`import "path"`, `import alias "path"`, `import _ "path"`) and the grouped
 * block (`import (\n  "a"\n  "b"\n)`). Parsing the block line-by-line avoids the
 * last-import-only limitation of a single grouped regex.
 */
function extractGoImports(content: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (inBlock) {
      if (line.startsWith(")")) {
        inBlock = false;
        continue;
      }
      const m = line.match(/^(?:[\w.]+\s+)?["`]([^"`]+)["`]/);
      if (m) out.push(m[1]);
      continue;
    }
    if (/^import\s*\(/.test(line)) {
      inBlock = true;
      continue;
    }
    const single = line.match(/^import\s+(?:[\w.]+\s+)?["`]([^"`]+)["`]/);
    if (single) out.push(single[1]);
  }
  return out;
}

/**
 * Project-level context needed to resolve non-relative imports: the flat scan
 * set, the Go module prefix + per-directory `.go` file index, the TypeScript
 * `baseUrl`/`paths` alias config, and the Python source roots to probe. Built
 * once per `buildImportGraph` call.
 */
interface GraphContext {
  filePathSet: Set<string>;
  /** `module` line of go.mod (e.g. `example.com/m`), or null. */
  goModulePrefix: string | null;
  /** Package directory (repo-relative, "." for root) → its `.go` files. */
  goDirFiles: Map<string, string[]>;
  /** tsconfig `baseUrl` as a repo-relative dir ("" = root), or null if unset. */
  tsBaseDir: string | null;
  /** tsconfig `paths` aliases, pre-split into prefix + targets. */
  tsPaths: Array<{ prefix: string; wildcard: boolean; targets: string[] }>;
  /** Python source roots to probe for absolute imports (repo root first). */
  pythonRoots: string[];
}

/**
 * Best-effort parse of JSON-with-comments (tsconfig.json is JSONC): tries strict
 * JSON first, then strips comments and trailing commas and retries. Returns null
 * when the text is absent or still unparseable.
 */
function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // fall through to lenient cleanup
  }
  try {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // Line comments, but keep the `//` in a `scheme://` inside a string.
      .replace(/(^|[^:])\/\/[^\n\r]*/g, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped) as unknown;
  } catch {
    return null;
  }
}

/** Normalize a repo-relative directory: leading "./" and "." → "" (repo root). */
function normalizeRepoDir(dir: string): string {
  return dir.replace(/\\/g, "/").replace(/^\.\/?/, "").replace(/\/+$/, "");
}

/** Join a repo-relative base dir with a repo-relative path (base "" = root). */
function joinRepo(base: string, rel: string): string {
  const cleaned = rel.replace(/^\.\//, "");
  return normalizeRepoDir(base ? `${base}/${cleaned}` : cleaned);
}

/**
 * Build the resolution context once: read go.mod (module prefix) and
 * tsconfig.json (baseUrl/paths), index Go files by directory, and infer Python
 * source roots from package layout.
 */
async function buildGraphContext(
  repoPath: string,
  files: FileInfo[],
  filePathSet: Set<string>
): Promise<GraphContext> {
  // --- Go: module prefix + per-directory .go file index ---
  let goModulePrefix: string | null = null;
  try {
    const goMod = await readContainedFile(repoPath, "go.mod");
    const m = /^module\s+(\S+)/m.exec(goMod);
    if (m) goModulePrefix = m[1];
  } catch {
    // no go.mod
  }
  const goDirFiles = new Map<string, string[]>();
  for (const f of files) {
    if (f.isDirectory || !f.path.endsWith(".go")) continue;
    const dir = dirname(f.path);
    const list = goDirFiles.get(dir);
    if (list) list.push(f.path);
    else goDirFiles.set(dir, [f.path]);
  }

  // --- TypeScript: baseUrl / paths from tsconfig.json ---
  let tsBaseDir: string | null = null;
  const tsPaths: GraphContext["tsPaths"] = [];
  try {
    const parsed = parseJsonc(await readContainedFile(repoPath, "tsconfig.json"));
    const co =
      parsed && typeof parsed === "object" && "compilerOptions" in parsed
        ? (parsed as { compilerOptions?: unknown }).compilerOptions
        : undefined;
    if (co && typeof co === "object") {
      const options = co as { baseUrl?: unknown; paths?: unknown };
      if (typeof options.baseUrl === "string") {
        tsBaseDir = normalizeRepoDir(options.baseUrl);
      }
      if (options.paths && typeof options.paths === "object") {
        // Modern TS allows `paths` without an explicit `baseUrl` (resolved
        // relative to tsconfig, i.e. the repo root here).
        if (tsBaseDir === null) tsBaseDir = "";
        for (const [key, value] of Object.entries(options.paths as Record<string, unknown>)) {
          if (!Array.isArray(value)) continue;
          const targets = value.filter((t): t is string => typeof t === "string");
          if (targets.length === 0) continue;
          const wildcard = key.includes("*");
          const prefix = wildcard ? key.slice(0, key.indexOf("*")) : key;
          tsPaths.push({ prefix, wildcard, targets });
        }
      }
    }
  } catch {
    // no tsconfig.json
  }

  // --- Python: source roots (repo root, then roots inferred from packages and
  // the common src/lib/app layouts). Repo root is probed first so existing
  // root-package resolutions keep their precedence. ---
  const packageDirs = new Set<string>();
  for (const f of files) {
    if (f.isDirectory) continue;
    if (f.path === "__init__.py") packageDirs.add(".");
    else if (f.path.endsWith("/__init__.py")) packageDirs.add(dirname(f.path));
  }
  const pythonRoots: string[] = [""];
  // A source root is the parent of a top-level package (a package whose parent
  // is not itself a package) — e.g. `src/pkg/__init__.py` implies root `src`.
  for (const pkg of packageDirs) {
    if (!packageDirs.has(dirname(pkg))) pythonRoots.push(normalizeRepoDir(dirname(pkg)));
  }
  pythonRoots.push("src", "lib", "app");
  const seenRoots = new Set<string>();
  const dedupedRoots: string[] = [];
  for (const r of pythonRoots) {
    if (seenRoots.has(r)) continue;
    seenRoots.add(r);
    dedupedRoots.push(r);
  }

  return { filePathSet, goModulePrefix, goDirFiles, tsBaseDir, tsPaths, pythonRoots: dedupedRoots };
}

/**
 * Probe a repo-relative base path against the scan set: exact match, then source
 * extensions, then the ESM `.js`→`.ts` rewrite, then index files. Shared by
 * relative and alias (tsconfig `paths`/`baseUrl`) resolution.
 */
function probeResolved(resolved: string, filePathSet: Set<string>): string | null {
  resolved = resolved.replace(/\\/g, "/");

  // Try exact match first
  if (filePathSet.has(resolved)) {
    return resolved;
  }

  // Try adding extensions
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go"];
  for (const ext of extensions) {
    if (filePathSet.has(resolved + ext)) {
      return resolved + ext;
    }
  }

  // ESM/TypeScript projects import the compiled `.js` (or `.mjs`/`.cjs`)
  // specifier even though the on-disk source is `.ts`/`.tsx` — e.g.
  // `import "./util.js"` resolves to `util.ts`. When the literal path didn't
  // match a real file, strip a JS-family extension and retry the source
  // extensions. (A real `.js` file is still preferred via the exact-match
  // check above.)
  const jsExtMatch = resolved.match(/\.(js|jsx|mjs|cjs)$/);
  if (jsExtMatch) {
    const base = resolved.slice(0, resolved.length - jsExtMatch[0].length);
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      if (filePathSet.has(base + ext)) {
        return base + ext;
      }
    }
  }

  // Try index files. Normalize separators: join() emits OS-native separators
  // (backslashes on Windows), but the file set is keyed on forward slashes.
  for (const ext of extensions) {
    const indexPath = join(resolved, `index${ext}`).replace(/\\/g, "/");
    if (filePathSet.has(indexPath)) {
      return indexPath;
    }
  }

  return null;
}

/** Resolve a filesystem-relative TS/JS import (`./x`, `../y`, `/abs`). */
function resolveRelativeImport(
  importPath: string,
  fromFile: string,
  filePathSet: Set<string>
): string | null {
  const resolved = join(dirname(fromFile), importPath).replace(/\\/g, "/");
  return probeResolved(resolved, filePathSet);
}

/**
 * Resolve a Python import (dotted module path). Relative imports
 * (`from .mod import x`, `from ..pkg.mod import x`) resolve against the importing
 * file's package; package-absolute imports (`from pkg.mod import x` /
 * `import pkg.mod`) are probed against each source root (repo root, then roots
 * inferred from package layout and the common `src`/`lib`/`app` dirs) so
 * src-layout projects resolve. Both forms probe `<module>.py` and
 * `<module>/__init__.py`.
 */
function resolvePythonImport(importPath: string, fromFile: string, ctx: GraphContext): string | null {
  const { filePathSet } = ctx;
  if (importPath.startsWith(".")) {
    const dots = (/^\.+/.exec(importPath) ?? [""])[0].length;
    const rest = importPath.slice(dots).replace(/\./g, "/");
    // 1 leading dot = current package; each extra dot = one parent up.
    let base = dirname(fromFile);
    for (let i = 1; i < dots; i++) base = dirname(base);
    let modulePath = rest ? join(base, rest) : base;
    modulePath = modulePath.replace(/\\/g, "/").replace(/^\.\//, "");
    for (const candidate of [`${modulePath}.py`, `${modulePath}/__init__.py`]) {
      if (filePathSet.has(candidate)) return candidate;
    }
    return null;
  }
  const modRel = importPath.replace(/\./g, "/");
  for (const root of ctx.pythonRoots) {
    const base = root ? `${root}/${modRel}` : modRel;
    for (const candidate of [`${base}.py`, `${base}/__init__.py`]) {
      if (filePathSet.has(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Resolve a Go import to the `.go` files of the target package directory. Go
 * imports are always module-absolute, so we strip the module prefix declared in
 * go.mod (`example.com/m/internal/x` → `internal/x`) and return every `.go` file
 * in that directory. External/stdlib imports (no module prefix) yield no edge.
 */
function resolveGoImport(importPath: string, fromFile: string, ctx: GraphContext): string[] {
  if (importPath.startsWith(".")) {
    // Legacy relative import (rare) — resolve against the filesystem.
    const rel = resolveRelativeImport(importPath, fromFile, ctx.filePathSet);
    return rel ? [rel] : [];
  }
  const prefix = ctx.goModulePrefix;
  if (!prefix) return [];
  let rel: string;
  if (importPath === prefix) rel = "";
  else if (importPath.startsWith(prefix + "/")) rel = importPath.slice(prefix.length + 1);
  else return [];
  const files = ctx.goDirFiles.get(rel === "" ? "." : rel) ?? [];
  // A package never imports its own directory; guard against a self-edge.
  return files.filter((f) => f !== fromFile);
}

/**
 * Resolve a bare TS/JS specifier through tsconfig `paths` aliases (e.g.
 * `@/lib/db`) and then `baseUrl` (e.g. `components/Button`). Only matches that
 * land on a real file in the scan set are returned, so genuine external packages
 * still produce no edge.
 */
function resolveTsAliasImport(spec: string, ctx: GraphContext): string | null {
  const baseDir = ctx.tsBaseDir;
  for (const { prefix, wildcard, targets } of ctx.tsPaths) {
    if (wildcard) {
      if (!spec.startsWith(prefix)) continue;
      const tail = spec.slice(prefix.length);
      for (const target of targets) {
        const hit = probeResolved(joinRepo(baseDir ?? "", target.replace("*", tail)), ctx.filePathSet);
        if (hit) return hit;
      }
    } else {
      if (spec !== prefix) continue;
      for (const target of targets) {
        const hit = probeResolved(joinRepo(baseDir ?? "", target), ctx.filePathSet);
        if (hit) return hit;
      }
    }
  }
  if (baseDir !== null) {
    const hit = probeResolved(joinRepo(baseDir, spec), ctx.filePathSet);
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve an import specifier to zero or more target files in the scan set.
 * Python and Go resolve language-specifically (Go fans out to a package
 * directory's files); TS/JS resolve relative specifiers directly and
 * non-relative ones through tsconfig aliases.
 */
function resolveImportToFiles(importPath: string, fromFile: string, ctx: GraphContext): string[] {
  if (fromFile.endsWith(".py")) {
    const r = resolvePythonImport(importPath, fromFile, ctx);
    return r ? [r] : [];
  }
  if (fromFile.endsWith(".go")) {
    return resolveGoImport(importPath, fromFile, ctx);
  }
  if (importPath.startsWith(".") || importPath.startsWith("/")) {
    const r = resolveRelativeImport(importPath, fromFile, ctx.filePathSet);
    return r ? [r] : [];
  }
  // Bare TS/JS specifier — try tsconfig alias/baseUrl resolution.
  const aliased = resolveTsAliasImport(importPath, ctx);
  return aliased ? [aliased] : [];
}

/**
 * Build import graph for the repository
 */
export async function buildImportGraph(
  repoPath: string,
  files: FileInfo[]
): Promise<Map<string, { imports: string[]; importedBy: string[] }>> {
  const graph = new Map<string, { imports: string[]; importedBy: string[] }>();
  // Pre-build a Set of all file paths for O(1) lookups during resolution
  const filePathSet = new Set(files.filter(f => !f.isDirectory).map(f => f.path));
  // Project-level resolution context (Go module prefix + package-dir index, TS
  // baseUrl/paths aliases, Python source roots) — built once for all files.
  const ctx = await buildGraphContext(repoPath, files, filePathSet);
  // Track importedBy entries with Sets for O(1) dedup
  const importedBySets = new Map<string, Set<string>>();

  // Initialize all files
  for (const file of files) {
    if (!file.isDirectory) {
      graph.set(file.path, { imports: [], importedBy: [] });
      importedBySets.set(file.path, new Set());
    }
  }

  const MAX_FILE_SIZE_FOR_GRAPH = 100_000;

  // Parse source files
  const sourceFiles = files.filter(f => 
    !f.isDirectory &&
    /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(f.path) &&
    !f.path.includes("node_modules") &&
    f.size < MAX_FILE_SIZE_FOR_GRAPH
  );

  // Parse source files in parallel batches for performance
  const BATCH_SIZE = 15;
  for (let i = 0; i < sourceFiles.length; i += BATCH_SIZE) {
    const batch = sourceFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (file) => {
        try {
          const content = await readFile(join(repoPath, file.path), "utf-8");
          return { file, content };
        } catch {
          return null;
        }
      })
    );

    for (const result of results) {
      if (!result) continue;
      const { file, content } = result;
      const imports = extractImports(content, file.path);

      const resolvedImports: string[] = [];
      const seenTargets = new Set<string>();
      for (const imp of imports) {
        for (const resolved of resolveImportToFiles(imp, file.path, ctx)) {
          if (seenTargets.has(resolved)) continue;
          seenTargets.add(resolved);
          resolvedImports.push(resolved);

          // Update importedBy for the target (Set for O(1) dedup)
          const targetNode = graph.get(resolved);
          if (targetNode) {
            const ibSet = importedBySets.get(resolved)!;
            if (!ibSet.has(file.path)) {
              ibSet.add(file.path);
              targetNode.importedBy.push(file.path);
            }
          }
        }
      }

      const node = graph.get(file.path);
      if (node) {
        node.imports = resolvedImports;
      }
    }
  }

  return graph;
}


/**
 * Broad test-path predicate — a superset of the six per-target patterns in
 * findRelatedTests. Used to pre-filter the file list to the (usually small)
 * test-file subset once per analysis so findRelatedTests never rescans the whole
 * tree. Mirrors the predicates in health.ts / metrics.ts.
 */
function isTestPath(path: string): boolean {
  if (/(^|\/)(tests?|__tests__|specs?|__mocks__)(\/|$)/.test(path)) return true;
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (/\.(test|spec)\.[^.]+$/.test(base)) return true;
  if (/_test\.[^.]+$/.test(base)) return true; // Go, Python
  if (/^test_.+\.py$/.test(base)) return true; // Python
  return false;
}

/**
 * Find tests related to a file. `testFiles` must already be the test-file subset
 * (see isTestPath); every pattern here is a strict subset of that predicate, so
 * scanning the subset is behavior-identical to scanning the full list.
 */
function findRelatedTests(filePath: string, testFiles: FileInfo[]): string[] {
  const fileName = escapeRegex(basename(filePath).replace(/\.[^.]+$/, ""));
  const dir = dirname(filePath);
  // Root-level files have dirname ".", which must not become a literal "./"
  // prefix — fast-glob scan keys carry no "./" prefix.
  const dirPrefix = dir === "." ? "" : `${escapeRegex(dir)}/`;

  const testPatterns = [
    // Same directory with .test/.spec suffix
    new RegExp(`^${dirPrefix}${fileName}\\.(test|spec)\\.[^.]+$`),
    // Go sibling test: `server.go` → `server_test.go`
    new RegExp(`^${dirPrefix}${fileName}_test\\.go$`),
    // Python sibling tests: `calc.py` → `test_calc.py` or `calc_test.py`
    new RegExp(`^${dirPrefix}(?:test_${fileName}|${fileName}_test)\\.py$`),
    // __tests__ directory
    new RegExp(`^${dirPrefix}__tests__/${fileName}\\.[^.]+$`),
    // test directory at root
    new RegExp(`^test/.*${fileName}.*\\.[^.]+$`),
    new RegExp(`^tests/.*${fileName}.*\\.[^.]+$`),
  ];

  return testFiles
    .filter(f => testPatterns.some(p => p.test(f.path)))
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

  // Heuristic: docs in the same directory, or whose name references this file.
  // (A blanket "any file under docs/" match would tie every doc to every
  // target, so it is intentionally excluded.)
  const fileNameLower = fileName.toLowerCase();
  return docFiles
    .filter(f => {
      const docDir = dirname(f.path);
      const docName = basename(f.path).toLowerCase();
      return (
        docDir === fileDir ||
        (fileNameLower.length > 0 && docName.includes(fileNameLower))
      );
    })
    .map(f => f.path)
    .slice(0, 5); // Max related docs per file
}

/**
 * Analyze impact of changing a specific file
 */
export async function analyzeChangeImpact(
  repoPath: string,
  files: FileInfo[],
  targetFile: string,
  graph?: Map<string, { imports: string[]; importedBy: string[] }>,
  relatedTestsCache?: Map<string, string[]>
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

  // Pre-filter the (usually small) test-file subset once so findRelatedTests
  // matches its per-target patterns against tests only, never rescanning the
  // whole tree per call. Results are memoized per target; a caller may thread a
  // shared `relatedTestsCache` across key files (where the same affected file
  // recurs across fan-outs) to avoid recomputing it.
  const testFiles = files.filter(f => !f.isDirectory && isTestPath(f.path));
  const testCache = relatedTestsCache ?? new Map<string, string[]>();
  const relatedTestsFor = (target: string): string[] => {
    let cached = testCache.get(target);
    if (!cached) {
      cached = findRelatedTests(target, testFiles);
      testCache.set(target, cached);
    }
    return cached;
  };

  // Find related tests (copy the memoized array before extending it in place).
  const affectedTests = [...relatedTestsFor(targetFile)];
  const affectedTestSet = new Set(affectedTests);

  // Also find tests for affected files
  for (const affected of affectedFiles) {
    for (const test of relatedTestsFor(affected)) {
      if (!affectedTestSet.has(test)) {
        affectedTestSet.add(test);
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
 * Generate IMPACT.md documentation. When `cycles` is provided and contains at
 * least one circular-dependency group, a "Circular Dependencies" section is
 * appended; otherwise the output is unchanged (the parameter is optional and
 * the section is purely additive).
 */
export function generateImpactDocs(
  impacts: ChangeImpact[],
  projectName: string,
  cycles?: CyclesSummary
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

  if (cycles && cycles.cycles.length > 0) {
    lines.push("## Circular Dependencies");
    lines.push("");
    lines.push(
      `Detected ${cycles.cycles.length} circular dependency group(s) — modules that import each other directly or transitively. These are worth untangling, as they complicate load order, testing, and onboarding.`
    );
    lines.push("");
    cycles.cycles.forEach((cycle, i) => {
      const suffix = cycle.size === 1 ? " (self-import)" : ` (${cycle.size} files)`;
      lines.push(`${i + 1}. ${cycles.rings[i]}${suffix}`);
    });
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
    // Terraform IaC key files (root-level only)
    /^main\.tf$/,
    /^variables\.tf$/,
    /^outputs\.tf$/,
    /^providers\.tf$/,
    /^versions\.tf$/,
    /^backend\.tf$/,
    /^terragrunt\.hcl$/,
    /^\.terraform\.lock\.hcl$/,
    // Bicep IaC key files (root-level only)
    /^main\.bicep$/,
    /^modules\.bicep$/,
  ];

  const keyFiles: string[] = [];

  for (const pattern of keyPatterns) {
    for (const file of files) {
      if (!file.isDirectory && pattern.test(file.path) && !keyFiles.includes(file.path)) {
        keyFiles.push(file.path);
        if (keyFiles.length >= 20) break;
      }
    }
    if (keyFiles.length >= 20) break;
  }

  return keyFiles;
}
