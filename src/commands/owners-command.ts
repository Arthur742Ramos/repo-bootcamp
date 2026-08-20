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
    if (pattern && owners.length > 0) rules.push({ pattern, owners });
  }
  return rules;
}

/** Pragmatic CODEOWNERS (gitignore-style) pattern match against a path. */
function patternMatches(pattern: string, filePath: string): boolean {
  if (pattern === "*") return true;
  let p = pattern;
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  if (p.endsWith("/")) p = p.slice(0, -1);
  const body = p
    .split("/")
    .map((seg) =>
      seg === "**"
        ? ".*"
        : seg
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, "[^/]*")
            .replace(/\?/g, "[^/]")
    )
    .join("/");
  const head = anchored ? "^" : "(?:^|.*/)";
  try {
    return new RegExp(`${head}${body}(?:/.*)?$`).test(filePath);
  } catch {
    return false;
  }
}

/** Owners for a path — the LAST matching rule wins (CODEOWNERS semantics). */
export function ownersForPath(filePath: string, rules: OwnerRule[]): string[] {
  let owners: string[] = [];
  for (const rule of rules) {
    if (patternMatches(rule.pattern, filePath)) owners = rule.owners;
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

    console.log(chalk.bold("Ownership by area"));
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
 * the owners responsible for each top-level area (last-match-wins), the full
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
    // Resolve each area against a directory path (trailing slash) so the common
    // `/packages/** @team` CODEOWNERS idiom matches — patternMatches anchors a
    // `**` rule with a `/` separator, which a bare dir name lacks. A `/dir` or
    // `/dir/` rule still matches the trailing-slash form too.
    const areas = topLevelDirs(scan.files).map((dir) => ({
      dir,
      owners: ownersForPath(`${dir}/`, rules),
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
