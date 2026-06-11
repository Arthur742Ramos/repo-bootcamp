/**
 * `bootcamp completion <shell>` command.
 *
 * Prints a shell completion script (bash/zsh/fish) to stdout, derived from the
 * live Commander program so it always matches the real command surface. This
 * module handles validation and process wiring; the script generation lives in
 * `src/completion.ts`. Dependencies are injectable for unit testing.
 */

import chalk from "chalk";
import type { Command } from "commander";

import {
  collectCompletionSpec,
  isSupportedShell,
  renderCompletion,
  SUPPORTED_SHELLS,
} from "../completion.js";

export interface CompletionCommandOptions {
  shell?: string;
}

export interface CompletionCommandDeps {
  log?: (message: string) => void;
  error?: (message: string) => void;
  exit?: (code: number) => void;
}

/**
 * Run the `completion` command against a configured `program`.
 *
 * Prints the requested shell's completion script to stdout. On an unknown or
 * missing shell, writes an error to stderr and exits non-zero.
 */
export function runCompletionCommand(
  program: Command,
  options: CompletionCommandOptions,
  deps: CompletionCommandDeps = {}
): void {
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const error = deps.error ?? ((msg: string) => console.error(msg));
  const exit = deps.exit ?? ((code: number) => process.exit(code));

  const shell = (options.shell ?? "").toLowerCase();

  if (!shell) {
    error(chalk.red(`Missing shell. Choose one of: ${SUPPORTED_SHELLS.join(", ")}`));
    exit(1);
    return;
  }

  if (!isSupportedShell(shell)) {
    error(
      chalk.red(`Unsupported shell: ${shell}.`) +
        chalk.dim(` Choose one of: ${SUPPORTED_SHELLS.join(", ")}`)
    );
    exit(1);
    return;
  }

  const spec = collectCompletionSpec(program);
  log(renderCompletion(shell, spec));
}
