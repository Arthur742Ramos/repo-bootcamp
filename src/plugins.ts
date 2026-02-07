/**
 * Template Packs + Plugin System
 * Allows customization of output style and extending with custom analyzers
 */

import { readFile } from "fs/promises";
import { join } from "path";
import type { StylePack, RepoFacts, ScanResult, BootcampOptions } from "./types.js";

/**
 * Style pack configuration
 */
export interface StyleConfig {
  name: StylePack;
  description: string;
  tone: "formal" | "casual" | "technical";
  emoji: boolean;
  sections: {
    showRunbook: boolean;
    showSecurityDetails: boolean;
    showDependencyGraph: boolean;
    showRadar: boolean;
    showImpact: boolean;
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
  startup: {
    name: "startup",
    description: "Fast-paced, action-oriented documentation",
    tone: "casual",
    emoji: true,
    sections: {
      showRunbook: true,
      showSecurityDetails: false,
      showDependencyGraph: false,
      showRadar: true,
      showImpact: false,
    },
    badges: { style: "shields" },
    firstTasksCount: 5,
    introText: "Let's get you up and running fast! Here's everything you need to start shipping.",
  },
  enterprise: {
    name: "enterprise",
    description: "Comprehensive, compliance-focused documentation",
    tone: "formal",
    emoji: false,
    sections: {
      showRunbook: true,
      showSecurityDetails: true,
      showDependencyGraph: true,
      showRadar: true,
      showImpact: true,
    },
    badges: { style: "simple" },
    firstTasksCount: 10,
    introText: "This document provides comprehensive onboarding materials in accordance with organizational standards.",
  },
  oss: {
    name: "oss",
    description: "Community-friendly open source documentation",
    tone: "casual",
    emoji: true,
    sections: {
      showRunbook: false,
      showSecurityDetails: true,
      showDependencyGraph: true,
      showRadar: true,
      showImpact: false,
    },
    badges: { style: "shields" },
    firstTasksCount: 8,
    introText: "Welcome to the project! We're excited to have you contribute. Here's how to get started.",
  },
  devops: {
    name: "devops",
    description: "Infrastructure and operations focused",
    tone: "technical",
    emoji: false,
    sections: {
      showRunbook: true,
      showSecurityDetails: true,
      showDependencyGraph: false,
      showRadar: false,
      showImpact: true,
    },
    badges: { style: "simple" },
    firstTasksCount: 6,
    introText: "Infrastructure and deployment documentation for platform engineers.",
  },
};

/**
 * Plugin interface for custom analyzers
 */
export interface BootcampPlugin {
  name: string;
  version: string;
  /**
   * Analyze the repository and return additional documentation
   */
  analyze: (
    repoPath: string,
    scanResult: ScanResult,
    facts: RepoFacts,
    options: BootcampOptions
  ) => Promise<PluginOutput>;
}

/**
 * Plugin output
 */
export interface PluginOutput {
  /** Additional documentation files to generate */
  docs: { name: string; content: string }[];
  /** Patches to apply to RepoFacts */
  factsPatch?: Partial<RepoFacts>;
  /** Additional data to include in repo_facts.json */
  extraData?: Record<string, unknown>;
}

/**
 * Bootcamp configuration file structure
 */
export interface BootcampConfig {
  style?: StylePack;
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
 * Load configuration from bootcamp.config.json
 */
export async function loadConfig(configPath?: string): Promise<BootcampConfig | null> {
  const paths = configPath 
    ? [configPath]
    : [
        join(process.cwd(), "bootcamp.config.json"),
        join(process.cwd(), ".bootcamprc.json"),
        join(process.cwd(), ".bootcamp.json"),
      ];

  for (const path of paths) {
    try {
      const content = await readFile(path, "utf-8");
      return JSON.parse(content) as BootcampConfig;
    } catch {
      // Try next path
    }
  }

  return null;
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

      if (plugin.name && plugin.analyze) {
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
}> {
  const allDocs: { name: string; content: string }[] = [];
  let factsPatch: Partial<RepoFacts> = {};
  const extraData: Record<string, unknown> = {};

  for (const plugin of plugins) {
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

  return { docs: allDocs, factsPatch, extraData };
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
export const examplePlugin: BootcampPlugin = {
  name: "example-plugin",
  version: "1.0.0",
  analyze: async (repoPath, scanResult, facts, _options) => {
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
