/**
 * `bootcamp doctor` command.
 *
 * Runs environment diagnostics and prints either a colorized human report or a
 * stable JSON payload (`--json`). Exits with code 1 when a required check
 * fails so it can gate CI. The core logic lives in `src/doctor.ts`; this module
 * handles presentation and process wiring, with injectable dependencies so it
 * can be unit-tested without spawning real processes.
 */

import chalk from "chalk";

import {
  type DoctorCheck,
  type DoctorReport,
  type EnvironmentSnapshot,
  evaluateDoctor,
  formatDoctorReport,
  gatherEnvironment,
} from "../doctor.js";

export interface DoctorCommandOptions {
  json?: boolean;
}

export interface DoctorCommandDeps {
  gather?: () => Promise<EnvironmentSnapshot>;
  log?: (message: string) => void;
  exit?: (code: number) => void;
}

interface DoctorJson {
  ok: boolean;
  hasWarnings: boolean;
  counts: DoctorReport["counts"];
  checks: DoctorCheck[];
  environment: EnvironmentSnapshot;
}

/** Build the machine-readable payload for `--json`. */
export function buildDoctorJson(report: DoctorReport, env: EnvironmentSnapshot): DoctorJson {
  return {
    ok: report.ok,
    hasWarnings: report.hasWarnings,
    counts: report.counts,
    checks: report.checks,
    environment: env,
  };
}

const STATUS_COLOR: Record<DoctorCheck["status"], (text: string) => string> = {
  ok: chalk.green,
  warn: chalk.yellow,
  fail: chalk.red,
  info: chalk.gray,
};

const STATUS_GLYPH: Record<DoctorCheck["status"], string> = {
  ok: "✓",
  warn: "!",
  fail: "✗",
  info: "·",
};

/** Render a colorized human report for the terminal. */
export function colorizeReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(chalk.cyan.bold("repo-bootcamp environment check"));
  lines.push("");
  for (const check of report.checks) {
    const color = STATUS_COLOR[check.status];
    lines.push(`  ${color(STATUS_GLYPH[check.status])} ${chalk.white(check.label)}: ${chalk.dim(check.detail)}`);
    if (check.remedy && (check.status === "fail" || check.status === "warn")) {
      lines.push(`      ${chalk.dim("→ " + check.remedy)}`);
    }
  }
  lines.push("");
  lines.push(
    chalk.dim(
      `Summary: ${report.counts.ok} ok, ${report.counts.warn} warning(s), ${report.counts.fail} failure(s)`
    )
  );
  lines.push(
    report.ok
      ? chalk.green("All required checks passed — you're ready to run bootcamp.")
      : chalk.red("One or more required checks failed — see remedies above.")
  );
  return lines.join("\n");
}

/**
 * Entry point used by the CLI. Returns the evaluated report (useful for tests);
 * triggers a non-zero exit when a required check fails.
 */
export async function runDoctor(
  options: DoctorCommandOptions = {},
  deps: DoctorCommandDeps = {}
): Promise<DoctorReport> {
  const gather = deps.gather ?? gatherEnvironment;
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const exit = deps.exit ?? ((code: number) => process.exit(code));

  const env = await gather();
  const report = evaluateDoctor(env);

  if (options.json) {
    log(JSON.stringify(buildDoctorJson(report, env), null, 2));
  } else {
    log(colorizeReport(report));
  }

  if (!report.ok) {
    exit(1);
  }

  return report;
}

export { formatDoctorReport };
