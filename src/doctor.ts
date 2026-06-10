/**
 * Environment Doctor Module
 *
 * Diagnoses the local environment for running repo-bootcamp: Node.js version,
 * required CLIs (git), recommended tooling (GitHub CLI + auth), optional
 * extras (mermaid-cli for diagram rendering), and cache health.
 *
 * `evaluateDoctor` is pure and deterministic over an `EnvironmentSnapshot`, so
 * it is fully unit-testable. `gatherEnvironment` performs the impure IO.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { isMermaidCliAvailable } from "./diagrams.js";
import { getCacheDir, listCacheEntries } from "./cache.js";
import { formatBytes } from "./metrics.js";

const execFileAsync = promisify(execFile);

/** Minimum supported Node.js major version. */
export const MIN_NODE_MAJOR = 20;

/** Environment variables that can carry a GitHub/Copilot token. */
export const TOKEN_ENV_VARS = ["GITHUB_TOKEN", "GH_TOKEN", "COPILOT_TOKEN"];

/** Outcome of a single diagnostic check. */
export type CheckStatus = "ok" | "warn" | "fail" | "info";

/** How much a failing check matters. */
export type CheckSeverity = "required" | "recommended" | "optional";

/** A single diagnostic result. */
export interface DoctorCheck {
  id: string;
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  detail: string;
  remedy?: string;
}

/** Aggregate doctor result. */
export interface DoctorReport {
  checks: DoctorCheck[];
  /** True when no `required` check has failed. */
  ok: boolean;
  /** True when at least one check is a warning. */
  hasWarnings: boolean;
  counts: { ok: number; warn: number; fail: number; info: number };
}

/** A pure snapshot of the host environment, consumed by `evaluateDoctor`. */
export interface EnvironmentSnapshot {
  nodeVersion: string;
  platform: string;
  arch: string;
  gitVersion: string | null;
  ghVersion: string | null;
  /** null when gh is unavailable and auth could not be checked. */
  ghAuthenticated: boolean | null;
  tokenEnvVars: string[];
  mermaidAvailable: boolean;
  cacheDir: string;
  cacheEntryCount: number;
  cacheTotalBytes: number;
  cacheError: string | null;
}

/** Parse the major version from a Node version string like "v20.11.0". */
export function parseNodeMajor(version: string): number {
  const match = /v?(\d+)\./.exec(version.trim());
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
}

/**
 * Evaluate an environment snapshot into a structured, deterministic report.
 */
export function evaluateDoctor(env: EnvironmentSnapshot): DoctorReport {
  const checks: DoctorCheck[] = [];

  // Node.js (required)
  const major = parseNodeMajor(env.nodeVersion);
  const nodeOk = Number.isFinite(major) && major >= MIN_NODE_MAJOR;
  checks.push({
    id: "node",
    label: "Node.js runtime",
    severity: "required",
    status: nodeOk ? "ok" : "fail",
    detail: nodeOk
      ? `${env.nodeVersion} (>= ${MIN_NODE_MAJOR} required)`
      : `${env.nodeVersion} is below the required Node ${MIN_NODE_MAJOR}`,
    remedy: nodeOk ? undefined : `Install Node.js ${MIN_NODE_MAJOR} or newer (https://nodejs.org).`,
  });

  // Platform (info)
  checks.push({
    id: "platform",
    label: "Platform",
    severity: "optional",
    status: "info",
    detail: `${env.platform}/${env.arch}`,
  });

  // git (required)
  checks.push({
    id: "git",
    label: "git",
    severity: "required",
    status: env.gitVersion ? "ok" : "fail",
    detail: env.gitVersion ? env.gitVersion : "git was not found on PATH",
    remedy: env.gitVersion ? undefined : "Install git (https://git-scm.com/downloads).",
  });

  // GitHub CLI (recommended)
  checks.push({
    id: "gh",
    label: "GitHub CLI (gh)",
    severity: "recommended",
    status: env.ghVersion ? "ok" : "warn",
    detail: env.ghVersion ? env.ghVersion : "gh was not found on PATH",
    remedy: env.ghVersion
      ? undefined
      : "Install the GitHub CLI to enable Copilot auth and issue creation (https://cli.github.com).",
  });

  // Authentication (recommended): gh auth OR a token env var
  const tokenPresent = env.tokenEnvVars.length > 0;
  const authed = env.ghAuthenticated === true || tokenPresent;
  let authDetail: string;
  if (env.ghAuthenticated === true) {
    authDetail = "Authenticated via GitHub CLI";
  } else if (tokenPresent) {
    authDetail = `Token provided via ${env.tokenEnvVars.join(", ")}`;
  } else if (env.ghVersion) {
    authDetail = "Not authenticated (gh is installed but not logged in)";
  } else {
    authDetail = "No GitHub authentication detected";
  }
  checks.push({
    id: "auth",
    label: "Copilot / GitHub auth",
    severity: "recommended",
    status: authed ? "ok" : "warn",
    detail: authDetail,
    remedy: authed
      ? undefined
      : `Run \`gh auth login\` or set one of ${TOKEN_ENV_VARS.join(", ")}.`,
  });

  // mermaid-cli (optional)
  checks.push({
    id: "mermaid",
    label: "mermaid-cli (mmdc)",
    severity: "optional",
    status: env.mermaidAvailable ? "ok" : "info",
    detail: env.mermaidAvailable
      ? "Available — diagrams can be rendered to SVG/PNG"
      : "Not installed (optional; only needed to render diagrams to images)",
    remedy: env.mermaidAvailable
      ? undefined
      : "Optional: `npm i -g @mermaid-js/mermaid-cli` to render diagrams.",
  });

  // Cache (info / warn on error)
  if (env.cacheError) {
    checks.push({
      id: "cache",
      label: "Analysis cache",
      severity: "optional",
      status: "warn",
      detail: `Could not read cache at ${env.cacheDir}: ${env.cacheError}`,
      remedy: "Check directory permissions or run `bootcamp cache clear`.",
    });
  } else {
    checks.push({
      id: "cache",
      label: "Analysis cache",
      severity: "optional",
      status: "info",
      detail: `${env.cacheEntryCount} entr${env.cacheEntryCount === 1 ? "y" : "ies"}, ${formatBytes(
        env.cacheTotalBytes
      )} at ${env.cacheDir}`,
    });
  }

  const counts = { ok: 0, warn: 0, fail: 0, info: 0 };
  for (const check of checks) {
    counts[check.status] += 1;
  }
  const ok = !checks.some((c) => c.severity === "required" && c.status === "fail");
  const hasWarnings = checks.some((c) => c.status === "warn");

  return { checks, ok, hasWarnings, counts };
}

const STATUS_GLYPH: Record<CheckStatus, string> = {
  ok: "✓",
  warn: "!",
  fail: "✗",
  info: "·",
};

/**
 * Render a doctor report as plain, portable text (no color codes).
 */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push("repo-bootcamp environment check");
  lines.push("");
  for (const check of report.checks) {
    const glyph = STATUS_GLYPH[check.status];
    lines.push(`  [${glyph}] ${check.label}: ${check.detail}`);
    if (check.remedy && (check.status === "fail" || check.status === "warn")) {
      lines.push(`      → ${check.remedy}`);
    }
  }
  lines.push("");
  lines.push(
    `Summary: ${report.counts.ok} ok, ${report.counts.warn} warning(s), ${report.counts.fail} failure(s)`
  );
  lines.push(
    report.ok
      ? "All required checks passed — you're ready to run bootcamp."
      : "One or more required checks failed — see remedies above."
  );
  return lines.join("\n");
}

async function tryExec(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Gather a real environment snapshot from the host (impure IO).
 */
export async function gatherEnvironment(): Promise<EnvironmentSnapshot> {
  const [gitRaw, ghRaw, mermaidAvailable] = await Promise.all([
    tryExec("git", ["--version"]),
    tryExec("gh", ["--version"]),
    isMermaidCliAvailable().catch(() => false),
  ]);

  let ghAuthenticated: boolean | null = null;
  if (ghRaw) {
    const auth = await tryExec("gh", ["auth", "status"]);
    ghAuthenticated = auth !== null;
  }

  // gh --version prints multiple lines; keep the first informative one.
  const ghVersion = ghRaw ? ghRaw.split("\n")[0].trim() : null;
  const gitVersion = gitRaw ? gitRaw.split("\n")[0].trim() : null;

  const tokenEnvVars = TOKEN_ENV_VARS.filter((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.trim().length > 0;
  });

  const cacheDir = getCacheDir();
  let cacheEntryCount = 0;
  let cacheTotalBytes = 0;
  let cacheError: string | null = null;
  try {
    const entries = await listCacheEntries();
    cacheEntryCount = entries.length;
    cacheTotalBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  } catch (error: unknown) {
    cacheError = (error as Error).message;
  }

  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    gitVersion,
    ghVersion,
    ghAuthenticated,
    tokenEnvVars,
    mermaidAvailable,
    cacheDir,
    cacheEntryCount,
    cacheTotalBytes,
    cacheError,
  };
}
