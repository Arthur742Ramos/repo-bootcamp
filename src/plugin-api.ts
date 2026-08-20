import type { BootcampOptions, RepoFacts, RepoInfo, ScanResult } from "./types.js";

export interface PluginDocument {
  name: string;
  content: string;
}

export interface PluginOutput {
  docs: PluginDocument[];
  factsPatch?: Partial<RepoFacts>;
  extraData?: Record<string, unknown>;
}

export interface AnalyzerPlugin {
  type?: "analyzer";
  name: string;
  version?: string;
  analyze: (
    repoPath: string,
    scanResult: ScanResult,
    facts: RepoFacts,
    options: BootcampOptions
  ) => Promise<PluginOutput>;
}

export interface FormatterContext {
  repoPath: string;
  repoInfo: RepoInfo;
  scanResult: ScanResult;
  facts: RepoFacts;
  options: BootcampOptions;
}

export interface FormatterPlugin {
  type: "formatter";
  name: string;
  version?: string;
  formatDocuments: (
    documents: PluginDocument[],
    context: FormatterContext
  ) => Promise<PluginDocument[]>;
}

export interface OutputTargetContext {
  documents: PluginDocument[];
  outputDir: string;
  repoInfo: RepoInfo;
  facts: RepoFacts;
  options: BootcampOptions;
}

export interface OutputTargetPlugin {
  type: "output-target";
  name: string;
  version?: string;
  writeOutput: (context: OutputTargetContext) => Promise<void>;
}

export type BootcampPlugin = AnalyzerPlugin | FormatterPlugin | OutputTargetPlugin;

export function isAnalyzerPlugin(plugin: unknown): plugin is AnalyzerPlugin {
  return (
    typeof plugin === "object" &&
    plugin !== null &&
    typeof (plugin as { name?: unknown }).name === "string" &&
    typeof (plugin as { analyze?: unknown }).analyze === "function"
  );
}

export function isFormatterPlugin(plugin: unknown): plugin is FormatterPlugin {
  return (
    typeof plugin === "object" &&
    plugin !== null &&
    typeof (plugin as { name?: unknown }).name === "string" &&
    typeof (plugin as { formatDocuments?: unknown }).formatDocuments === "function"
  );
}

export function isOutputTargetPlugin(plugin: unknown): plugin is OutputTargetPlugin {
  return (
    typeof plugin === "object" &&
    plugin !== null &&
    typeof (plugin as { name?: unknown }).name === "string" &&
    typeof (plugin as { writeOutput?: unknown }).writeOutput === "function"
  );
}
