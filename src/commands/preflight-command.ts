import { execFile } from "child_process";
import { tmpdir } from "os";
import { realpath } from "fs/promises";
import { isAbsolute, relative, sep } from "path";
import { promisify } from "util";

import chalk from "chalk";

import { readContainedFile } from "../fs-safe.js";
import { parseJsonc } from "../jsonc.js";
import { scanTomlMetadata } from "../toml-metadata-scan.js";
import { withResolvedRepo } from "./_shared.js";
import { normalizeScanScope } from "../services/config-resolution.js";
import { resolveScanRoot } from "../services/scan-scope.js";

const execFileAsync = promisify(execFile);

/** Options accepted by the `bootcamp preflight` command. */
export interface PreflightCommandOptions {
  branch?: string;
  /** Inspect declarations only in this contained repository directory. */
  subdir?: string;
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
  kind?: "rustup" | "dotnet";
  dotnet?: DotnetSettings;
  problem?: string;
}

const DOTNET_ROLL_FORWARD = [
  "disable",
  "patch",
  "feature",
  "minor",
  "major",
  "latestPatch",
  "latestFeature",
  "latestMinor",
  "latestMajor",
] as const;
type DotnetRollForward = (typeof DOTNET_ROLL_FORWARD)[number];
interface DotnetSettings {
  version?: string;
  rollForward: DotnetRollForward;
  allowPrerelease: boolean;
}

function isDotnetRollForward(value: unknown): value is DotnetRollForward {
  return typeof value === "string" && DOTNET_ROLL_FORWARD.some((policy) => policy === value);
}

interface PreflightResult {
  tool: string;
  required: string;
  source: string;
  installed: string | null;
  status: CheckStatus;
  remedy?: string;
}

/** The subset of package.json fields preflight inspects. */
interface PackageManifest {
  engines?: Record<string, string>;
  packageManager?: unknown;
}

async function readJson(repoPath: string, name: string): Promise<PackageManifest | null> {
  try {
    return JSON.parse(await readContainedFile(repoPath, name)) as PackageManifest;
  } catch {
    return null;
  }
}

async function readText(repoPath: string, name: string): Promise<string | null> {
  try {
    return (await readContainedFile(repoPath, name)).trim();
  } catch {
    return null;
  }
}

function pmUrl(name: string): string {
  if (name === "pnpm") return "https://pnpm.io/installation";
  if (name === "yarn") return "https://yarnpkg.com/getting-started/install";
  return "https://www.npmjs.com/get-npm";
}

function rustRequirement(content: string, source: string): ToolRequirement {
  let channel: string | undefined;
  let problem: string | undefined;
  if (source === "rust-toolchain" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(content)) {
    channel = content;
  } else {
    const metadata = scanTomlMetadata(content);
    const toolchain = metadata.root.get("toolchain");
    if (metadata.complete && toolchain instanceof Map) {
      const value = toolchain.get("channel");
      if (toolchain.has("path")) {
        problem =
          "A custom toolchain path cannot be verified without running repository-selected code.";
      } else if (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
        channel = value;
      }
    }
  }
  return {
    tool: "Rust",
    commands: ["rustup"],
    versionArgs: ["toolchain", "list"],
    required: channel ?? "unverified",
    source,
    installUrl: "https://rustup.rs/",
    kind: "rustup",
    problem: channel
      ? undefined
      : (problem ?? "The Rust toolchain declaration is invalid or unsupported."),
  };
}

function dotnetRequirement(content: string): ToolRequirement | null {
  const parsed = parseJsonc(content);
  const obj = isRecord(parsed) ? parsed : null;
  if (obj && obj.sdk === undefined) return null;
  const sdk = obj && isRecord(obj.sdk) ? obj.sdk : null;
  const version = sdk?.version;
  const rollForward = sdk?.rollForward ?? "patch";
  const allowPrerelease = sdk?.allowPrerelease ?? true;
  let problem: string | undefined;
  if (!sdk) {
    problem = "The global.json SDK declaration is invalid.";
  } else if (sdk.paths !== undefined) {
    problem =
      "Custom SDK search paths cannot be verified without running repository-selected code.";
  } else if (
    (version !== undefined && (typeof version !== "string" || !parseDotnetVersion(version))) ||
    !isDotnetRollForward(rollForward) ||
    (version === undefined && sdk.rollForward !== undefined && rollForward !== "latestMajor") ||
    typeof allowPrerelease !== "boolean"
  ) {
    problem = "The global.json SDK version or roll-forward policy is invalid or unsupported.";
  }
  return {
    tool: ".NET SDK",
    commands: ["dotnet"],
    versionArgs: ["--list-sdks"],
    required: typeof version === "string" ? version : "any installed SDK",
    source: "global.json",
    installUrl: "https://dotnet.microsoft.com/download",
    kind: "dotnet",
    dotnet:
      !problem && isDotnetRollForward(rollForward) && typeof allowPrerelease === "boolean"
        ? {
            version: typeof version === "string" ? version : undefined,
            rollForward,
            allowPrerelease,
          }
        : undefined,
    problem,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  // rustup gives the legacy file precedence when both names exist.
  const rustLegacy = await readText(repoPath, "rust-toolchain");
  const rustToml = rustLegacy === null ? await readText(repoPath, "rust-toolchain.toml") : null;
  if (rustLegacy !== null || rustToml !== null) {
    reqs.push(
      rustRequirement(
        rustLegacy ?? rustToml ?? "",
        rustLegacy !== null ? "rust-toolchain" : "rust-toolchain.toml"
      )
    );
  }

  const globalJson = await readText(repoPath, "global.json");
  if (globalJson !== null) {
    const dotnet = dotnetRequirement(globalJson);
    if (dotnet) reqs.push(dotnet);
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
 * bare/exact versions, AND comparator sets, and OR alternatives. Returns null
 * when the requirement can't be compared deterministically (e.g. `lts/iron`, `stable`).
 */
export function satisfiesVersion(required: string, installed: string): boolean | null {
  const inst = parseVersion(installed);
  if (inst.length === 0) return null;

  // Node engine ranges join comparator sets with ||; within a set, both
  // whitespace (npm) and commas (Python) mean AND. Parse every comparator so
  // an unsupported suffix or alternative never silently becomes a valid pin.
  const alternatives = required.trim().split("||");
  let satisfied = false;
  for (const alternative of alternatives) {
    const groups = alternative.split(",").map((group) => group.trim());
    if (groups.some((group) => !group)) return null;
    let matches = true;
    for (const group of groups) {
      const constraints = group.replace(/(>=|>|<=|<|\^|~|=)\s+(?=v?\d)/g, "$1").split(/\s+/);
      for (const constraint of constraints) {
        const single = satisfiesSingleConstraint(constraint, inst);
        if (single === null) return null;
        matches = matches && single;
      }
    }
    satisfied = satisfied || matches;
  }
  return satisfied;
}

/** Evaluate one parsed-version constraint against an already-parsed install. */
function satisfiesSingleConstraint(required: string, inst: number[]): boolean | null {
  const opMatch = required.trim().match(/^(>=|>|<=|<|\^|~|=)?\s*v?(\d+(?:\.\d+){0,2})$/);
  if (!opMatch) return null;
  const op = opMatch[1] || "=";
  const hasMinor = opMatch[2].includes(".");
  const hasPatch = opMatch[2].split(".").length === 3;
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
    case "^": {
      // Caret allows changes that don't modify the left-most non-zero component.
      // For a 0-major requirement that means the range narrows to the next
      // non-zero component: `^0.2.3` is `>=0.2.3 <0.3.0`, `^0.0.3` is `0.0.3`.
      if (c < 0) return false; // below the requirement floor
      if (req[0] !== 0) return inst[0] === req[0]; // ^1.2.3 => >=1.2.3 <2.0.0
      if (req[1] !== 0) return inst[0] === 0 && inst[1] === req[1]; // ^0.2.3 => >=0.2.3 <0.3.0
      if (req[2] !== 0) return inst[0] === 0 && inst[1] === 0 && inst[2] === req[2]; // ^0.0.3 => 0.0.3
      return inst[0] === 0; // ^0 / ^0.0.0 — anything in the 0.x major
    }
    case "~":
      // ~1.2.3 => >=1.2.3 <1.3.0; ~1 => >=1.0.0 <2.0.0. Lock the major, and the
      // minor too when the requirement named one, then require >= the floor.
      return inst[0] === req[0] && (!hasMinor || inst[1] === req[1]) && c >= 0;
    default:
      // Complete pins require equality; omitted components remain flexible.
      return (
        inst[0] === req[0] && (!hasMinor || inst[1] === req[1]) && (!hasPatch || inst[2] === req[2])
      );
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
    // The go.mod go directive declares a minimum, unlike a tool-version pin.
    const constraint =
      req.tool === "Go" && req.source === "go.mod" ? `>=${req.required}` : req.required;
    const sat = constraint === "*" ? true : satisfiesVersion(constraint, installed);
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

interface DotnetVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseDotnetVersion(value: string): DotnetVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d{3,})(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/.exec(value);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch, prerelease: match[4]?.split(".") ?? [] };
}

function compareDotnetVersions(a: DotnetVersion, b: DotnetVersion): number {
  const numeric = compare([a.major, a.minor, a.patch], [b.major, b.minor, b.patch]);
  if (numeric !== 0) return numeric;
  if (!a.prerelease.length || !b.prerelease.length) {
    return Math.sign(b.prerelease.length - a.prerelease.length);
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === undefined || right === undefined) return left === undefined ? -1 : 1;
    if (left === right) continue;
    const leftNumber = /^\d+$/.test(left);
    const rightNumber = /^\d+$/.test(right);
    if (leftNumber && rightNumber) {
      const l = BigInt(left);
      const r = BigInt(right);
      if (l === r) continue;
      return l < r ? -1 : 1;
    }
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

function dotnetMatches(settings: DotnetSettings, installed: DotnetVersion): boolean {
  if (!settings.allowPrerelease && installed.prerelease.length) return false;
  if (!settings.version) return true;
  const required = parseDotnetVersion(settings.version);
  if (!required) return false;
  const order = compareDotnetVersions(installed, required);
  if (settings.rollForward === "disable") return order === 0;
  if (order < 0) return false;
  switch (settings.rollForward) {
    case "patch":
    case "latestPatch":
      return (
        installed.major === required.major &&
        installed.minor === required.minor &&
        Math.floor(installed.patch / 100) === Math.floor(required.patch / 100)
      );
    case "feature":
    case "latestFeature":
      return installed.major === required.major && installed.minor === required.minor;
    case "minor":
    case "latestMinor":
      return installed.major === required.major;
    case "major":
    case "latestMajor":
      return true;
  }
}

function compareDotnetSelection(
  a: DotnetVersion,
  b: DotnetVersion,
  settings: DotnetSettings
): number {
  const required = settings.version ? parseDotnetVersion(settings.version) : null;
  if (required && settings.rollForward === "patch") {
    const aExact = compareDotnetVersions(a, required) === 0;
    const bExact = compareDotnetVersions(b, required) === 0;
    if (aExact !== bExact) return aExact ? -1 : 1;
  }
  if (required && ["feature", "minor", "major"].includes(settings.rollForward)) {
    if (settings.rollForward === "major" && a.major !== b.major) return a.major - b.major;
    if (settings.rollForward !== "feature" && a.minor !== b.minor) return a.minor - b.minor;
    const aBand = Math.floor(a.patch / 100);
    const bBand = Math.floor(b.patch / 100);
    if (aBand !== bBand) return aBand - bBand;
  }
  return compareDotnetVersions(b, a);
}

function resultWithStatus(
  req: ToolRequirement,
  installed: string | null,
  status: CheckStatus,
  remedy?: string
): PreflightResult {
  return {
    tool: req.tool,
    required: req.required,
    source: req.source,
    installed,
    status,
    remedy,
  };
}

/** Inventory toolchains without running code selected by the target repository. */
async function evaluateInventory(req: ToolRequirement): Promise<PreflightResult> {
  if (req.problem) return resultWithStatus(req, null, "unknown", req.problem);
  try {
    const { stdout } = await execFileAsync(req.commands[0], req.versionArgs, {
      cwd: tmpdir(),
      timeout: 5000,
      env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" },
    });
    if (req.kind === "rustup") {
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const names = lines.map((line) => line.split(/\s+/)[0]);
      const defaultLine = lines.find((line) => /\bdefault\b/.test(line));
      const host = defaultLine?.match(/-(?:x86_64|i686|aarch64|armv7|arm)-[^\s]+/)?.[0];
      const exact = names.find(
        (name) => name === req.required || (host && name === req.required + host)
      );
      if (exact) return resultWithStatus(req, exact, "ok");
      if (names.some((name) => name.startsWith(`${req.required}-`))) {
        return resultWithStatus(
          req,
          null,
          "unknown",
          "The installed Rust toolchain's host could not be verified."
        );
      }
      return resultWithStatus(
        req,
        null,
        "missing",
        `Install the ${req.required} Rust toolchain with rustup (${req.installUrl}).`
      );
    }
    const settings = req.dotnet;
    if (!settings)
      return resultWithStatus(req, null, "unknown", "SDK policy could not be verified.");
    const versions = stdout
      .split(/\r?\n/)
      .map((line) => /^(\S+)\s+\[/.exec(line)?.[1])
      .filter((version): version is string => version !== undefined)
      .map((version) => ({ text: version, parsed: parseDotnetVersion(version) }))
      .filter(
        (version): version is { text: string; parsed: DotnetVersion } => version.parsed !== null
      );
    if (stdout.trim() && versions.length === 0) {
      return resultWithStatus(
        req,
        null,
        "unknown",
        "The installed SDK list could not be interpreted."
      );
    }
    const match = versions
      .filter((version) => dotnetMatches(settings, version.parsed))
      .sort((a, b) => compareDotnetSelection(a.parsed, b.parsed, settings))[0];
    if (match) return resultWithStatus(req, match.text, "ok");
    const available =
      versions.sort((a, b) => compareDotnetVersions(b.parsed, a.parsed))[0]?.text ?? null;
    return resultWithStatus(
      req,
      available,
      available ? "mismatch" : "missing",
      `Install a compatible .NET SDK (${req.installUrl}).`
    );
  } catch (error: unknown) {
    if (isRecord(error) && error.code === "ENOENT" && req.kind === "dotnet") {
      return resultWithStatus(req, null, "missing", `Install the .NET SDK (${req.installUrl}).`);
    }
    return resultWithStatus(
      req,
      null,
      "unknown",
      `Could not inspect installed ${req.tool} toolchains; check them manually.`
    );
  }
}

const GLYPH: Record<CheckStatus, string> = {
  ok: "✅",
  mismatch: "⚠️",
  missing: "❌",
  unknown: "•",
};

function printReport(results: PreflightResult[], repoName: string, subdir?: string): void {
  console.log(chalk.bold("\n🚀 Preflight"));
  console.log(chalk.dim(`Repository: ${repoName}`));
  if (subdir) console.log(chalk.dim(`Package directory: ${subdir} (local declarations only)`));
  console.log(chalk.dim("Your machine vs. the target repo's declared toolchain\n"));

  for (const r of results) {
    const have = r.installed
      ? `local ${r.installed}`
      : r.status === "unknown"
        ? chalk.yellow("not verified")
        : chalk.red("not installed");
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
 * `go.mod`, Rust toolchain files and .NET `global.json`), and check the LOCAL
 * machine against each — printing a per-tool
 * status with a remedy. Distinct from `doctor`, which checks whether your
 * machine can run bootcamp itself. With `--check`, exits non-zero when any
 * declared tool is missing or mismatched.
 */
export async function runPreflightCommand(
  repoUrl: string,
  opts: PreflightCommandOptions
): Promise<void> {
  const scope = { subdir: opts.subdir };
  try {
    // Reject absolute roots before normalization can trim their final separator.
    if (scope.subdir && isAbsolute(scope.subdir.trim())) {
      throw new Error("Invalid subdir: use a relative path within the repository.");
    }
    normalizeScanScope(scope);
  } catch (error: unknown) {
    console.error(
      chalk.red(`Preflight failed: ${error instanceof Error ? error.message : String(error)}`)
    );
    process.exit(1);
    return;
  }
  await withResolvedRepo(repoUrl, opts, "Preflight failed", async (repoSource) => {
    const selectedRoot = scope.subdir
      ? await resolveScanRoot(repoSource.path, scope.subdir)
      : repoSource.path;
    // Canonical paths identify the actual declaration, including contained aliases.
    const subdir = scope.subdir
      ? relative(await realpath(repoSource.path), selectedRoot)
          .split(sep)
          .join("/") || "."
      : undefined;
    // A selected package is a strict evidence boundary. In particular, an outer
    // package manager identity does not establish a version requirement here.
    const reqs = await gatherRequirements(selectedRoot);
    const results: PreflightResult[] = [];
    for (const req of reqs) {
      if (req.kind) {
        results.push(await evaluateInventory(req));
      } else {
        const installed = await probeVersion(req.commands, req.versionArgs);
        results.push(evaluate(req, installed));
      }
    }

    if (subdir && subdir !== ".") {
      for (const result of results) result.source = `${subdir}/${result.source}`;
    }

    const failing = results.filter((r) => r.status === "missing" || r.status === "mismatch").length;

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            repo: repoSource.repoInfo.fullName,
            ...(subdir ? { subdir, scope: "directory" } : {}),
            ok: failing === 0,
            checks: results,
          },
          null,
          2
        )
      );
    } else if (results.length === 0) {
      if (subdir) console.log(chalk.dim(`Package directory: ${subdir} (local declarations only)`));
      console.log(chalk.yellow("\n🚀 No declared toolchain requirements detected."));
      console.log(
        chalk.dim(
          "Looked for Node, package-manager, Python, Go, Rust and .NET toolchain declarations.\n"
        )
      );
    } else {
      printReport(results, repoSource.repoInfo.fullName, subdir);
    }

    if (opts.check && failing > 0) {
      if (!opts.json) {
        console.error(
          chalk.red(`❌ ${failing} toolchain requirement${failing === 1 ? "" : "s"} not satisfied.`)
        );
      }
      return 1;
    }

    return 0;
  });
}
