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

  validateRunOptions(options);

  const styleConfig = getStyleConfig(options.style, config?.customStyle);
  const outputFormat = resolveOutputFormat(options.format);

  return {
    config,
    styleConfig,
    outputFormat,
  };
}
