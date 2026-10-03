import type { PackageManager } from "./tasks.js";

/** Render a package script name as one literal POSIX shell argument. */
export function packageScriptCommand(name: string, manager: PackageManager = "npm"): string {
  const argument = /^[A-Za-z0-9_./:@-]+$/.test(name) ? name : `'${name.replace(/'/g, `'"'"'`)}'`;
  // Quoting alone does not stop managers from interpreting a leading hyphen.
  return `${manager} run ${name.startsWith("-") ? "-- " : ""}${argument}`;
}
