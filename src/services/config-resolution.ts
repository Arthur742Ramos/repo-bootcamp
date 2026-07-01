import { isAbsolute } from "path";

import { getStyleConfig, loadConfig, type BootcampConfig, type StyleConfig } from "../plugins.js";
import type { OutputFormat } from "../formatter.js";
import type { BootcampOptions } from "../types.js";

const VALID_FORMATS: OutputFormat[] = ["markdown", "html", "pdf"];
const VALID_FOCUS = ["onboarding", "architecture", "contributing", "all"] as const;
const VALID_AUDIENCE = ["all", "backend", "frontend", "sre"] as const;
type DefaultableOptionKey = "audience" | "focus" | "maxFiles" | "model" | "style";

function shouldApplyConfigDefault(options: BootcampOptions, key: DefaultableOptionKey): boolean {
  return options.optionSource?.[key] === "default";
}

function applyConfigDefault<K extends DefaultableOptionKey>(
  options: BootcampOptions,
  key: K,
  value: BootcampOptions[K] | undefined
): void {
  if (value === undefined) {
    return;
  }
  if (shouldApplyConfigDefault(options, key)) {
    options[key] = value;
  }
}

function normalizeMaxFiles(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function validateRunOptions(options: BootcampOptions): void {
  if (!VALID_FOCUS.includes(options.focus)) {
    throw new Error(`Invalid focus: ${options.focus}`);
  }
  if (!VALID_AUDIENCE.includes(options.audience)) {
    throw new Error(`Invalid audience: ${options.audience}`);
  }
  if (!Number.isFinite(options.maxFiles) || options.maxFiles <= 0) {
    throw new Error(`Invalid maxFiles: ${options.maxFiles}`);
  }
}

/**
 * Normalize the `--exclude`/`--subdir` scan-scope options in place: trim blank
 * globs, strip a leading `./` and trailing slashes from the subdir, and reject a
 * subdir that would escape the repository root (absolute or containing `..`).
 * Mutates `options` so the normalized values flow through to the scan call.
 */
export function normalizeScanScope(options: BootcampOptions): void {
  if (options.exclude) {
    const cleaned = options.exclude.map((glob) => glob.trim()).filter((glob) => glob.length > 0);
    options.exclude = cleaned.length > 0 ? cleaned : undefined;
  }

  if (typeof options.subdir === "string") {
    const trimmed = options.subdir.trim().replace(/^\.\/+/, "").replace(/[/\\]+$/, "");
    options.subdir = trimmed.length > 0 ? trimmed : undefined;
  }

  if (options.subdir && (isAbsolute(options.subdir) || options.subdir.split(/[/\\]/).includes(".."))) {
    throw new Error(
      `Invalid subdir: ${options.subdir}. Use a relative path within the repository (no leading / and no "..").`
    );
  }
}

export interface ResolvedRunConfiguration {
  config: BootcampConfig | null;
  styleConfig: StyleConfig;
  outputFormat: OutputFormat;
}

export function resolveOutputFormat(format?: string): OutputFormat {
  const candidate = format || "markdown";
  if (!VALID_FORMATS.includes(candidate as OutputFormat)) {
    throw new Error(`Invalid format: ${candidate}. Use: markdown, html, pdf`);
  }
  return candidate as OutputFormat;
}

export async function resolveRunConfiguration(options: BootcampOptions): Promise<ResolvedRunConfiguration> {
  const config = await loadConfig();
  const defaults = config?.defaults;

  applyConfigDefault(options, "focus", defaults?.focus);
  applyConfigDefault(options, "audience", defaults?.audience);
  applyConfigDefault(options, "model", defaults?.model);
  applyConfigDefault(options, "maxFiles", normalizeMaxFiles(defaults?.maxFiles));
  applyConfigDefault(options, "style", defaults?.style ?? config?.style);
  if (!options.style && config?.style) {
    options.style = config.style;
  }

  if (!options.systemPrompt && config?.prompts?.system) {
    options.systemPrompt = config.prompts.system;
  }

  normalizeScanScope(options);
  validateRunOptions(options);

  const styleConfig = getStyleConfig(options.style, config?.customStyle);
  const outputFormat = resolveOutputFormat(options.format);

  return {
    config,
    styleConfig,
    outputFormat,
  };
}
