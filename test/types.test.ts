/**
 * Type smoke tests for exported interfaces
 */

import { describe, it, expect } from "vitest";
import type {
  BootcampOptions,
  RepoInfo,
  StackInfo,
  Entrypoint,
  Command,
  FileInfo,
  RadarSignal,
  TechRadar,
  ChangeImpact,
  DiffSummary,
  ChatMessage,
  Transcript,
  CIWorkflow,
  DirectoryInfo,
  FirstTask,
  RepoFacts,
  ScanResult,
  StylePack,
} from "../src/types.js";

describe("types", () => {
  it("BootcampOptions supports required fields", () => {
    const options: BootcampOptions = {
      branch: "main",
      focus: "all",
      audience: "oss-contributor",
      output: "./out",
      maxFiles: 100,
      noClone: false,
      verbose: false,
    };

    expect(options.focus).toBe("all");
    expect(options.audience).toBe("oss-contributor");
  });

  it("BootcampOptions supports all optional fields", () => {
    const options: BootcampOptions = {
      branch: "main",
      focus: "onboarding",
      audience: "new-hire",
      output: "./out",
      maxFiles: 50,
      noClone: true,
      verbose: true,
      model: "claude-opus-4-5",
      keepTemp: true,
      jsonOnly: true,
      stats: true,
      fast: true,
      interactive: true,
      transcript: true,
      compare: "v1.0.0",
      createIssues: true,
      dryRun: true,
      format: "html",
      renderDiagrams: true,
      diagramFormat: "png",
      style: "enterprise",
      web: true,
      fullClone: true,
      watch: true,
      watchInterval: 60,
      noCache: true,
      repoPrompts: ".bootcamp.md",
    };

    expect(options.model).toBe("claude-opus-4-5");
    expect(options.style).toBe("enterprise");
    expect(options.diagramFormat).toBe("png");
    expect(options.watchInterval).toBe(60);
    expect(options.format).toBe("html");
  });

  it("BootcampOptions focus values are constrained", () => {
    const validFoci: BootcampOptions["focus"][] = [
      "onboarding",
      "architecture",
      "contributing",
      "all",
    ];
    expect(validFoci).toHaveLength(4);
  });

  it("BootcampOptions audience values are constrained", () => {
    const validAudiences: BootcampOptions["audience"][] = [
      "new-hire",
      "oss-contributor",
      "internal-dev",
    ];
    expect(validAudiences).toHaveLength(3);
  });

  it("core repo types are usable at runtime", () => {
    const repoInfo: RepoInfo = {
      owner: "owner",
      repo: "repo",
      url: "https://github.com/owner/repo",
      branch: "main",
      fullName: "owner/repo",
    };

    const stack: StackInfo = {
      languages: ["TypeScript"],
      frameworks: ["Express"],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: true,
    };

    const entrypoint: Entrypoint = {
      path: "src/index.ts",
      type: "cli",
      description: "Main CLI entrypoint",
    };

    const command: Command = {
      name: "build",
      command: "npm run build",
      source: "package.json",
      description: "Build the project",
    };

    const fileInfo: FileInfo = {
      path: "src/index.ts",
      size: 42,
      isDirectory: false,
    };

    expect(repoInfo.fullName).toBe("owner/repo");
    expect(stack.frameworks).toContain("Express");
    expect(entrypoint.type).toBe("cli");
    expect(command.name).toBe("build");
    expect(fileInfo.isDirectory).toBe(false);
  });

  it("RepoInfo supports optional commitSha", () => {
    const repoInfo: RepoInfo = {
      owner: "owner",
      repo: "repo",
      url: "https://github.com/owner/repo",
      branch: "main",
      fullName: "owner/repo",
      commitSha: "abc1234",
    };

    expect(repoInfo.commitSha).toBe("abc1234");
  });

  it("RadarSignal has valid categories", () => {
    const signals: RadarSignal[] = [
      { name: "React", category: "modern", reason: "Latest version" },
      { name: "Express", category: "stable", reason: "Well maintained" },
      { name: "jQuery", category: "legacy", reason: "Outdated" },
      { name: "eval()", category: "risky", reason: "Security concern" },
    ];

    expect(signals.map((s) => s.category)).toEqual([
      "modern",
      "stable",
      "legacy",
      "risky",
    ]);
  });

  it("TechRadar structure is complete", () => {
    const radar: TechRadar = {
      modern: [{ name: "React", category: "modern", reason: "Latest" }],
      stable: [],
      legacy: [],
      risky: [],
      onboardingRisk: {
        score: 25,
        grade: "A",
        factors: ["Good docs", "CI present"],
      },
    };

    expect(radar.onboardingRisk.score).toBe(25);
    expect(radar.onboardingRisk.grade).toBe("A");
    expect(radar.modern).toHaveLength(1);
    expect(radar.onboardingRisk.factors).toHaveLength(2);
  });

  it("ChangeImpact tracks affected files and imports", () => {
    const impact: ChangeImpact = {
      file: "src/utils.ts",
      affectedFiles: ["src/app.ts", "src/server.ts"],
      affectedTests: ["test/utils.test.ts"],
      affectedDocs: ["docs/api.md"],
      importedBy: ["src/app.ts"],
      imports: ["src/types.ts"],
    };

    expect(impact.file).toBe("src/utils.ts");
    expect(impact.affectedFiles).toHaveLength(2);
    expect(impact.affectedTests).toHaveLength(1);
    expect(impact.imports).toContain("src/types.ts");
  });

  it("DiffSummary captures onboarding deltas", () => {
    const diff: DiffSummary = {
      baseRef: "v1.0.0",
      headRef: "HEAD",
      filesChanged: 5,
      filesAdded: ["src/new.ts"],
      filesRemoved: ["src/old.ts"],
      filesModified: ["src/app.ts", "package.json"],
      onboardingDeltas: {
        newDependencies: ["lodash"],
        removedDependencies: ["underscore"],
        newEnvVars: ["API_KEY"],
        newCommands: ["npm run lint"],
        breakingChanges: ["Removed default export"],
      },
    };

    expect(diff.baseRef).toBe("v1.0.0");
    expect(diff.filesChanged).toBe(5);
    expect(diff.onboardingDeltas.newDependencies).toContain("lodash");
    expect(diff.onboardingDeltas.breakingChanges).toHaveLength(1);
  });

  it("ChatMessage supports user and assistant roles", () => {
    const userMsg: ChatMessage = {
      role: "user",
      content: "How does auth work?",
      timestamp: new Date("2024-01-01"),
    };

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: "Auth uses JWT tokens.",
      citations: ["src/auth.ts", "src/middleware.ts"],
      timestamp: new Date("2024-01-01"),
    };

    expect(userMsg.role).toBe("user");
    expect(userMsg.citations).toBeUndefined();
    expect(assistantMsg.citations).toHaveLength(2);
  });

  it("Transcript holds a conversation", () => {
    const transcript: Transcript = {
      repoName: "owner/repo",
      startedAt: new Date("2024-01-01"),
      messages: [
        {
          role: "user",
          content: "Hello",
          timestamp: new Date("2024-01-01T00:00:01Z"),
        },
        {
          role: "assistant",
          content: "Hi there!",
          timestamp: new Date("2024-01-01T00:00:02Z"),
        },
      ],
    };

    expect(transcript.messages).toHaveLength(2);
    expect(transcript.repoName).toBe("owner/repo");
  });

  it("CIWorkflow captures workflow metadata", () => {
    const workflow: CIWorkflow = {
      name: "CI",
      file: ".github/workflows/ci.yml",
      triggers: ["push", "pull_request"],
      mainSteps: ["checkout", "install", "test"],
    };

    expect(workflow.triggers).toContain("push");
    expect(workflow.mainSteps).toHaveLength(3);
  });

  it("DirectoryInfo describes directories", () => {
    const dir: DirectoryInfo = {
      path: "src/",
      purpose: "Source code",
      keyFiles: ["index.ts", "app.ts"],
    };

    expect(dir.path).toBe("src/");
    expect(dir.keyFiles).toHaveLength(2);
  });

  it("DirectoryInfo keyFiles is optional", () => {
    const dir: DirectoryInfo = {
      path: "docs/",
      purpose: "Documentation",
    };

    expect(dir.keyFiles).toBeUndefined();
  });

  it("FirstTask has valid difficulty and category", () => {
    const task: FirstTask = {
      title: "Add unit tests",
      description: "Write tests for utils module",
      difficulty: "beginner",
      category: "test",
      files: ["src/utils.ts", "test/utils.test.ts"],
      why: "Improves coverage",
    };

    expect(task.difficulty).toBe("beginner");
    expect(task.category).toBe("test");
    expect(task.files).toHaveLength(2);
  });

  it("FirstTask supports all difficulty levels", () => {
    const difficulties: FirstTask["difficulty"][] = [
      "beginner",
      "intermediate",
      "advanced",
    ];
    expect(difficulties).toHaveLength(3);
  });

  it("FirstTask supports all categories", () => {
    const categories: FirstTask["category"][] = [
      "bug-fix",
      "test",
      "docs",
      "refactor",
      "feature",
    ];
    expect(categories).toHaveLength(5);
  });

  it("Entrypoint supports all type values", () => {
    const types: Entrypoint["type"][] = [
      "main",
      "binary",
      "server",
      "cli",
      "web",
      "library",
    ];
    expect(types).toHaveLength(6);
  });

  it("StylePack has valid values", () => {
    const packs: StylePack[] = ["startup", "enterprise", "oss", "devops"];
    expect(packs).toHaveLength(4);
  });

  it("ScanResult uses Map for keySourceFiles", () => {
    const scan: ScanResult = {
      files: [{ path: "src/index.ts", size: 100, isDirectory: false }],
      stack: {
        languages: ["TypeScript"],
        frameworks: [],
        buildSystem: "npm",
        packageManager: "npm",
        hasDocker: false,
        hasCi: false,
      },
      commands: [],
      ciWorkflows: [],
      readme: "# Hello",
      contributing: null,
      keySourceFiles: new Map([["src/index.ts", "console.log('hello')"]]),
    };

    expect(scan.keySourceFiles).toBeInstanceOf(Map);
    expect(scan.keySourceFiles.get("src/index.ts")).toBeDefined();
    expect(scan.readme).toBe("# Hello");
    expect(scan.contributing).toBeNull();
  });

  it("RepoFacts supports the full nested structure", () => {
    const facts: RepoFacts = {
      repoName: "test/repo",
      purpose: "A test repo",
      description: "For testing",
      confidence: "high",
      sources: ["README.md"],
      stack: {
        languages: ["TypeScript"],
        frameworks: ["Express"],
        buildSystem: "npm",
        packageManager: "npm",
        hasDocker: true,
        hasCi: true,
      },
      quickstart: {
        prerequisites: ["Node.js 18+"],
        steps: ["npm install", "npm start"],
        commands: [
          { name: "start", command: "npm start", source: "package.json" },
        ],
        commonErrors: [{ error: "ENOENT", fix: "Run npm install first" }],
        sources: ["README.md"],
      },
      structure: {
        keyDirs: [{ path: "src/", purpose: "Source code" }],
        entrypoints: [{ path: "src/index.ts", type: "cli" }],
        testDirs: ["test/"],
        docsDirs: ["docs/"],
        sources: ["Directory listing"],
      },
      ci: {
        workflows: [
          {
            name: "CI",
            file: ".github/workflows/ci.yml",
            triggers: ["push"],
            mainSteps: ["test"],
          },
        ],
        mainChecks: ["lint", "test"],
        sources: [".github/workflows/ci.yml"],
      },
      contrib: {
        howToAddFeature: ["Create a branch", "Open a PR"],
        howToAddTest: ["Add file in test/"],
        codeStyle: "Prettier + ESLint",
        sources: ["CONTRIBUTING.md"],
      },
      architecture: {
        overview: "Monolithic CLI app",
        components: [
          { name: "CLI", description: "Command handler", directory: "src/" },
        ],
        dataFlow: "CLI -> Agent -> Generator",
        keyAbstractions: [
          { name: "RepoFacts", description: "Core data model" },
        ],
        codeExamples: [
          {
            title: "Entry point",
            file: "src/index.ts",
            code: "program.parse()",
            explanation: "Starts the CLI",
          },
        ],
        sources: ["Source code"],
      },
      firstTasks: [
        {
          title: "Fix typo",
          description: "Fix typo in README",
          difficulty: "beginner",
          category: "docs",
          files: ["README.md"],
          why: "Easy first contribution",
        },
      ],
      runbook: {
        applicable: true,
        deploySteps: ["npm run build", "npm publish"],
        observability: ["console logs"],
        incidents: [{ name: "OOM", check: "Check memory usage" }],
        sources: ["RUNBOOK.md"],
      },
    };

    expect(facts.repoName).toBe("test/repo");
    expect(facts.confidence).toBe("high");
    expect(facts.quickstart.commonErrors).toHaveLength(1);
    expect(facts.architecture.keyAbstractions).toHaveLength(1);
    expect(facts.architecture.codeExamples).toHaveLength(1);
    expect(facts.runbook?.applicable).toBe(true);
    expect(facts.runbook?.incidents).toHaveLength(1);
  });

  it("RepoFacts runbook is optional", () => {
    const facts: RepoFacts = {
      repoName: "test/repo",
      purpose: "A test repo",
      description: "For testing",
      stack: {
        languages: [],
        frameworks: [],
        buildSystem: "",
        packageManager: null,
        hasDocker: false,
        hasCi: false,
      },
      quickstart: { prerequisites: [], steps: [], commands: [] },
      structure: {
        keyDirs: [],
        entrypoints: [],
        testDirs: [],
        docsDirs: [],
      },
      ci: { workflows: [], mainChecks: [] },
      contrib: { howToAddFeature: [], howToAddTest: [] },
      architecture: { overview: "", components: [] },
      firstTasks: [],
    };

    expect(facts.runbook).toBeUndefined();
    expect(facts.confidence).toBeUndefined();
    expect(facts.sources).toBeUndefined();
  });

  it("StackInfo packageManager can be null", () => {
    const stack: StackInfo = {
      languages: ["Rust"],
      frameworks: [],
      buildSystem: "cargo",
      packageManager: null,
      hasDocker: false,
      hasCi: false,
    };

    expect(stack.packageManager).toBeNull();
  });
});
