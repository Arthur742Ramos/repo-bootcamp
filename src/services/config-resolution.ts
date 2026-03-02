import { getStyleConfig, loadConfig, type BootcampConfig, type StyleConfig } from "../plugins.js";
import type { OutputFormat } from "../formatter.js";
import type { BootcampOptions } from "../types.js";

const VALID_FORMATS: OutputFormat[] = ["markdown", "html", "pdf"];

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
  if (!options.systemPrompt && config?.prompts?.system) {
    options.systemPrompt = config.prompts.system;
  }
  const styleConfig = getStyleConfig(options.style ?? config?.style, config?.customStyle);
  const outputFormat = resolveOutputFormat(options.format);

  return {
    config,
    styleConfig,
    outputFormat,
  };
}
