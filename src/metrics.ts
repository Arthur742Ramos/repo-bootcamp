/**
 * Codebase Metrics & Hotspots Module
 *
 * Computes deterministic, onboarding-relevant metrics directly from the file
 * scan (no LLM calls): language breakdown, source/test/doc/config counts,
 * largest-file "hotspots", per-directory size distribution, and an
 * Approachability score that estimates how easy a codebase is to pick up.
 */

import type { FileInfo, ScanResult } from "./types.js";

/** Per-language aggregate over code files. */
export interface LanguageMetric {
  language: string;
  files: number;
  bytes: number;
  /** Share of total code bytes, 0-100. */
  percentage: number;
}

/** A single large code file worth flagging during onboarding. */
export interface FileHotspot {
  path: string;
  bytes: number;
  language: string;
}

/** Aggregate size for a top-level directory. */
export interface DirectoryMetric {
  path: string;
  files: number;
  bytes: number;
  /** Share of total scanned bytes, 0-100. */
  percentage: number;
}

/** Rough size classification of a codebase. */
export type CodebaseSizeClass = "tiny" | "small" | "medium" | "large" | "very-large";

/** How easy the codebase looks to approach for a newcomer. */
export interface Approachability {
  /** 0-100, higher means easier to approach. */
  score: number;
  /** Letter grade A-F derived from the score. */
  grade: string;
  /** Human-readable drivers behind the score (positive and negative). */
  factors: string[];
}

/** Full codebase metrics result. */
export interface CodebaseMetrics {
  totalFiles: number;
  totalBytes: number;
  sourceFiles: number;
  sourceBytes: number;
  testFiles: number;
  docFiles: number;
  configFiles: number;
  otherFiles: number;
  averageFileBytes: number;
  medianFileBytes: number;
  /** testFiles / sourceFiles (0 when there are no source files). */
  testToSourceRatio: number;
  languages: LanguageMetric[];
  hotspots: FileHotspot[];
  directories: DirectoryMetric[];
  sizeClass: CodebaseSizeClass;
  approachability: Approachability;
}

/** Maximum hotspots reported. */
const MAX_HOTSPOTS = 10;
/** Maximum directories reported in the distribution table. */
const MAX_DIRECTORIES = 12;

/** File extension → programming language. */
const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  hpp: "C++",
  hh: "C++",
  c: "C",
  h: "C",
  swift: "Swift",
  scala: "Scala",
  m: "Objective-C",
  mm: "Objective-C",
  dart: "Dart",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  clj: "Clojure",
  cljs: "Clojure",
  hs: "Haskell",
  lua: "Lua",
  r: "R",
  jl: "Julia",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  ps1: "PowerShell",
  sql: "SQL",
  vue: "Vue",
  svelte: "Svelte",
  css: "CSS",
  scss: "CSS",
  sass: "CSS",
  less: "CSS",
  html: "HTML",
  htm: "HTML",
};

/** Documentation file extensions. */
const DOC_EXTS = new Set(["md", "mdx", "rst", "adoc", "txt", "org"]);

/** Config file extensions. */
const CONFIG_EXTS = new Set([
  "json",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "env",
  "lock",
  "properties",
  "xml",
  "gradle",
  "plist",
]);

/** Config file basenames (lowercased) that lack a telling extension. */
const CONFIG_BASENAMES = new Set([
  "dockerfile",
  "makefile",
  "procfile",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".npmignore",
  ".npmrc",
  ".nvmrc",
  ".prettierrc",
  ".prettierignore",
  ".eslintignore",
  ".dockerignore",
  ".babelrc",
]);

/** Files that are typically generated/vendored and should not count as hotspots. */
const GENERATED_PATTERNS: RegExp[] = [
  /(^|\/)package-lock\.json$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)composer\.lock$/i,
  /(^|\/)cargo\.lock$/i,
  /\.min\.(js|css)$/i,
  /\.(map)$/i,
];

function getExtension(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

function getBasename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).toLowerCase();
}

function isTestPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (/(^|\/)(tests?|__tests__|specs?|__mocks__)(\/|$)/.test(lower)) return true;
  const base = getBasename(path);
  if (/\.(test|spec)\.[^.]+$/.test(base)) return true;
  if (/_test\.[^.]+$/.test(base)) return true; // Go, Python
  if (/^test_.+\.py$/.test(base)) return true; // Python
  return false;
}

function isConfigFile(path: string): boolean {
  const ext = getExtension(path);
  if (CONFIG_EXTS.has(ext)) return true;
  const base = getBasename(path);
  if (CONFIG_BASENAMES.has(base)) return true;
  // Tooling dotfiles such as .eslintrc.js / .eslintrc.cjs
  if (/^\.[a-z]+rc(\.[a-z]+)?$/.test(base)) return true;
  return false;
}

function isGenerated(path: string): boolean {
  return GENERATED_PATTERNS.some((re) => re.test(path));
}

function topLevelDir(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "(root)" : path.slice(0, slash);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function classifySize(sourceFiles: number): CodebaseSizeClass {
  if (sourceFiles < 10) return "tiny";
  if (sourceFiles < 75) return "small";
  if (sourceFiles < 300) return "medium";
  if (sourceFiles < 1500) return "large";
  return "very-large";
}

/**
 * Compute an approachability score (0-100, higher is easier) plus the factors
 * that drove it. Deterministic and dependency-free.
 */
function computeApproachability(input: {
  sizeClass: CodebaseSizeClass;
  sourceFiles: number;
  testToSourceRatio: number;
  averageCodeBytes: number;
  largestCodeBytes: number;
  languageCount: number;
}): Approachability {
  const factors: string[] = [];
  let score = 100;

  const sizePenalty: Record<CodebaseSizeClass, number> = {
    tiny: 0,
    small: 0,
    medium: 8,
    large: 18,
    "very-large": 30,
  };
  score -= sizePenalty[input.sizeClass];
  if (input.sizeClass === "tiny" || input.sizeClass === "small") {
    factors.push(`Compact codebase (${input.sourceFiles} source files) is quick to navigate`);
  } else {
    factors.push(`${input.sizeClass} codebase (${input.sourceFiles} source files) takes longer to learn`);
  }

  if (input.sourceFiles === 0) {
    // Avoid punishing test coverage when there is nothing to cover.
    factors.push("No source files detected to assess test coverage");
  } else if (input.testToSourceRatio === 0) {
    score -= 18;
    factors.push("No test files detected — behavior is harder to verify safely");
  } else if (input.testToSourceRatio < 0.2) {
    score -= 12;
    factors.push(`Low test-to-source ratio (${input.testToSourceRatio.toFixed(2)})`);
  } else if (input.testToSourceRatio < 0.5) {
    score -= 6;
    factors.push(`Moderate test-to-source ratio (${input.testToSourceRatio.toFixed(2)})`);
  } else {
    factors.push(`Healthy test-to-source ratio (${input.testToSourceRatio.toFixed(2)})`);
  }

  if (input.averageCodeBytes > 16 * 1024) {
    score -= 18;
    factors.push(`Large average file size (${formatBytes(input.averageCodeBytes)}) suggests dense modules`);
  } else if (input.averageCodeBytes > 8 * 1024) {
    score -= 10;
    factors.push(`Above-average file size (${formatBytes(input.averageCodeBytes)})`);
  } else if (input.averageCodeBytes > 0) {
    factors.push(`Small average file size (${formatBytes(input.averageCodeBytes)}) keeps modules focused`);
  }

  if (input.largestCodeBytes > 100 * 1024) {
    score -= 14;
    factors.push(`A very large file (${formatBytes(input.largestCodeBytes)}) concentrates complexity`);
  } else if (input.largestCodeBytes > 50 * 1024) {
    score -= 8;
    factors.push(`A large file (${formatBytes(input.largestCodeBytes)}) may be a complexity hotspot`);
  }

  if (input.languageCount > 7) {
    score -= 12;
    factors.push(`Highly polyglot (${input.languageCount} languages) increases context switching`);
  } else if (input.languageCount > 4) {
    score -= 6;
    factors.push(`Polyglot codebase (${input.languageCount} languages)`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, grade: getApproachabilityGrade(score), factors };
}

/**
 * Convert an approachability score to a letter grade.
 */
export function getApproachabilityGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Format a byte count into a compact human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Compute codebase metrics from a completed file scan.
 */
export function computeCodebaseMetrics(scan: ScanResult): CodebaseMetrics {
  const files: FileInfo[] = scan.files.filter((f) => !f.isDirectory);

  let totalBytes = 0;
  let sourceFiles = 0;
  let sourceBytes = 0;
  let testFiles = 0;
  let docFiles = 0;
  let configFiles = 0;
  let otherFiles = 0;

  const sizes: number[] = [];
  const languageMap = new Map<string, { files: number; bytes: number }>();
  const dirMap = new Map<string, { files: number; bytes: number }>();
  const codeFiles: FileHotspot[] = [];
  let totalCodeBytes = 0;
  let largestCodeBytes = 0;

  for (const file of files) {
    const bytes = file.size;
    totalBytes += bytes;
    sizes.push(bytes);

    const dir = dirMap.get(topLevelDir(file.path)) ?? { files: 0, bytes: 0 };
    dir.files += 1;
    dir.bytes += bytes;
    dirMap.set(topLevelDir(file.path), dir);

    const ext = getExtension(file.path);
    const language = LANGUAGE_BY_EXT[ext];

    if (language) {
      const isTest = isTestPath(file.path);
      const agg = languageMap.get(language) ?? { files: 0, bytes: 0 };
      agg.files += 1;
      agg.bytes += bytes;
      languageMap.set(language, agg);
      totalCodeBytes += bytes;

      if (isTest) {
        testFiles += 1;
      } else {
        sourceFiles += 1;
        sourceBytes += bytes;
      }

      if (!isGenerated(file.path)) {
        codeFiles.push({ path: file.path, bytes, language });
        if (bytes > largestCodeBytes) largestCodeBytes = bytes;
      }
    } else if (DOC_EXTS.has(ext)) {
      docFiles += 1;
    } else if (isConfigFile(file.path)) {
      configFiles += 1;
    } else {
      otherFiles += 1;
    }
  }

  const languages: LanguageMetric[] = [...languageMap.entries()]
    .map(([lang, agg]) => ({
      language: lang,
      files: agg.files,
      bytes: agg.bytes,
      percentage: totalCodeBytes > 0 ? Math.round((agg.bytes / totalCodeBytes) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.language.localeCompare(b.language));

  const hotspots: FileHotspot[] = [...codeFiles]
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .slice(0, MAX_HOTSPOTS);

  const directories: DirectoryMetric[] = [...dirMap.entries()]
    .map(([path, agg]) => ({
      path,
      files: agg.files,
      bytes: agg.bytes,
      percentage: totalBytes > 0 ? Math.round((agg.bytes / totalBytes) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .slice(0, MAX_DIRECTORIES);

  const averageFileBytes = files.length > 0 ? Math.round(totalBytes / files.length) : 0;
  const averageCodeBytes =
    sourceFiles + testFiles > 0 ? Math.round(totalCodeBytes / (sourceFiles + testFiles)) : 0;
  const testToSourceRatio = sourceFiles > 0 ? Math.round((testFiles / sourceFiles) * 100) / 100 : 0;
  const sizeClass = classifySize(sourceFiles);

  const approachability = computeApproachability({
    sizeClass,
    sourceFiles,
    testToSourceRatio,
    averageCodeBytes,
    largestCodeBytes,
    languageCount: languages.length,
  });

  return {
    totalFiles: files.length,
    totalBytes,
    sourceFiles,
    sourceBytes,
    testFiles,
    docFiles,
    configFiles,
    otherFiles,
    averageFileBytes,
    medianFileBytes: median(sizes),
    testToSourceRatio,
    languages,
    hotspots,
    directories,
    sizeClass,
    approachability,
  };
}

const SIZE_CLASS_LABEL: Record<CodebaseSizeClass, string> = {
  tiny: "Tiny",
  small: "Small",
  medium: "Medium",
  large: "Large",
  "very-large": "Very large",
};

/**
 * Render codebase metrics as a Markdown document (METRICS.md).
 */
export function generateMetricsDocs(metrics: CodebaseMetrics, projectName: string): string {
  const lines: string[] = [];
  const { approachability: appr } = metrics;
  const scoreEmoji = appr.score >= 80 ? "🟢" : appr.score >= 60 ? "🟡" : "🔴";

  lines.push("# Codebase Metrics");
  lines.push("");
  lines.push(`Quantitative snapshot of **${projectName}** to help you gauge scope before diving in.`);
  lines.push("");

  lines.push("## Approachability");
  lines.push("");
  lines.push(`${scoreEmoji} **${appr.score}/100** (Grade: ${appr.grade}) — ${SIZE_CLASS_LABEL[metrics.sizeClass]} codebase`);
  lines.push("");
  lines.push("How easy this codebase looks to pick up, based on size, test coverage, file density, and language spread.");
  lines.push("");
  for (const factor of appr.factors) {
    lines.push(`- ${factor}`);
  }
  lines.push("");

  lines.push("## Overview");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Total files | ${metrics.totalFiles} |`);
  lines.push(`| Source files | ${metrics.sourceFiles} |`);
  lines.push(`| Test files | ${metrics.testFiles} |`);
  lines.push(`| Doc files | ${metrics.docFiles} |`);
  lines.push(`| Config files | ${metrics.configFiles} |`);
  lines.push(`| Test : source ratio | ${metrics.testToSourceRatio.toFixed(2)} |`);
  lines.push(`| Total size | ${formatBytes(metrics.totalBytes)} |`);
  lines.push(`| Average file size | ${formatBytes(metrics.averageFileBytes)} |`);
  lines.push(`| Median file size | ${formatBytes(metrics.medianFileBytes)} |`);
  lines.push("");

  if (metrics.languages.length > 0) {
    lines.push("## Language Breakdown");
    lines.push("");
    lines.push("| Language | Files | Size | Share |");
    lines.push("|----------|-------|------|-------|");
    for (const lang of metrics.languages) {
      lines.push(`| ${lang.language} | ${lang.files} | ${formatBytes(lang.bytes)} | ${lang.percentage}% |`);
    }
    lines.push("");
  }

  if (metrics.hotspots.length > 0) {
    lines.push("## Largest Files (Hotspots)");
    lines.push("");
    lines.push("These files carry the most code by size — likely high-impact areas to read early or refactor carefully.");
    lines.push("");
    lines.push("| File | Language | Size |");
    lines.push("|------|----------|------|");
    for (const spot of metrics.hotspots) {
      lines.push(`| \`${spot.path}\` | ${spot.language} | ${formatBytes(spot.bytes)} |`);
    }
    lines.push("");
  }

  if (metrics.directories.length > 0) {
    lines.push("## Directory Distribution");
    lines.push("");
    lines.push("Where the bytes live across top-level directories.");
    lines.push("");
    lines.push("| Directory | Files | Size | Share |");
    lines.push("|-----------|-------|------|-------|");
    for (const dir of metrics.directories) {
      lines.push(`| \`${dir.path}\` | ${dir.files} | ${formatBytes(dir.bytes)} | ${dir.percentage}% |`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("_Metrics are computed deterministically from the file scan (no AI), so they're stable across runs._");
  lines.push("");

  return lines.join("\n");
}
