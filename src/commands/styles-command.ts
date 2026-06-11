/**
 * `bootcamp styles` command.
 *
 * Lists the built-in style packs and the documentation sections each one
 * enables, so users can pick a `--style` without reading the source. Renders
 * either a human-readable comparison or a stable JSON payload (`--json`). All
 * formatting helpers are exported and pure so unit tests can pin the output
 * without spawning a real CLI process.
 */

import chalk from "chalk";

import { STYLE_PACKS, STYLE_PACK_NAMES, type StyleConfig } from "../plugins.js";
import type { StylePack } from "../types.js";

export interface StylesCommandOptions {
  json?: boolean;
}

/** A single optional documentation section, in display order. */
interface SectionDescriptor {
  key: keyof StyleConfig["sections"];
  label: string;
}

/**
 * Optional sections in the order they appear in the comparison, with the
 * short labels used for column headers.
 */
export const SECTION_DESCRIPTORS: readonly SectionDescriptor[] = [
  { key: "showRunbook", label: "Runbook" },
  { key: "showSecurityDetails", label: "Security" },
  { key: "showDependencyGraph", label: "Deps" },
  { key: "showRadar", label: "Radar" },
  { key: "showImpact", label: "Impact" },
  { key: "showMetrics", label: "Metrics" },
  { key: "showHealth", label: "Health" },
];

interface StyleJsonEntry {
  name: StylePack;
  description: string;
  tone: StyleConfig["tone"];
  sectionDepth: StyleConfig["sectionDepth"];
  emoji: boolean;
  badges: StyleConfig["badges"]["style"];
  firstTasksCount: number;
  sections: StyleConfig["sections"];
  enabledSections: string[];
}

interface StylesJson {
  default: StylePack;
  count: number;
  styles: StyleJsonEntry[];
}

/** The style pack used when `--style` is omitted (mirrors `getStyleConfig`). */
export const DEFAULT_STYLE: StylePack = "oss";

/** Section keys enabled for a given style, in display order. */
export function enabledSectionLabels(config: StyleConfig): string[] {
  return SECTION_DESCRIPTORS.filter((d) => config.sections[d.key]).map((d) => d.label);
}

/**
 * Build the machine-readable payload for `--json`. Deterministic: styles are
 * listed in `STYLE_PACK_NAMES` order.
 */
export function buildStylesJson(): StylesJson {
  const styles: StyleJsonEntry[] = STYLE_PACK_NAMES.map((name) => {
    const config = STYLE_PACKS[name];
    return {
      name,
      description: config.description,
      tone: config.tone,
      sectionDepth: config.sectionDepth,
      emoji: config.emoji,
      badges: config.badges.style,
      firstTasksCount: config.firstTasksCount,
      sections: config.sections,
      enabledSections: enabledSectionLabels(config),
    };
  });

  return {
    default: DEFAULT_STYLE,
    count: styles.length,
    styles,
  };
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padCenter(value: string, width: number): string {
  if (value.length >= width) return value;
  const total = width - value.length;
  const left = Math.floor(total / 2);
  return " ".repeat(left) + value + " ".repeat(total - left);
}

/**
 * Render the section-coverage matrix: one row per style, one column per
 * optional section, with a check/dot marking whether it is enabled.
 *
 * Layout is computed on plain (uncolorized) text and color is applied last, so
 * ANSI escape codes never throw off column alignment.
 */
export function renderSectionMatrix(): string {
  const nameWidth = Math.max("STYLE".length, ...STYLE_PACK_NAMES.map((n) => n.length));
  const colWidths = SECTION_DESCRIPTORS.map((d) => Math.max(d.label.length, 3));

  const headerCells = SECTION_DESCRIPTORS.map((d, i) => padCenter(d.label, colWidths[i]));
  const header = chalk.bold(padRight("STYLE", nameWidth) + "  " + headerCells.join("  "));

  const rows = STYLE_PACK_NAMES.map((name) => {
    const config = STYLE_PACKS[name];
    const cells = SECTION_DESCRIPTORS.map((d, i) => {
      const enabled = config.sections[d.key];
      // Pad the plain glyph to the column width, then colorize the whole cell.
      const cell = padCenter(enabled ? "✓" : "·", colWidths[i]);
      return enabled ? chalk.green(cell) : chalk.dim(cell);
    });
    const label =
      name === DEFAULT_STYLE ? chalk.cyan(padRight(name, nameWidth)) : padRight(name, nameWidth);
    return label + "  " + cells.join("  ");
  });

  return [header, ...rows].join("\n");
}

/**
 * Render the full human-readable report: a per-style summary block followed by
 * the section-coverage matrix.
 */
export function buildHumanOutput(): string {
  const lines: string[] = [];
  lines.push(chalk.cyan.bold("Built-in style packs"));
  lines.push(
    chalk.dim(`Use with: bootcamp <repo-url> --style <name>   (default: ${DEFAULT_STYLE})`)
  );
  lines.push("");

  for (const name of STYLE_PACK_NAMES) {
    const config = STYLE_PACKS[name];
    const isDefault = name === DEFAULT_STYLE;
    const heading = isDefault
      ? `${chalk.cyan.bold(name)} ${chalk.dim("(default)")}`
      : chalk.bold(name);
    lines.push(`  ${heading}`);
    lines.push(`    ${chalk.dim(config.description)}`);

    const enabled = enabledSectionLabels(config);
    lines.push(
      `    ${chalk.dim("tone:")} ${config.tone}   ${chalk.dim("depth:")} ${config.sectionDepth}   ` +
        `${chalk.dim("emoji:")} ${config.emoji ? "yes" : "no"}   ${chalk.dim("first tasks:")} ${config.firstTasksCount}`
    );
    lines.push(
      `    ${chalk.dim("sections:")} ${enabled.length > 0 ? enabled.join(", ") : chalk.dim("essentials only")}`
    );
    lines.push("");
  }

  lines.push(chalk.bold("Section coverage"));
  lines.push("");
  lines.push(renderSectionMatrix());
  return lines.join("\n");
}

/** Entry point used by the CLI. */
export function runStylesCommand(options: StylesCommandOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(buildStylesJson(), null, 2));
    return;
  }

  console.log(buildHumanOutput());
}
