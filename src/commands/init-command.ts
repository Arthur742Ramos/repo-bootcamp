import chalk from "chalk";
import { access, writeFile } from "fs/promises";
import { resolve } from "path";

import { generateExampleConfig, STYLE_PACK_NAMES } from "../plugins.js";
import type { StylePack } from "../types.js";

/** Options accepted by the `bootcamp init` command. */
export interface InitCommandOptions {
  /** Overwrite an existing config file. */
  force?: boolean;
  /** Print the config to stdout instead of writing a file. */
  print?: boolean;
  /** Output path for the config file (defaults to .bootcamprc.json). */
  path?: string;
  /** Preset a style pack in the generated config. */
  style?: string;
}

const DEFAULT_CONFIG_FILE = ".bootcamprc.json";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the config file contents, optionally presetting a style pack.
 */
export function buildInitConfig(style?: string): string {
  const base = generateExampleConfig();
  if (!style) {
    return base;
  }
  const parsed = JSON.parse(base) as Record<string, unknown>;
  parsed.style = style;
  return JSON.stringify(parsed, null, 2);
}

/**
 * Run the `bootcamp init` command: scaffold a `.bootcamprc.json` config file
 * in the current directory (or a custom `--path`). Refuses to overwrite an
 * existing file unless `--force`; `--print` writes to stdout instead of disk.
 */
export async function runInitCommand(opts: InitCommandOptions): Promise<void> {
  if (opts.style && !STYLE_PACK_NAMES.includes(opts.style as StylePack)) {
    console.error(chalk.red(`Invalid style: ${opts.style}. Use: ${STYLE_PACK_NAMES.join(", ")}`));
    process.exit(1);
    return;
  }

  const content = buildInitConfig(opts.style);

  if (opts.print) {
    console.log(content);
    return;
  }

  const targetPath = resolve(process.cwd(), opts.path || DEFAULT_CONFIG_FILE);

  if ((await fileExists(targetPath)) && !opts.force) {
    console.error(
      chalk.red(`Config already exists at ${targetPath}.`) +
        chalk.dim(" Use --force to overwrite or --print to preview.")
    );
    process.exit(1);
    return;
  }

  try {
    await writeFile(targetPath, `${content}\n`, "utf-8");
  } catch (error: unknown) {
    console.error(
      chalk.red(`Failed to write config: ${error instanceof Error ? error.message : String(error)}`)
    );
    process.exit(1);
    return;
  }

  console.log(chalk.green(`✓ Created ${targetPath}`));
  console.log(chalk.dim("Customize style, defaults, prompts, and excluded docs to taste."));
  console.log(
    chalk.dim("Next: run ") + chalk.cyan("bootcamp <repo-url>") + chalk.dim(" — the config is picked up automatically.")
  );
}
