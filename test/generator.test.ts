/**
 * Tests for document generators
 */

import { describe, it, expect } from "vitest";
import {
  generateBootcamp,
  generateOnboarding,
  generateArchitecture,
  generateCodemap,
  generateFirstTasks,
  generateRunbook,
} from "../src/generator.js";
import type { RepoFacts, BootcampOptions } from "../src/types.js";

const mockFacts: RepoFacts = {
  repoName: "test/repo",
  purpose: "A test repository",
  description: "This is a test repository for testing the generator.",
  confidence: "high",
  sources: ["README.md", "package.json"],
  stack: {
    languages: ["TypeScript", "JavaScript"],
    frameworks: ["Express"],
    buildSystem: "npm",
    packageManager: "npm",
    hasDocker: true,
    hasCi: true,
  },
  quickstart: {
    prerequisites: ["Node.js 18+", "npm"],
    steps: ["Clone the repo", "Install dependencies", "Run dev server"],
    commands: [
      { name: "install", command: "npm install", source: "package.json" },
      { name: "dev", command: "npm run dev", source: "package.json" },
      { name: "test", command: "npm test", source: "package.json" },
      { name: "build", command: "npm run build", source: "package.json" },
    ],
    commonErrors: [
      { error: "Port already in use", fix: "Kill the process using port 3000" },
    ],
    sources: ["README.md"],
  },
  structure: {
    keyDirs: [
      { path: "src/", purpose: "Main source code", keyFiles: ["src/index.ts"] },
      { path: "test/", purpose: "Test files" },
    ],
    entrypoints: [
      { path: "src/index.ts", type: "main", description: "Main entry point" },
    ],
    testDirs: ["test/", "__tests__/"],
    docsDirs: ["docs/"],
    sources: ["package.json"],
  },
  ci: {
    workflows: [
      { name: "CI", file: ".github/workflows/ci.yml", triggers: ["push", "pull_request"], mainSteps: ["test", "build"] },
    ],
    mainChecks: ["lint", "test", "build"],
    sources: [".github/workflows/ci.yml"],
  },
  contrib: {
    howToAddFeature: ["Create a branch", "Add code", "Write tests", "Submit PR"],
    howToAddTest: ["Add test file in test/", "Run npm test"],
    codeStyle: "ESLint + Prettier",
    sources: ["CONTRIBUTING.md"],
  },
  architecture: {
    overview: "A simple Express server with TypeScript",
    components: [
      { name: "API Layer", description: "REST endpoints", directory: "src/api/" },
      { name: "Core Logic", description: "Business logic", directory: "src/core/" },
    ],
    dataFlow: "Request -> Router -> Handler -> Service -> Response",
    keyAbstractions: [
      { name: "Handler", description: "Request handlers" },
      { name: "Service", description: "Business logic services" },
    ],
    sources: ["src/index.ts", "src/api/"],
  },
  firstTasks: [
    {
      title: "Add README badge",
      description: "Add a CI status badge to README",
      difficulty: "beginner",
      category: "docs",
      files: ["README.md"],
      why: "Easy first contribution",
    },
    {
      title: "Add unit test",
      description: "Add test for utility function",
      difficulty: "intermediate",
      category: "test",
      files: ["test/utils.test.ts", "src/utils.ts"],
      why: "Improves coverage",
    },
  ],
  runbook: {
    applicable: true,
    deploySteps: ["Build", "Push to registry", "Deploy to K8s"],
    observability: ["Prometheus metrics", "Grafana dashboards"],
    incidents: [
      { name: "High latency", check: "Check database connections" },
    ],
    sources: ["RUNBOOK.md"],
  },
};

const mockOptions: BootcampOptions = {
  branch: "main",
  focus: "all",
  audience: "oss-contributor",
  output: "./output",
  maxFiles: 200,
  noClone: false,
  verbose: false,
};

describe("generateBootcamp", () => {
  it("includes repo name in title", () => {
    const result = generateBootcamp(mockFacts, mockOptions);
    expect(result).toContain("# test/repo Bootcamp");
  });

  it("includes purpose", () => {
    const result = generateBootcamp(mockFacts, mockOptions);
    expect(result).toContain("A test repository");
  });

  it("includes stack info", () => {
    const result = generateBootcamp(mockFacts, mockOptions);
    expect(result).toContain("TypeScript");
    expect(result).toContain("Express");
  });

  it("includes prerequisites", () => {
    const result = generateBootcamp(mockFacts, mockOptions);
    expect(result).toContain("Node.js 18+");
  });

  it("includes confidence badge when present", () => {
    const result = generateBootcamp(mockFacts, mockOptions);
    expect(result).toContain("confidence-high");
  });

  it("includes next steps links", () => {
    const result = generateBootcamp(mockFacts, mockOptions);
    expect(result).toContain("ONBOARDING.md");
    expect(result).toContain("ARCHITECTURE.md");
  });
});

describe("generateOnboarding", () => {
  it("includes clone instructions", () => {
    const result = generateOnboarding(mockFacts);
    expect(result).toContain("git clone");
    expect(result).toContain("test/repo");
  });

  it("includes commands", () => {
    const result = generateOnboarding(mockFacts);
    expect(result).toContain("npm install");
    expect(result).toContain("npm run dev");
  });

  it("includes common errors", () => {
    const result = generateOnboarding(mockFacts);
    expect(result).toContain("Port already in use");
  });

  it("includes test command", () => {
    const result = generateOnboarding(mockFacts);
    expect(result).toContain("npm test");
  });
});

describe("generateArchitecture", () => {
  it("includes overview", () => {
    const result = generateArchitecture(mockFacts);
    expect(result).toContain("Express server with TypeScript");
  });

  it("includes components", () => {
    const result = generateArchitecture(mockFacts);
    expect(result).toContain("API Layer");
    expect(result).toContain("Core Logic");
  });

  it("includes mermaid diagram", () => {
    const result = generateArchitecture(mockFacts);
    expect(result).toContain("```mermaid");
    expect(result).toContain("graph");
  });

  it("includes data flow", () => {
    const result = generateArchitecture(mockFacts);
    expect(result).toContain("Request -> Router");
  });
});

describe("generateCodemap", () => {
  it("includes entrypoints", () => {
    const result = generateCodemap(mockFacts);
    expect(result).toContain("src/index.ts");
  });

  it("includes key directories", () => {
    const result = generateCodemap(mockFacts);
    expect(result).toContain("src/");
    expect(result).toContain("test/");
  });

  it("includes reading order", () => {
    const result = generateCodemap(mockFacts);
    expect(result).toContain("Reading Order");
  });
});

describe("generateFirstTasks", () => {
  it("groups by difficulty", () => {
    const result = generateFirstTasks(mockFacts);
    expect(result).toContain("Beginner Tasks");
    expect(result).toContain("Intermediate Tasks");
  });

  it("includes task details", () => {
    const result = generateFirstTasks(mockFacts);
    expect(result).toContain("Add README badge");
    expect(result).toContain("Easy first contribution");
  });

  it("includes files to look at", () => {
    const result = generateFirstTasks(mockFacts);
    expect(result).toContain("README.md");
  });
});

describe("generateRunbook", () => {
  it("includes deployment steps for services", () => {
    const result = generateRunbook(mockFacts);
    expect(result).toContain("Deployment");
    expect(result).toContain("Build");
    expect(result).toContain("Deploy to K8s");
  });

  it("includes observability info", () => {
    const result = generateRunbook(mockFacts);
    expect(result).toContain("Prometheus");
  });

  it("shows library message when not applicable", () => {
    const libraryFacts = {
      ...mockFacts,
      runbook: { applicable: false },
    };
    const result = generateRunbook(libraryFacts);
    expect(result).toContain("library/tool");
    expect(result).not.toContain("Deploy to K8s");
  });

  it("shows library message when runbook is empty", () => {
    const noRunbookFacts = {
      ...mockFacts,
      runbook: undefined,
    };
    const result = generateRunbook(noRunbookFacts);
    expect(result).toContain("library/tool");
  });
});

describe("edge cases", () => {
  it("handles empty languages array", () => {
    const emptyLanguages = {
      ...mockFacts,
      stack: { ...mockFacts.stack, languages: [] },
    };
    const result = generateBootcamp(emptyLanguages, mockOptions);
    expect(result).toContain("Bootcamp");
  });

  it("handles empty frameworks array", () => {
    const noFrameworks = {
      ...mockFacts,
      stack: { ...mockFacts.stack, frameworks: [] },
    };
    const result = generateBootcamp(noFrameworks, mockOptions);
    expect(result).toContain("Bootcamp");
  });

  it("handles empty commands array", () => {
    const noCommands = {
      ...mockFacts,
      quickstart: { ...mockFacts.quickstart, commands: [] },
    };
    const result = generateOnboarding(noCommands);
    expect(result).toContain("Onboarding");
  });

  it("handles empty firstTasks array", () => {
    const noTasks = {
      ...mockFacts,
      firstTasks: [],
    };
    const result = generateFirstTasks(noTasks);
    expect(result).toContain("First Tasks");
  });

  it("handles empty components array", () => {
    const noComponents = {
      ...mockFacts,
      architecture: { ...mockFacts.architecture, components: [] },
    };
    const result = generateArchitecture(noComponents);
    expect(result).toContain("Architecture");
  });

  it("handles empty keyDirs array", () => {
    const noDirs = {
      ...mockFacts,
      structure: { ...mockFacts.structure, keyDirs: [] },
    };
    const result = generateCodemap(noDirs);
    expect(result).toContain("Code Map");
  });

  it("handles special characters in repo name", () => {
    const specialName = {
      ...mockFacts,
      repoName: "@org/my-package",
    };
    const result = generateBootcamp(specialName, mockOptions);
    expect(result).toContain("@org/my-package");
  });

  it("handles very long description", () => {
    const longDesc = {
      ...mockFacts,
      description: "A".repeat(1000),
    };
    const result = generateBootcamp(longDesc, mockOptions);
    expect(result.length).toBeGreaterThan(1000);
  });

  it("handles different audience options", () => {
    const audiences: Array<"new-hire" | "oss-contributor" | "internal-dev"> = [
      "new-hire",
      "oss-contributor",
      "internal-dev",
    ];
    for (const audience of audiences) {
      const opts = { ...mockOptions, audience };
      const result = generateBootcamp(mockFacts, opts);
      expect(result).toContain("Bootcamp");
    }
  });

  it("handles different focus options", () => {
    const focusTypes: Array<"onboarding" | "architecture" | "contributing" | "all"> = [
      "onboarding",
      "architecture",
      "contributing",
      "all",
    ];
    for (const focus of focusTypes) {
      const opts = { ...mockOptions, focus };
      const result = generateBootcamp(mockFacts, opts);
      expect(result).toContain("Bootcamp");
    }
  });

  it("handles missing confidence field", () => {
    const noConfidence = {
      ...mockFacts,
      confidence: undefined,
    };
    const result = generateBootcamp(noConfidence, mockOptions);
    expect(result).toContain("Bootcamp");
  });

  it("handles all difficulty levels in tasks", () => {
    const allDifficulties = {
      ...mockFacts,
      firstTasks: [
        { title: "Easy", description: "d", difficulty: "beginner" as const, category: "docs" as const, files: [], why: "w" },
        { title: "Medium", description: "d", difficulty: "intermediate" as const, category: "test" as const, files: [], why: "w" },
        { title: "Hard", description: "d", difficulty: "advanced" as const, category: "feature" as const, files: [], why: "w" },
      ],
    };
    const result = generateFirstTasks(allDifficulties);
    expect(result).toContain("Beginner");
    expect(result).toContain("Intermediate");
    expect(result).toContain("Advanced");
  });

  it("handles incidents in runbook", () => {
    const result = generateRunbook(mockFacts);
    expect(result).toContain("High latency");
    expect(result).toContain("database connections");
  });
});
