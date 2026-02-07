/**
 * Docs Analyzer - Validates documentation against repo state
 *
 * Detects mismatches between README/docs and actual repo configuration:
 * - Version mismatches (Node/Python versions in README vs package.json)
 * - Missing framework documentation
 * - CLI help drift (--help output vs documented usage)
 * - Missing prerequisites documentation
 * - Stale badge URLs
 */

import { readFile, access } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";

export interface VersionMismatch {
  type: "node" | "python" | "npm" | "other";
  documented: string;
  actual: string;
  location: string;
}

export interface FrameworkIssue {
  framework: string;
  status: "missing" | "outdated";
  version?: string;
}

export interface CLIDrift {
  command: string;
  documented: string;
  actual: string;
  type: "missing" | "outdated" | "extra";
}

export interface PrerequisiteIssue {
  name: string;
  type: "tool" | "env";
  documented: boolean;
  required: boolean;
}

export interface BadgeIssue {
  url: string;
  status: "broken" | "outdated" | "invalid";
  line: number;
}

export interface DocsAnalysisResult {
  versionMismatches: VersionMismatch[];
  frameworkIssues: FrameworkIssue[];
  cliDrift: CLIDrift[];
  prerequisiteIssues: PrerequisiteIssue[];
  badgeIssues: BadgeIssue[];
  isStale: boolean;
  summary: {
    errors: number;
    warnings: number;
    ok: number;
  };
}

/**
 * Read file safely, returning null if not found
 */
async function readFileSafe(path: string): Promise<string | null> {
  try {
    await access(path);
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Parse package.json from repo
 */
async function getPackageJson(repoPath: string): Promise<Record<string, unknown> | null> {
  const content = await readFileSafe(join(repoPath, "package.json"));
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get README content
 */
async function getReadme(repoPath: string): Promise<string | null> {
  const names = ["README.md", "readme.md", "README.MD", "Readme.md"];
  for (const name of names) {
    const content = await readFileSafe(join(repoPath, name));
    if (content) return content;
  }
  return null;
}

/**
 * Analyze version mismatches between docs and package.json
 */
export async function analyzeVersionMismatches(repoPath: string): Promise<VersionMismatch[]> {
  const mismatches: VersionMismatch[] = [];
  const readme = await getReadme(repoPath);
  const pkg = await getPackageJson(repoPath);

  if (!readme || !pkg) return mismatches;

  // Check Node.js version
  const engines = pkg.engines as Record<string, string> | undefined;
  if (engines?.node) {
    const actualNode = engines.node;
    // Extract major version from engine spec (e.g., ">=20.0.0" -> 20)
    const actualMajor = parseInt(actualNode.replace(/[>=<^~]/g, "").split(".")[0], 10);

    // Look for Node version mentions in README
    const nodePatterns = [
      /Node(?:\.js)?\s*(?:>=?\s*)?v?([\d.]+)/gi,
      /node\s*(?:>=?\s*)?v?([\d.]+)/gi,
      /requires?\s+Node(?:\.js)?\s*v?([\d.]+)/gi,
    ];

    const seenDocumented = new Set<string>();

    for (const pattern of nodePatterns) {
      const matches = readme.matchAll(pattern);
      for (const match of matches) {
        const documented = match[1];
        const documentedMajor = parseInt(documented.split(".")[0], 10);

        // Skip duplicates
        if (seenDocumented.has(documented)) continue;
        seenDocumented.add(documented);

        // Only flag if major versions don't match
        if (!isNaN(actualMajor) && !isNaN(documentedMajor) && actualMajor !== documentedMajor) {
          mismatches.push({
            type: "node",
            documented,
            actual: actualNode,
            location: "README.md",
          });
        }
      }
    }
  }

  // Check npm/yarn version mentions
  const pkgManager = pkg.packageManager as string | undefined;
  if (pkgManager) {
    const [manager, version] = pkgManager.split("@");
    const managerPattern = new RegExp(`${manager}\\s*(?:>=?\\s*)?v?([\\d.]+)`, "gi");
    const matches = readme.matchAll(managerPattern);

    for (const match of matches) {
      const documented = match[1];
      if (documented !== version) {
        mismatches.push({
          type: manager === "npm" ? "npm" : "other",
          documented,
          actual: version,
          location: "README.md",
        });
      }
    }
  }

  // Check Python version if pyproject.toml exists
  const pyproject = await readFileSafe(join(repoPath, "pyproject.toml"));
  if (pyproject) {
    const pyVersionMatch = pyproject.match(/python\s*=\s*["']([^"']+)["']/i);
    if (pyVersionMatch) {
      const actualPython = pyVersionMatch[1];
      const pythonPatterns = [
        /Python\s*(?:>=?\s*)?v?([\d.]+)/gi,
        /python\s*(?:>=?\s*)?v?([\d.]+)/gi,
        /requires?\s+Python\s*v?([\d.]+)/gi,
      ];

      for (const pattern of pythonPatterns) {
        const matches = readme.matchAll(pattern);
        for (const match of matches) {
          const documented = match[1];
          if (!actualPython.includes(documented)) {
            mismatches.push({
              type: "python",
              documented,
              actual: actualPython,
              location: "README.md",
            });
          }
        }
      }
    }
  }

  return mismatches;
}

/**
 * Analyze framework documentation coverage
 */
export async function analyzeFrameworkDocs(repoPath: string): Promise<FrameworkIssue[]> {
  const issues: FrameworkIssue[] = [];
  const readme = await getReadme(repoPath);
  const pkg = await getPackageJson(repoPath);

  if (!readme || !pkg) return issues;

  const deps = {
    ...(pkg.dependencies as Record<string, string> || {}),
    ...(pkg.devDependencies as Record<string, string> || {}),
  };

  // Major frameworks that should be documented
  const majorFrameworks: Record<string, string[]> = {
    react: ["react", "react-dom"],
    next: ["next", "nextjs", "next.js"],
    vue: ["vue", "vuejs", "vue.js"],
    nuxt: ["nuxt", "nuxtjs", "nuxt.js"],
    angular: ["angular", "@angular/core"],
    svelte: ["svelte", "sveltekit"],
    express: ["express", "expressjs"],
    fastify: ["fastify"],
    nestjs: ["nest", "nestjs", "@nestjs/core"],
    prisma: ["prisma", "@prisma/client"],
    drizzle: ["drizzle", "drizzle-orm"],
    tailwind: ["tailwind", "tailwindcss"],
    typescript: ["typescript", "ts"],
    vitest: ["vitest"],
    jest: ["jest"],
    mocha: ["mocha"],
  };

  const readmeLower = readme.toLowerCase();

  for (const [framework, searchTerms] of Object.entries(majorFrameworks)) {
    // Check if framework is in dependencies
    const inDeps = Object.keys(deps).some(
      (dep) => dep.toLowerCase().includes(framework) || dep.includes(`@${framework}`)
    );

    if (inDeps) {
      // Check if mentioned in README
      const mentioned = searchTerms.some((term) => readmeLower.includes(term.toLowerCase()));
      if (!mentioned) {
        issues.push({
          framework,
          status: "missing",
          version: deps[framework] || deps[`@${framework}/core`],
        });
      }
    }
  }

  return issues;
}

/**
 * Analyze CLI documentation drift
 */
export async function analyzeCLIDrift(repoPath: string): Promise<CLIDrift[]> {
  const drift: CLIDrift[] = [];
  const readme = await getReadme(repoPath);
  const pkg = await getPackageJson(repoPath);

  if (!readme || !pkg) return drift;

  // Check if this is a CLI package
  const bin = pkg.bin as Record<string, string> | string | undefined;
  if (!bin) return drift;

  const binName = typeof bin === "string" ? Object.keys(pkg.bin as Record<string, string>)[0] : Object.keys(bin)[0];
  if (!binName) return drift;

  // Try to get --help output
  let helpOutput: string | null = null;
  try {
    // Try running the CLI with --help
    const mainFile = typeof bin === "string" ? bin : bin[binName];
    const fullPath = join(repoPath, mainFile.replace(/^\.\//, ""));

    // Check if it's a TypeScript file, use tsx
    if (fullPath.endsWith(".ts")) {
      helpOutput = execSync(`npx tsx "${fullPath}" --help 2>/dev/null`, {
        cwd: repoPath,
        timeout: 10000,
        encoding: "utf-8",
      });
    } else {
      helpOutput = execSync(`node "${fullPath}" --help 2>/dev/null`, {
        cwd: repoPath,
        timeout: 10000,
        encoding: "utf-8",
      });
    }
  } catch {
    // CLI might not work without build, skip
    return drift;
  }

  if (!helpOutput) return drift;

  // Extract commands/options from --help output
  const helpOptions = new Set<string>();
  const optionPattern = /--([a-z][-a-z0-9]*)/gi;
  let match;
  while ((match = optionPattern.exec(helpOutput)) !== null) {
    helpOptions.add(match[1].toLowerCase());
  }

  // Extract documented options from README
  const docOptions = new Set<string>();
  const codeBlocks = readme.match(/```[^`]*```/gs) || [];
  for (const block of codeBlocks) {
    if (block.includes(binName) || block.includes("--")) {
      while ((match = optionPattern.exec(block)) !== null) {
        docOptions.add(match[1].toLowerCase());
      }
    }
  }

  // Find options in --help but not documented
  for (const opt of helpOptions) {
    if (!docOptions.has(opt) && !["help", "version"].includes(opt)) {
      drift.push({
        command: binName,
        documented: "",
        actual: `--${opt}`,
        type: "missing",
      });
    }
  }

  // Find documented options not in --help
  for (const opt of docOptions) {
    if (!helpOptions.has(opt) && !["help", "version"].includes(opt)) {
      drift.push({
        command: binName,
        documented: `--${opt}`,
        actual: "",
        type: "extra",
      });
    }
  }

  return drift;
}

/**
 * Analyze prerequisites documentation
 */
export async function analyzePrerequisites(repoPath: string): Promise<PrerequisiteIssue[]> {
  const issues: PrerequisiteIssue[] = [];
  const readme = await getReadme(repoPath);
  const pkg = await getPackageJson(repoPath);

  if (!readme) return issues;

  const readmeLower = readme.toLowerCase();

  // Check for common prerequisite tools
  const tools: Record<string, boolean> = {
    node: false,
    npm: false,
    yarn: false,
    pnpm: false,
    docker: false,
    git: false,
  };

  // Determine required tools
  if (pkg) {
    tools.node = true;
    const pkgManager = (pkg.packageManager as string) || "";
    if (pkgManager.startsWith("yarn")) tools.yarn = true;
    else if (pkgManager.startsWith("pnpm")) tools.pnpm = true;
    else tools.npm = true;
  }

  // Check for docker-compose or Dockerfile
  const hasDocker = await readFileSafe(join(repoPath, "docker-compose.yml")) !== null ||
    await readFileSafe(join(repoPath, "docker-compose.yaml")) !== null ||
    await readFileSafe(join(repoPath, "Dockerfile")) !== null;
  if (hasDocker) tools.docker = true;

  // Check if prerequisites are documented
  for (const [tool, required] of Object.entries(tools)) {
    if (required) {
      const documented = readmeLower.includes(tool) ||
        readmeLower.includes("prerequisite") ||
        readmeLower.includes("requirement");

      if (!documented) {
        issues.push({
          name: tool,
          type: "tool",
          documented: false,
          required: true,
        });
      }
    }
  }

  // Check for .env.example and env var documentation
  const envExample = await readFileSafe(join(repoPath, ".env.example"));
  if (envExample) {
    const envVars = envExample.match(/^([A-Z][A-Z0-9_]+)=/gm) || [];
    for (const envVar of envVars) {
      const varName = envVar.replace("=", "");
      const documented = readme.includes(varName);
      if (!documented) {
        issues.push({
          name: varName,
          type: "env",
          documented: false,
          required: true,
        });
      }
    }
  }

  return issues;
}

/**
 * Analyze badge URLs for validity
 */
export async function analyzeBadges(repoPath: string): Promise<BadgeIssue[]> {
  const issues: BadgeIssue[] = [];
  const readme = await getReadme(repoPath);

  if (!readme) return issues;

  // Find badge image URLs
  const badgePattern = /!\[[^\]]*\]\(([^)]+)\)/g;
  const lines = readme.split("\n");
  let lineNum = 0;

  for (const line of lines) {
    lineNum++;
    let match;
    while ((match = badgePattern.exec(line)) !== null) {
      const url = match[1];

      // Check for common badge services
      if (url.includes("shields.io") || url.includes("badge") || url.includes("img.shields")) {
        // Basic URL validation
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          issues.push({
            url,
            status: "invalid",
            line: lineNum,
          });
        }

        // Check for placeholder patterns that indicate outdated badges
        if (url.includes("your-") || url.includes("USERNAME") || url.includes("REPO")) {
          issues.push({
            url,
            status: "outdated",
            line: lineNum,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Run full docs analysis on a repository
 */
export async function analyzeDocumentation(repoPath: string): Promise<DocsAnalysisResult> {
  const [versionMismatches, frameworkIssues, cliDrift, prerequisiteIssues, badgeIssues] = await Promise.all([
    analyzeVersionMismatches(repoPath),
    analyzeFrameworkDocs(repoPath),
    analyzeCLIDrift(repoPath),
    analyzePrerequisites(repoPath),
    analyzeBadges(repoPath),
  ]);

  const errors = versionMismatches.length + badgeIssues.filter((b) => b.status === "broken").length;
  const warnings =
    frameworkIssues.length +
    cliDrift.length +
    prerequisiteIssues.length +
    badgeIssues.filter((b) => b.status !== "broken").length;

  return {
    versionMismatches,
    frameworkIssues,
    cliDrift,
    prerequisiteIssues,
    badgeIssues,
    isStale: errors > 0 || warnings > 0,
    summary: {
      errors,
      warnings,
      ok: errors === 0 && warnings === 0 ? 1 : 0,
    },
  };
}
