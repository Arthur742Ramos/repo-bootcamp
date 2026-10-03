import type { RepoFacts } from "../../src/types.js";

export function runbookFacts(): RepoFacts {
  return {
    repoName: "local/runbook-fixture",
    purpose: "A library with declared build guidance",
    description: "Owned metadata-only library fixture.",
    confidence: "high",
    sources: ["package.json", "README.md"],
    stack: {
      languages: ["TypeScript"],
      frameworks: [],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: false,
    },
    quickstart: { prerequisites: [], steps: [], commands: [], commonErrors: [], sources: [] },
    structure: {
      keyDirs: [{ path: "src/", purpose: "Library source", keyFiles: ["src/index.ts"] }],
      entrypoints: [{ path: "src/index.ts", type: "library", description: "Public API" }],
      testDirs: [],
      docsDirs: [],
      sources: ["src/index.ts"],
    },
    ci: { workflows: [], mainChecks: [], sources: [] },
    contrib: { howToAddFeature: [], howToAddTest: [], sources: [] },
    architecture: {
      overview: "A library package",
      components: [],
      dataFlow: "Library calls",
      keyAbstractions: [],
      sources: [],
    },
    firstTasks: [],
    runbook: { applicable: false, deploySteps: [], observability: [], incidents: [], sources: [] },
  };
}
