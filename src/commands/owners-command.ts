import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

import chalk from "chalk";

import { scanRepositoryFiles } from "../services/clone-service.js";
import { finiteOr } from "../utils.js";
import { withResolvedRepo } from "./_shared.js";

const execFileAsync = promisify(execFile);

/** Options accepted by the `bootcamp owners` command. */
export interface OwnersCommandOptions {
  branch?: string;
  /** Emit the ownership map as JSON for machine consumption. */
  json?: boolean;
  /** Maximum files to scan. Defaults to 500. */
  maxFiles?: number;
  /** Keep the temporary clone (remote repos only). */
  keepTemp?: boolean;
  verbose?: boolean;
}

/** A single CODEOWNERS rule. */
export interface OwnerRule {
  pattern: string;
  owners: string[];
}

/** GitHub's CODEOWNERS lookup order. */
const CODEOWNERS_LOCATIONS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

/** Parse CODEOWNERS content into ordered rules (last match wins, per GitHub). */
export function parseCodeowners(content: string): OwnerRule[] {
  const rules: OwnerRule[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const pattern = parts[0];
    const owners = parts.slice(1).filter((o) => o.startsWith("@") || o.includes("@"));
    // Empty owner lists intentionally clear an earlier matching assignment.
    // Skip unsupported syntax rather than treating invalid owner text as a clear.
    if (
      pattern &&
      !pattern.startsWith("!") &&
      !pattern.includes("[") &&
      !pattern.includes("]") &&
      !pattern.includes("\\") &&
      (parts.length === 1 || owners.length > 0)
    ) {
      rules.push({ pattern, owners });
    }
  }
  return rules;
}

/** GitHub CODEOWNERS matching: slash anchoring, globstars, and directory rules. */
function patternMatches(pattern: string, filePath: string, isDirectory?: boolean): boolean {
  if (pattern === "*") return true;
  let p = pattern;
  const directoryOnly = p.endsWith("/");
  if (directoryOnly) p = p.slice(0, -1);
  // A slash at the start or in the middle roots the pattern at the repository.
  // A single directory name followed by a slash can match at any depth.
  const anchored = p.includes("/");
  if (p.startsWith("/")) p = p.slice(1);
  const segments = p.split("/");
  const body = segments
    .map((seg, index) => {
      if (seg === "**") return index < segments.length - 1 ? "(?:[^/]+/)*" : ".*";
      const single = seg
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]");
      return single + (index < segments.length - 1 ? "/" : "");
    })
    .join("");
  const head = anchored ? "^" : "(?:^|.*/)";
  // GitHub documents `docs/*` as matching direct files, not nested descendants.
  // Explicit directory rules and literal directory names include descendants.
  const tail =
    directoryOnly && isDirectory === false
      ? "/.*$"
      : directoryOnly || !/[*?]/.test(segments[segments.length - 1])
        ? "(?:/.*)?$"
        : "$";
  try {
    return new RegExp(`${head}${body}${tail}`).test(filePath);
  } catch {
    return false;
  }
}

/**
 * Owners for a path — the LAST matching rule wins (CODEOWNERS semantics).
 * Pass false for a known file so a directory-only pattern cannot match its name.
 * Omitting the kind preserves callers that query a bare directory path.
 */
export function ownersForPath(
  filePath: string,
  rules: OwnerRule[],
  isDirectory?: boolean
): string[] {
  let owners: string[] = [];
  for (const rule of rules) {
    if (patternMatches(rule.pattern, filePath, isDirectory)) owners = rule.owners;
  }
  return owners;
}

function topLevelDirs(files: Array<{ path: string; isDirectory: boolean }>): string[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const seg = f.path.split("/")[0];
    if (seg && f.path.includes("/")) dirs.add(seg);
  }
  return [...dirs].sort((a, b) => a.localeCompare(b));
}

/** Best-effort top committers from whatever git history is available. */
async function topCommitters(
  repoPath: string,
  limit: number
): Promise<Array<{ name: string; commits: number }>> {
  try {
    const { stdout } = await execFileAsync("git", ["shortlog", "-sn", "--no-merges", "HEAD"], {
      cwd: repoPath,
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    });
    return stdout
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => ({ name: m[2], commits: Number(m[1]) }))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function printReport(
  repoName: string,
  rules: OwnerRule[],
  defaultOwners: string[],
  areas: Array<{ dir: string; owners: string[] }>,
  allOwners: string[],
  committers: Array<{ name: string; commits: number }>
): void {
  console.log(chalk.bold("\n👥 Who Do I Ask?"));
  console.log(chalk.dim(`Repository: ${repoName}\n`));

  if (rules.length > 0) {
    console.log(
      chalk.bold("Default owners") +
        chalk.dim("  (CODEOWNERS `*`)  ") +
        (defaultOwners.length ? chalk.cyan(defaultOwners.join(" ")) : chalk.dim("none"))
    );
    console.log();

    console.log(chalk.bold("Ownership by area") + chalk.dim("  (owners of scanned files)"));
    for (const area of areas) {
      const who = area.owners.length ? chalk.cyan(area.owners.join(" ")) : chalk.dim("(unowned)");
      console.log(`  ${chalk.bold(area.dir.padEnd(16))} ${who}`);
    }
    console.log();

    console.log(chalk.bold("Maintainers") + chalk.dim(`  (${allOwners.length})`));
    console.log("  " + (allOwners.length ? allOwners.join(", ") : chalk.dim("none")));
    console.log();
  } else {
    console.log(chalk.yellow("No CODEOWNERS file found."));
    console.log(
      chalk.dim("Add .github/CODEOWNERS to declare who reviews which parts of the repo.\n")
    );
  }

  if (committers.length > 0) {
    console.log(chalk.bold("Top committers") + chalk.dim("  (from available git history)"));
    for (const c of committers) {
      console.log(`  ${chalk.green(String(c.commits).padStart(4))}  ${c.name}`);
    }
    console.log();
  }
}

/**
 * Run the standalone `bootcamp owners` command: clone/resolve the target repo,
 * parse its CODEOWNERS file, and answer "who do I ask?" — the default owners,
 * the union of file owners in each top-level area (last-match-wins per file), the full
 * maintainer set, and a best-effort list of top committers from the available
 * git history. Deterministic; never invokes the LLM.
 */
export async function runOwnersCommand(repoUrl: string, opts: OwnersCommandOptions): Promise<void> {
  await withResolvedRepo(repoUrl, opts, "Owners analysis failed", async (repoSource) => {
    const scan = await scanRepositoryFiles(
      repoSource.path,
      finiteOr(opts.maxFiles, 500, { min: 1 })
    );

    let codeownersContent: string | null = null;
    let codeownersPath: string | null = null;
    for (const loc of CODEOWNERS_LOCATIONS) {
      try {
        codeownersContent = await readFile(join(repoSource.path, loc), "utf-8");
        codeownersPath = loc;
        break;
      } catch {
        // try next location
      }
    }

    const rules = codeownersContent ? parseCodeowners(codeownersContent) : [];
    const defaultRule = [...rules].reverse().find((r) => r.pattern === "*");
    const defaultOwners = defaultRule?.owners ?? [];
    // Each area lists the union of owners actually assigned to scanned files.
    // A synthetic `src/` path cannot capture extension rules or nested overrides.
    const areaOwners = new Map<string, Set<string>>();
    for (const file of scan.files) {
      if (file.isDirectory || !file.path.includes("/")) continue;
      const dir = file.path.split("/")[0];
      const owners = areaOwners.get(dir) ?? new Set<string>();
      for (const owner of ownersForPath(file.path, rules, false)) owners.add(owner);
      areaOwners.set(dir, owners);
    }
    const areas = topLevelDirs(scan.files).map((dir) => ({
      dir,
      owners: [...(areaOwners.get(dir) ?? [])].sort((a, b) => a.localeCompare(b)),
    }));
    const allOwners = [...new Set(rules.flatMap((r) => r.owners))].sort((a, b) =>
      a.localeCompare(b)
    );
    const committers = await topCommitters(repoSource.path, 8);

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            repo: repoSource.repoInfo.fullName,
            codeownersPath,
            defaultOwners,
            maintainers: allOwners,
            rules,
            areas,
            topCommitters: committers,
          },
          null,
          2
        )
      );
    } else {
      printReport(repoSource.repoInfo.fullName, rules, defaultOwners, areas, allOwners, committers);
    }
  });
}
