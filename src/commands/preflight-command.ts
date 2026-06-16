import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

import chalk from "chalk";

import { resolveRepo, type RepoSource } from "../repo-resolver.js";

const execFileAsync = promisify(execFile);

/** Options accepted by the `bootcamp preflight` command. */
export interface PreflightCommandOptions {
  branch?: string;
  /** Emit the report as JSON for machine consumption. */
  json?: boolean;
  /** Exit non-zero if any declared tool is missing or mismatched (CI gate). */
  check?: boolean;
  /** Keep the temporary clone (remote repos only). */
  keepTemp?: boolean;
  verbose?: boolean;
}

type CheckStatus = "ok" | "mismatch" | "missing" | "unknown";

interface ToolRequirement {
  tool: string;
  /** Local command candidates to probe (first that works wins). */
  commands: string[];
  versionArgs: string[];
  required: string;
  source: string;
  installUrl: string;
}

interface PreflightResult {
  tool: string;
  required: string;
  source: string;
  installed: string | null;
  status: CheckStatus;
  remedy?: string;
}

async function readJson(repoPath: string, name: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await readFile(join(repoPath, name), "utf-8")) as Record<string, any>;
  } catch {
    return null;
  }
}

async function readText(repoPath: string, name: string): Promise<string | null> {
  try {
    return (await readFile(join(repoPath, name), "utf-8")).trim();
  } catch {
    return null;
  }
}

function pmUrl(name: string): string {
  if (name === "pnpm") return "https://pnpm.io/installation";
  if (name === "yarn") return "https://yarnpkg.com/getting-started/install";
  return "https://www.npmjs.com/get-npm";
}

/** Collect declared toolchain requirements from the target repo. */
export async function gatherRequirements(repoPath: string): Promise<ToolRequirement[]> {
  const reqs: ToolRequirement[] = [];
  const pkg = await readJson(repoPath, "package.json");

  // Node — engines.node wins, else .nvmrc / .node-version.
  const enginesNode = pkg?.engines?.node;
  const nvmrc = await readText(repoPath, ".nvmrc");
  const nodeVersionFile = await readText(repoPath, ".node-version");
  const nodeReq = enginesNode || nvmrc || nodeVersionFile;
  if (nodeReq) {
    reqs.push({
      tool: "Node.js",
      commands: ["node"],
      versionArgs: ["--version"],
      required: nodeReq,
      source: enginesNode ? "package.json engines.node" : nvmrc ? ".nvmrc" : ".node-version",
      installUrl: "https://nodejs.org",
    });
  }

  // Package manager — Corepack `packageManager`, else engines.<pm>.
  if (typeof pkg?.packageManager === "string") {
    const [name, ver] = pkg.packageManager.split("@");
    if (name) {
      reqs.push({
        tool: name,
        commands: [name],
        versionArgs: ["--version"],
        required: (ver ?? "").split("+")[0] || "*",
        source: "package.json packageManager",
        installUrl: pmUrl(name),
      });
    }
  } else if (pkg?.engines) {
    for (const pm of ["pnpm", "yarn", "npm"]) {
      if (pkg.engines[pm]) {
        reqs.push({
          tool: pm,
          commands: [pm],
          versionArgs: ["--version"],
          required: pkg.engines[pm],
          source: `package.json engines.${pm}`,
          installUrl: pmUrl(pm),
        });
      }
    }
  }

  // Python — pyproject requires-python / poetry python, else .python-version.
  const pyproject = await readText(repoPath, "pyproject.toml");
  const pythonVersionFile = await readText(repoPath, ".python-version");
  let pyReq: string | null = null;
  let pySource = "";
  if (pyproject) {
    const m =
      pyproject.match(/requires-python\s*=\s*["']([^"']+)["']/) ||
      pyproject.match(/^python\s*=\s*["']([^"']+)["']/m);
    if (m) {
      pyReq = m[1];
      pySource = "pyproject.toml";
    }
  }
  if (!pyReq && pythonVersionFile) {
    pyReq = pythonVersionFile;
    pySource = ".python-version";
  }
  if (pyReq) {
    reqs.push({
      tool: "Python",
      commands: ["python3", "python"],
      versionArgs: ["--version"],
      required: pyReq,
      source: pySource,
      installUrl: "https://www.python.org/downloads/",
    });
  }

  // Go — the `go` directive in go.mod.
  const gomod = await readText(repoPath, "go.mod");
  const goMatch = gomod?.match(/^go\s+(\d+\.\d+(?:\.\d+)?)/m);
  if (goMatch) {
    reqs.push({
      tool: "Go",
      commands: ["go"],
      versionArgs: ["version"],
      required: goMatch[1],
      source: "go.mod",
      installUrl: "https://go.dev/dl/",
    });
  }

  return reqs;
}

/** Parse `[major, minor, patch]` out of an arbitrary version string. */
function parseVersion(s: string): number[] {
  const m = s.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return [];
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/**
 * Pragmatic semver satisfaction: handles `>=`, `>`, `<=`, `<`, `^`, `~`, and
 * bare/exact versions. Returns null when the requirement can't be compared
 * deterministically (e.g. `lts/iron`, `stable`).
 */
export function satisfiesVersion(required: string, installed: string): boolean | null {
  const inst = parseVersion(installed);
  if (inst.length === 0) return null;
  const opMatch = required.trim().match(/^(>=|>|<=|<|\^|~|=)?\s*v?(\d+(?:\.\d+){0,2})/);
  if (!opMatch) return null;
  const op = opMatch[1] || "=";
  const hasMinor = opMatch[2].includes(".");
  const req = parseVersion(opMatch[2]);
  const c = compare(inst, req);
  switch (op) {
    case ">=":
      return c >= 0;
    case ">":
      return c > 0;
    case "<=":
      return c <= 0;
    case "<":
      return c < 0;
    case "^":
      return inst[0] === req[0] && c >= 0;
    case "~":
      return inst[0] === req[0] && (inst[1] ?? 0) >= (req[1] ?? 0);
    default:
      // Bare/exact: same major (and minor must be at least the requested one).
      return inst[0] === req[0] && (!hasMinor || (inst[1] ?? 0) >= (req[1] ?? 0));
  }
}

/** Probe a local tool's version, trying each candidate command. */
async function probeVersion(commands: string[], args: string[]): Promise<string | null> {
  for (const command of commands) {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, { timeout: 5000 });
      const out = `${stdout || ""}${stderr || ""}`.trim();
      const m = out.match(/(\d+\.\d+(?:\.\d+)?)/);
      if (m) return m[1];
    } catch {
      // try next candidate
    }
  }
  return null;
}

function evaluate(req: ToolRequirement, installed: string | null): PreflightResult {
  let status: CheckStatus;
  if (installed === null) status = "missing";
  else {
    const sat = req.required === "*" ? true : satisfiesVersion(req.required, installed);
    status = sat === true ? "ok" : sat === false ? "mismatch" : "unknown";
  }
  const remedy =
    status === "missing"
      ? `Install ${req.tool} ${req.required} (${req.installUrl}).`
      : status === "mismatch"
        ? `Switch to ${req.tool} ${req.required} (have ${installed}) — ${req.installUrl}.`
        : undefined;
  return { tool: req.tool, required: req.required, source: req.source, installed, status, remedy };
}

const GLYPH: Record<CheckStatus, string> = { ok: "✅", mismatch: "⚠️", missing: "❌", unknown: "•" };

function printReport(results: PreflightResult[], repoName: string): void {
  console.log(chalk.bold("\n🚀 Preflight"));
  console.log(chalk.dim(`Repository: ${repoName}`));
  console.log(chalk.dim("Your machine vs. the target repo's declared toolchain\n"));

  for (const r of results) {
    const have = r.installed ? `local ${r.installed}` : chalk.red("not installed");
    console.log(
      `  ${GLYPH[r.status]} ${chalk.bold(r.tool.padEnd(10))} ` +
        chalk.dim(`requires ${r.required} (${r.source})`) +
        `  ${have}`
    );
    if (r.remedy) {
      console.log(chalk.dim(`      → ${r.remedy}`));
    }
  }
  console.log();
}

/**
 * Run the standalone `bootcamp preflight` command: clone/resolve the target
 * repo, read its declared toolchain (Node `engines`/`.nvmrc`/`.node-version`,
 * Corepack `packageManager`, Python `requires-python`/`.python-version`, Go
 * `go.mod`), and check the LOCAL machine against each — printing a per-tool
 * status with a remedy. Distinct from `doctor`, which checks whether your
 * machine can run bootcamp itself. With `--check`, exits non-zero when any
 * declared tool is missing or mismatched.
 */
export async function runPreflightCommand(
  repoUrl: string,
  opts: PreflightCommandOptions
): Promise<void> {
  let repoSource: RepoSource;
  try {
    repoSource = await resolveRepo(repoUrl, process.cwd(), opts.branch || undefined);
  } catch (error: unknown) {
    console.error(
      chalk.red(`Failed to resolve repository: ${error instanceof Error ? error.message : String(error)}`)
    );
    process.exit(1);
    return;
  }

  let exitCode = 0;
  try {
    const reqs = await gatherRequirements(repoSource.path);
    const results: PreflightResult[] = [];
    for (const req of reqs) {
      const installed = await probeVersion(req.commands, req.versionArgs);
      results.push(evaluate(req, installed));
    }

    const failing = results.filter((r) => r.status === "missing" || r.status === "mismatch").length;

    if (opts.json) {
      console.log(
        JSON.stringify(
          { repo: repoSource.repoInfo.fullName, ok: failing === 0, checks: results },
          null,
          2
        )
      );
    } else if (results.length === 0) {
      console.log(chalk.yellow("\n🚀 No declared toolchain requirements detected."));
      console.log(
        chalk.dim(
          "Looked for engines.node, .nvmrc, .node-version, packageManager, requires-python, .python-version, and go.mod.\n"
        )
      );
    } else {
      printReport(results, repoSource.repoInfo.fullName);
    }

    if (opts.check && failing > 0) {
      if (!opts.json) {
        console.error(
          chalk.red(`❌ ${failing} toolchain requirement${failing === 1 ? "" : "s"} not satisfied.`)
        );
      }
      exitCode = 1;
    }
  } catch (error: unknown) {
    console.error(
      chalk.red(`Preflight failed: ${error instanceof Error ? error.message : String(error)}`)
    );
    exitCode = 1;
  } finally {
    if (opts.keepTemp && !repoSource.isLocal) {
      console.log(chalk.gray(`Temporary clone kept at: ${repoSource.path}`));
    } else {
      await repoSource.cleanup();
    }
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
