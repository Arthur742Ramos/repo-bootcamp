import chalk from "chalk";

import { resolveRepo, type RepoSource } from "../repo-resolver.js";

/** The subset of command options the shared repo lifecycle needs. */
export interface ResolvedRepoOptions {
  /** Branch to resolve/clone; a falsy value uses the default branch. */
  branch?: string;
  /**
   * Whether the command is emitting machine-readable JSON. When set, the
   * keep-temp note is routed to stderr so stdout stays valid JSON for consumers.
   */
  json?: boolean;
  /** Keep the temporary clone instead of cleaning it up (remote repos only). */
  keepTemp?: boolean;
}

/**
 * Resolve a repository and run `analyze` against it inside the shared
 * report-command lifecycle. This is the single home for the skeleton that the
 * 11 report commands (deps, radar, security, owners, metrics, impact, health,
 * coupling, scan, cycles, preflight) used to copy-paste verbatim:
 *
 *  1. resolve the repo — on failure, print a red `Failed to resolve repository:`
 *     line and `process.exit(1)`;
 *  2. run `analyze` inside a try/catch — a thrown error becomes exit code 1 with
 *     a red `${failureLabel}: <message>` line;
 *  3. in a `finally`, either keep the temporary clone (routing the note to
 *     stderr under `--json` so stdout stays valid JSON — the behavior cycles
 *     pioneered) or clean it up;
 *  4. `process.exit` with the resulting non-zero exit code.
 *
 * `analyze` may return a number to set the exit code — e.g. a failed `--check`
 * gate or a "file not found" path that should exit non-zero without being
 * treated as an error. Returning nothing leaves the exit code at 0.
 *
 * Centralizing this closes a drift class: keep-temp-under-`--json` and the
 * NaN-`--max-files` guard now live in exactly one place instead of diverging
 * across eleven near-identical copies.
 */
export async function withResolvedRepo(
  repoUrl: string,
  opts: ResolvedRepoOptions,
  failureLabel: string,
  analyze: (repoSource: RepoSource) => Promise<number | void>
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
    const code = await analyze(repoSource);
    if (typeof code === "number") exitCode = code;
  } catch (error: unknown) {
    console.error(
      chalk.red(`${failureLabel}: ${error instanceof Error ? error.message : String(error)}`)
    );
    exitCode = 1;
  } finally {
    if (opts.keepTemp && !repoSource.isLocal) {
      // Route to stderr under --json so stdout stays valid JSON for consumers.
      const note = chalk.gray(`Temporary clone kept at: ${repoSource.path}`);
      if (opts.json) {
        console.error(note);
      } else {
        console.log(note);
      }
    } else {
      await repoSource.cleanup();
    }
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
