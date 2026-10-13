import type {
  BootcampOptions,
  FileInfo,
  RepoFacts,
  RepoInfo,
  ScanResult,
} from "../../src/types.js";
import type { StyleConfig } from "../../src/plugins.js";
import { runbookFacts } from "./runbook-facts.js";

export function makeRepoFacts(overrides: Partial<RepoFacts> = {}): RepoFacts {
  return { ...runbookFacts(), ...overrides };
}

export function makeRepoInfo(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    owner: "owner",
    repo: "repo",
    fullName: "owner/repo",
    url: "https://github.com/owner/repo",
    branch: "main",
    ...overrides,
  };
}

export function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    files: [],
    stack: {
      languages: [],
      frameworks: [],
      buildSystem: "",
      packageManager: null,
      hasDocker: false,
      hasCi: false,
    },
    commands: [],
    ciWorkflows: [],
    readme: null,
    contributing: null,
    keySourceFiles: new Map(),
    ...overrides,
  };
}

export function makeStyleConfig(overrides: Partial<StyleConfig> = {}): StyleConfig {
  return {
    name: "oss",
    description: "Fixture style",
    tone: "technical",
    sectionDepth: "standard",
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
    badges: { style: "none" },
    firstTasksCount: 5,
    introText: "Fixture introduction",
    ...overrides,
  };
}

export function makeOptions(overrides: Partial<BootcampOptions> = {}): BootcampOptions {
  return {
    branch: "main",
    focus: "all",
    audience: "all",
    output: "unused",
    maxFiles: 100,
    noClone: true,
    verbose: false,
    quiet: true,
    ...overrides,
  };
}

export function makeFile(path: string, overrides: Partial<FileInfo> = {}): FileInfo {
  return { path, size: 100, isDirectory: false, ...overrides };
}
