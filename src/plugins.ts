/**
 * Template Packs + Plugin System
 * Allows customization of output style and extending with custom analyzers
 */

import { cosmiconfig } from "cosmiconfig";
import { TypeScriptLoader } from "cosmiconfig-typescript-loader";
import { join } from "path";
import type { StylePack, RepoFacts, ScanResult, BootcampOptions } from "./types.js";
import type {
  AnalyzerPlugin,
  BootcampPlugin,
  FormatterPlugin,
  OutputTargetPlugin,
} from "./plugin-api.js";
import {
  isAnalyzerPlugin,
  isFormatterPlugin,
  isOutputTargetPlugin,
} from "./plugin-api.js";
export type {
  BootcampPlugin,
  PluginOutput,
  PluginDocument,
  AnalyzerPlugin,
  FormatterPlugin,
  OutputTargetPlugin,
  FormatterContext,
  OutputTargetContext,
} from "./plugin-api.js";

/**
 * Style pack configuration
 */
export interface StyleConfig {
  name: StylePack;
  description: string;
  tone: "formal" | "casual" | "technical";
  sectionDepth: "minimal" | "standard" | "deep";
  emoji: boolean;
  sections: {
    showRunbook: boolean;
    showSecurityDetails: boolean;
    showDependencyGraph: boolean;
    showRadar: boolean;
    showImpact: boolean;
    showMetrics: boolean;
    showHealth: boolean;
  };
  badges: {
    style: "shields" | "simple" | "none";
  };
  firstTasksCount: number;
  introText: string;
}

/**
 * Built-in style packs
 */
export const STYLE_PACKS: Record<StylePack, StyleConfig> = {
  corporate: {
    name: "corporate",
    description: "Structured, policy-aligned onboarding documentation",
    tone: "formal",
    sectionDepth: "deep",
    emoji: false,
    sections: {
      showRunbook: true,
      showSecurityDetails: true,
      showDependencyGraph: true,
      showRadar: true,
      showImpact: true,
      showMetrics: true,
      showHealth: true,
    },
    badges: { style: "simple" },
    firstTasksCount: 10,
    introText: "This onboarding guide is organized for clarity, governance, and reliable execution.",
  },
  startup: {
    name: "startup",
    description: "Fast-paced, action-oriented documentation",
    tone: "casual",
    sectionDepth: "standard",
    emoji: true,
    sections: {
      showRunbook: true,
      showSecurityDetails: false,
      showDependencyGraph: false,
      showRadar: true,
      showImpact: false,
      showMetrics: true,
      showHealth: true,
    },
    badges: { style: "shields" },
    firstTasksCount: 6,
    introText: "Let's get you up and running fast! Here's everything you need to start shipping.",
  },
  oss: {
    name: "oss",
    description: "Community-friendly open source documentation",
    tone: "casual",
    sectionDepth: "standard",
    emoji: true,
    sections: {
      showRunbook: false,
      showSecurityDetails: true,
      showDependencyGraph: true,
      showRadar: true,
      showImpact: false,
      showMetrics: true,
      showHealth: true,
    },
    badges: { style: "shields" },
    firstTasksCount: 8,
    introText: "Welcome to the project! We're excited to have you contribute. Here's how to get started.",
  },
  academic: {
    name: "academic",
    description: "Evidence-driven documentation for research and teaching contexts",
    tone: "technical",
    sectionDepth: "deep",
    emoji: false,
    sections: {
      showRunbook: false,
      showSecurityDetails: true,
      showDependencyGraph: true,
      showRadar: false,
      showImpact: true,
      showMetrics: true,
      showHealth: true,
    },
    badges: { style: "simple" },
    firstTasksCount: 7,
    introText: "This guide emphasizes system understanding, traceability, and precise technical explanations.",
  },
  minimal: {
    name: "minimal",
    description: "Lean output focused on the essentials only",
    tone: "formal",
    sectionDepth: "minimal",
    emoji: false,
    sections: {
      showRunbook: false,
      showSecurityDetails: false,
      showDependencyGraph: false,
      showRadar: false,
      showImpact: false,
      showMetrics: false,
      showHealth: false,
    },
    badges: { style: "none" },
    firstTasksCount: 3,
    introText: "Concise onboarding essentials for fast orientation with minimal overhead.",
  },
};

export const STYLE_PACK_NAMES = Object.keys(STYLE_PACKS) as StylePack[];

/**
 * Bootcamp configuration file structure
 */
export interface BootcampConfig {
  style?: StylePack;
  defaults?: {
    audience?: BootcampOptions["audience"];
    focus?: BootcampOptions["focus"];
    maxFiles?: number;
    model?: string;
    style?: StylePack;
  };
  customStyle?: Partial<StyleConfig>;
  plugins?: string[];
  prompts?: {
    system?: string;
    analysis?: string;
  };
  output?: {
    excludeDocs?: string[];
    customDocs?: { name: string; template: string }[];
  };
}

/**
 * Load configuration from .bootcamprc / bootcamp.config.* files
 */
export async function loadConfig(configPath?: string): Promise<BootcampConfig | null> {
  const explorer = cosmiconfig("bootcamp", {
    searchPlaces: [
      "package.json",
      ".bootcamprc",
      ".bootcamprc.json",
      ".bootcamprc.yaml",
      ".bootcamprc.yml",
      ".bootcamprc.js",
      ".bootcamprc.ts",
      "bootcamp.config.json",
      "bootcamp.config.js",
      "bootcamp.config.ts",
      ".bootcamp.json",
    ],
    loaders: {
      ".ts": TypeScriptLoader(),
    },
  });

  try {
    const result = configPath
      ? await explorer.load(configPath)
      : await explorer.search(process.cwd());
    return result?.config ? (result.config as BootcampConfig) : null;
  } catch {
    return null;
  }
}

/**
 * Get style config, merging defaults with custom overrides
 */
export function getStyleConfig(
  style?: StylePack,
  customStyle?: Partial<StyleConfig>
): StyleConfig {
  const base = STYLE_PACKS[style || "oss"];
  
  if (!customStyle) return base;

  return {
    ...base,
    ...customStyle,
    sections: {
      ...base.sections,
      ...customStyle.sections,
    },
    badges: {
      ...base.badges,
      ...customStyle.badges,
    },
  };
}

/**
 * Load and initialize plugins
 */
export async function loadPlugins(pluginPaths: string[]): Promise<BootcampPlugin[]> {
  const plugins: BootcampPlugin[] = [];

  for (const path of pluginPaths) {
    try {
      // Try to load as a module
      const modulePath = path.startsWith(".")
        ? join(process.cwd(), path)
        : path;

      const module = await import(modulePath);
      const plugin = module.default || module;

      if (plugin.name && (isAnalyzerPlugin(plugin) || isFormatterPlugin(plugin) || isOutputTargetPlugin(plugin))) {
        plugins.push(plugin);
        console.log(`Loaded plugin: ${plugin.name} v${plugin.version || "1.0.0"}`);
      }
    } catch (error: unknown) {
      console.warn(`Failed to load plugin ${path}: ${(error as Error).message}`);
    }
  }

  return plugins;
}

/**
 * Run all plugins and collect output
 */
export async function runPlugins(
  plugins: BootcampPlugin[],
  repoPath: string,
  scanResult: ScanResult,
  facts: RepoFacts,
  options: BootcampOptions
): Promise<{
  docs: { name: string; content: string }[];
  factsPatch: Partial<RepoFacts>;
  extraData: Record<string, unknown>;
  formatters: FormatterPlugin[];
  outputTargets: OutputTargetPlugin[];
}> {
  const allDocs: { name: string; content: string }[] = [];
  let factsPatch: Partial<RepoFacts> = {};
  const extraData: Record<string, unknown> = {};
  const formatters: FormatterPlugin[] = [];
  const outputTargets: OutputTargetPlugin[] = [];

  for (const plugin of plugins) {
    if (isFormatterPlugin(plugin)) {
      formatters.push(plugin);
    }
    if (isOutputTargetPlugin(plugin)) {
      outputTargets.push(plugin);
    }
    if (!isAnalyzerPlugin(plugin)) {
      continue;
    }

    try {
      const output = await plugin.analyze(repoPath, scanResult, facts, options);

      if (output.docs) {
        allDocs.push(...output.docs);
      }

      if (output.factsPatch) {
        factsPatch = { ...factsPatch, ...output.factsPatch };
      }

      if (output.extraData) {
        extraData[plugin.name] = output.extraData;
      }
    } catch (error: unknown) {
      console.warn(`Plugin ${plugin.name} failed: ${(error as Error).message}`);
    }
  }

  return { docs: allDocs, factsPatch, extraData, formatters, outputTargets };
}

/**
 * Generate example config file content
 */
export function generateExampleConfig(): string {
  return JSON.stringify({
    style: "oss",
    customStyle: {
      emoji: true,
      firstTasksCount: 10,
    },
    plugins: [],
    prompts: {
      system: "You are a helpful assistant for onboarding developers.",
    },
    output: {
      excludeDocs: [],
    },
  }, null, 2);
}

/**
 * Example plugin for reference
 */
export const examplePlugin: AnalyzerPlugin = {
  name: "example-plugin",
  version: "1.0.0",
  analyze: async (repoPath, scanResult, facts, _options) => {
    void _options;
    // Example: Generate a custom doc
    const content = `# Custom Analysis

This is an example plugin output for ${facts.repoName}.

## File Count by Type

${scanResult.stack.languages.map(lang => `- ${lang}`).join("\n")}
`;

    return {
      docs: [{ name: "CUSTOM.md", content }],
      extraData: {
        customMetric: 42,
      },
    };
  },
};
