import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BootcampOptions, RepoFacts, RepoInfo, ScanResult } from "../src/types.js";
import type { StyleConfig } from "../src/plugins.js";

const {
  loadConfigMock,
  getStyleConfigMock,
  loadPluginsMock,
  runPluginsMock,
  runParallelAnalysisMock,
} = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  getStyleConfigMock: vi.fn(),
  loadPluginsMock: vi.fn(),
  runPluginsMock: vi.fn(),
  runParallelAnalysisMock: vi.fn(),
}));

vi.mock("../src/plugins.js", () => ({
  loadConfig: loadConfigMock,
  getStyleConfig: getStyleConfigMock,
  loadPlugins: loadPluginsMock,
  runPlugins: runPluginsMock,
}));

vi.mock("../src/analysis.js", () => ({
  runParallelAnalysis: runParallelAnalysisMock,
}));

vi.mock("../src/diff.js", () => ({
  analyzeDiff: vi.fn(),
  generateDiffDocs: vi.fn(() => "diff-doc"),
}));

vi.mock("../src/deps.js", () => ({
  generateDependencyDocs: vi.fn(() => "deps-doc"),
}));

vi.mock("../src/generator.js", () => ({
  generateBootcamp: vi.fn((facts: RepoFacts) => `bootcamp:${facts.purpose}`),
  generateOnboarding: vi.fn(() => "onboarding"),
  generateArchitecture: vi.fn(() => "architecture"),
  generateCodemap: vi.fn(() => "codemap"),
  generateFirstTasks: vi.fn(() => "first-tasks"),
  generateRunbook: vi.fn(() => "runbook"),
  generateDiagrams: vi.fn(() => "diagrams"),
}));

vi.mock("../src/impact.js", () => ({
  generateImpactDocs: vi.fn(() => "impact-doc"),
}));

vi.mock("../src/radar.js", () => ({
  generateRadarDocs: vi.fn(() => "radar-doc"),
}));

vi.mock("../src/security.js", () => ({
  generateSecurityDocs: vi.fn(() => "security-doc"),
}));

import { resolveRunConfiguration } from "../src/services/config-resolution.js";
import { prepareOutputDocuments } from "../src/services/analysis-orchestration.js";

const DEFAULT_OPTIONS: BootcampOptions = {
  branch: "main",
  focus: "all",
  audience: "backend",
  output: "./out",
  maxFiles: 200,
  noClone: false,
  verbose: false,
  format: "markdown",
  style: "startup",
};

const DEFAULT_STYLE: StyleConfig = {
  name: "startup",
  description: "startup",
  tone: "casual",
  sectionDepth: "standard",
  emoji: true,
  sections: {
    showRunbook: true,
    showSecurityDetails: true,
    showDependencyGraph: false,
    showRadar: true,
    showImpact: false,
  },
  badges: { style: "shields" },
  firstTasksCount: 5,
  introText: "intro",
};

const DEFAULT_FACTS = {
  repoName: "acme/repo",
  purpose: "original purpose",
  description: "desc",
  stack: {
    languages: [],
    frameworks: [],
    buildSystem: "npm",
    packageManager: "npm",
    hasDocker: false,
    hasCi: true,
  },
  quickstart: {
    prerequisites: [],
    steps: [],
    commands: [],
  },
  structure: {
    keyDirs: [],
    entrypoints: [],
    testDirs: [],
    docsDirs: [],
  },
  ci: {
    workflows: [],
    mainChecks: [],
  },
  contrib: {
    howToAddFeature: [],
    howToAddTest: [],
  },
  architecture: {
    overview: "",
    components: [],
  },
  firstTasks: [
    {
      title: "task",
      description: "desc",
      difficulty: "beginner",
      category: "docs",
      files: ["README.md"],
      why: "why",
    },
  ],
} as RepoFacts;

const DEFAULT_SCAN = {
  files: [],
  stack: {
    languages: [],
    frameworks: [],
    buildSystem: "npm",
    packageManager: "npm",
    hasDocker: false,
    hasCi: true,
  },
  commands: [],
  ciWorkflows: [],
  readme: null,
  contributing: null,
  keySourceFiles: new Map(),
} as ScanResult;

const DEFAULT_REPO_INFO = {
  owner: "acme",
  repo: "repo",
  url: "https://github.com/acme/repo",
  branch: "main",
  fullName: "acme/repo",
} as RepoInfo;

describe("pipeline wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStyleConfigMock.mockReturnValue(DEFAULT_STYLE);
    runParallelAnalysisMock.mockResolvedValue({
      deps: null,
      security: { score: 90 },
      radar: { onboardingRisk: { score: 10, grade: "A" } },
      impacts: [],
    });
    loadPluginsMock.mockResolvedValue([{ name: "demo-plugin" }]);
    runPluginsMock.mockResolvedValue({
      docs: [{ name: "CUSTOM.md", content: "custom-doc" }],
      factsPatch: { purpose: "patched purpose" },
      extraData: { demo: { enabled: true } },
    });
  });

  it("applies config prompts.system into options", async () => {
    loadConfigMock.mockResolvedValue({
      prompts: { system: "Configured system prompt" },
    });

    const options: BootcampOptions = { ...DEFAULT_OPTIONS };
    await resolveRunConfiguration(options);

    expect(options.systemPrompt).toBe("Configured system prompt");
  });

  it("applies config defaults when option source is default", async () => {
    loadConfigMock.mockResolvedValue({
      defaults: {
        focus: "architecture",
        audience: "frontend",
        maxFiles: 120,
        model: "configured-model",
        style: "minimal",
      },
    });

    const options: BootcampOptions = {
      ...DEFAULT_OPTIONS,
      model: undefined,
      style: undefined,
      optionSource: {
        focus: "default",
        audience: "default",
        maxFiles: "default",
        model: "default",
        style: "default",
      },
    };
    await resolveRunConfiguration(options);

    expect(options.focus).toBe("architecture");
    expect(options.audience).toBe("frontend");
    expect(options.maxFiles).toBe(120);
    expect(options.model).toBe("configured-model");
    expect(options.style).toBe("minimal");
    expect(getStyleConfigMock).toHaveBeenCalledWith("minimal", undefined);
  });

  it("keeps CLI-provided options over config defaults", async () => {
    loadConfigMock.mockResolvedValue({
      defaults: {
        focus: "architecture",
        audience: "frontend",
        maxFiles: 120,
        model: "configured-model",
        style: "minimal",
      },
    });

    const options: BootcampOptions = {
      ...DEFAULT_OPTIONS,
      model: "cli-model",
      style: "corporate",
      optionSource: {
        focus: "cli",
        audience: "cli",
        maxFiles: "cli",
        model: "cli",
        style: "cli",
      },
    };
    await resolveRunConfiguration(options);

    expect(options.focus).toBe(DEFAULT_OPTIONS.focus);
    expect(options.audience).toBe(DEFAULT_OPTIONS.audience);
    expect(options.maxFiles).toBe(DEFAULT_OPTIONS.maxFiles);
    expect(options.model).toBe("cli-model");
    expect(options.style).toBe("corporate");
    expect(getStyleConfigMock).toHaveBeenCalledWith("corporate", undefined);
  });

  it("applies plugin factsPatch and output.excludeDocs", async () => {
    const result = await prepareOutputDocuments({
      repoPath: "/tmp/repo",
      repoInfo: DEFAULT_REPO_INFO,
      scanResult: DEFAULT_SCAN,
      facts: DEFAULT_FACTS,
      options: { ...DEFAULT_OPTIONS },
      config: {
        plugins: ["./demo-plugin.js"],
        output: {
          excludeDocs: ["RUNBOOK.md", "CUSTOM.md"],
        },
      },
      styleConfig: DEFAULT_STYLE,
      progress: { update: vi.fn() } as any,
    });

    expect(result.facts.purpose).toBe("patched purpose");

    const docNames = result.documents.map((doc) => doc.name);
    expect(docNames).toContain("BOOTCAMP.md");
    expect(docNames).not.toContain("RUNBOOK.md");
    expect(docNames).not.toContain("CUSTOM.md");

    const bootcampDoc = result.documents.find((doc) => doc.name === "BOOTCAMP.md");
    expect(bootcampDoc?.content).toContain("patched purpose");

    const factsDoc = result.documents.find((doc) => doc.name === "repo_facts.json");
    const factsJson = JSON.parse(factsDoc!.content);
    expect(factsJson.purpose).toBe("patched purpose");
    expect(factsJson.plugins).toEqual({ demo: { enabled: true } });
  });

  it("applies formatter plugins and returns output targets", async () => {
    runPluginsMock.mockResolvedValue({
      docs: [],
      factsPatch: {},
      extraData: {},
      formatters: [
        {
          name: "formatter-plugin",
          formatDocuments: vi.fn(async (documents: { name: string; content: string }[]) =>
            documents.map((doc) =>
              doc.name === "BOOTCAMP.md"
                ? { ...doc, content: `${doc.content}\nformatted` }
                : doc
            )
          ),
        },
      ],
      outputTargets: [
        {
          name: "target-plugin",
          writeOutput: vi.fn(async () => {}),
        },
      ],
    });

    const result = await prepareOutputDocuments({
      repoPath: "/tmp/repo",
      repoInfo: DEFAULT_REPO_INFO,
      scanResult: DEFAULT_SCAN,
      facts: DEFAULT_FACTS,
      options: { ...DEFAULT_OPTIONS },
      config: {
        plugins: ["./demo-plugin.js"],
      },
      styleConfig: DEFAULT_STYLE,
      progress: { update: vi.fn() } as any,
    });

    const bootcampDoc = result.documents.find((doc) => doc.name === "BOOTCAMP.md");
    expect(bootcampDoc?.content).toContain("formatted");
    expect(result.outputTargets).toHaveLength(1);
    expect(result.outputTargets[0].name).toBe("target-plugin");
  });
});
