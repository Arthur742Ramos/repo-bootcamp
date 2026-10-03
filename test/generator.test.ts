/**
 * Tests for document generators
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  generateBootcamp,
  generateOnboarding,
  generateArchitecture,
  generateCodemap,
  generateFirstTasks,
  getFirstTaskRecommendations,
  generateRunbook,
} from "../src/generator.js";
import { convertToHtml, convertToPdf, markdownToHtml } from "../src/formatter.js";
import { parseGitHubUrl } from "../src/ingest.js";
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
    commonErrors: [{ error: "Port already in use", fix: "Kill the process using port 3000" }],
    sources: ["README.md"],
  },
  structure: {
    keyDirs: [
      { path: "src/", purpose: "Main source code", keyFiles: ["src/index.ts"] },
      { path: "test/", purpose: "Test files" },
    ],
    entrypoints: [{ path: "src/index.ts", type: "main", description: "Main entry point" }],
    testDirs: ["test/", "__tests__/"],
    docsDirs: ["docs/"],
    sources: ["package.json"],
  },
  ci: {
    workflows: [
      {
        name: "CI",
        file: ".github/workflows/ci.yml",
        triggers: ["push", "pull_request"],
        mainSteps: ["test", "build"],
      },
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
    incidents: [{ name: "High latency", check: "Check database connections" }],
    sources: ["RUNBOOK.md"],
  },
};

const mockOptions: BootcampOptions = {
  branch: "main",
  focus: "all",
  audience: "backend",
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

  it("applies style-specific links and tone", () => {
    const startup = generateBootcamp(mockFacts, { ...mockOptions, style: "startup" });
    const minimal = generateBootcamp(mockFacts, { ...mockOptions, style: "minimal" });

    expect(startup).toContain("Let's get you up and running fast");
    expect(minimal).toContain("Concise onboarding essentials");
    expect(minimal).not.toContain("SECURITY.md");
    expect(minimal).not.toContain("RUNBOOK.md");
  });
});

describe("generateOnboarding", () => {
  it.each([
    ["install", "uv sync --frozen --group dev"],
    ["prepare", "poetry install --with dev"],
    ["setup", "npm install --save-dev server-tools"],
    ["dependencies", "pip install pytest"],
    ["latest", "echo latest"],
    ["restart", "echo restart"],
    ["observe", "echo observe"],
    ["inspect", "node ./scripts/server-test.js"],
    ["prepare", "cp ./dev/server ./test/fixtures"],
    ["prepare", "npm run build -- --output ./dev/server"],
    ["prepare", "echo dev && npm install"],
    ["dev", "vite --help"],
    ["dev", "npm run install:dev"],
    ["prepare", "npm run build:test-fixtures"],
    ["prepare", "make build-test-fixtures"],
    ["prepare", "npm run dev:build"],
    ["prepare", "npm run watch:test-build"],
    ["unit tests", "task watch:unit:build"],
    ["inspect", "uv run dev-tools.py --self-test"],
    ["inspect", "poetry run build-tools.py"],
    ["inspect", "uv run ./dev-tools --self-test"],
  ])("does not label %s / %s as a development server", (name, command) => {
    const facts = structuredClone(mockFacts);
    facts.quickstart.commands = [{ name, command, source: "README.md" }];
    expect(generateOnboarding(facts)).not.toContain("Start the dev server/watch mode");
    expect(generateBootcamp(facts, mockOptions)).not.toContain("Run the dev server:");
  });

  it.each([
    ["dev:web", "node app.js"],
    ["launch", "npm run dev -- --port 4000"],
    ["launch", "pnpm run app:dev"],
    ["launch", "yarn start"],
    ["launch", "bun run 'dev:web'"],
    ["launch", "make serve"],
    ["launch", "just watch"],
    ["launch", "task app:dev"],
    ["launch", "poetry run serve"],
    ["launch", "uv run --frozen --group dev uvicorn app:app"],
    ["launch", "npx vite"],
    ["launch", "python manage.py runserver"],
    ["Preview docs", "python3 -m http.server 8000"],
    ["server", "node app.js"],
    ["launch", "npm run server"],
    ["dev", "uv run dev-tools.py"],
    ["launch", "uv run ./node_modules/.bin/vite"],
    ["launch", "dotnet watch"],
  ])("recognizes the development role of %s / %s", (name, command) => {
    const facts = structuredClone(mockFacts);
    facts.quickstart.commands = [{ name, command, source: "README.md" }];
    expect(generateOnboarding(facts)).toContain(`Start the dev server/watch mode (\`${command}\`)`);
    expect(generateBootcamp(facts, mockOptions)).toContain(`Run the dev server: \`${command}\``);
  });

  it.each([
    ["unit tests", "python -m unittest"],
    ["verify", "npm run test:unit"],
    ["verify", "uv run --group dev pytest"],
    ["verify", "poetry run pytest"],
    ["verify", "cargo test"],
    ["verify", "go test ./..."],
    ["verify", "npx playwright test"],
    ["verify", "npm run test:watch"],
    ["verify", "npm run 'test:unit'"],
    ["verify", "npm run watch:test-build"],
    ["unit tests", "task watch:unit:build"],
  ])("selects real test commands %s / %s", (name, command) => {
    const facts = structuredClone(mockFacts);
    facts.quickstart.commands = [{ name, command, source: "README.md" }];
    const result = generateOnboarding(facts);
    expect(result).toContain(`## Running Tests\n\n\`\`\`bash\n${command}\n\`\`\``);
    expect(result).not.toContain("Start the dev server/watch mode");
  });

  it.each([
    ["latest", "echo latest"],
    ["contest", "node contest.js"],
    ["install", "pip install pytest"],
    ["prepare", "cp ./test/fixtures ./output"],
    ["test", "vitest --version"],
    ["prepare", "npm run build:test-fixtures"],
    ["prepare", "make build-test-fixtures"],
  ])("does not invent a test role from %s / %s", (name, command) => {
    const facts = structuredClone(mockFacts);
    facts.quickstart.commands = [{ name, command, source: "README.md" }];
    expect(generateOnboarding(facts)).toContain("_No test command detected_");
  });

  it("uses a real build/test command for verification instead of the first setup command", () => {
    const facts = structuredClone(mockFacts);
    facts.quickstart.commands = [
      { name: "install", command: "uv sync --group dev", source: "README.md" },
      { name: "compile", command: "cargo build", source: "README.md" },
    ];
    const result = generateBootcamp(facts, mockOptions);
    expect(result).toContain("Build/verify: `cargo build`");
    expect(result).not.toContain("Build/verify: `uv sync");
  });

  it("keeps development build variants in build verification", () => {
    const facts = structuredClone(mockFacts);
    facts.quickstart.commands = [
      { name: "compile", command: "npm run dev:build", source: "package.json" },
    ];
    expect(generateBootcamp(facts, mockOptions)).toContain("Build/verify: `npm run dev:build`");
    expect(generateOnboarding(facts)).toContain("_No test command detected_");
  });

  it("does not infer build verification from a Poetry filename", () => {
    const facts = structuredClone(mockFacts);
    facts.quickstart.commands = [
      { name: "inspect", command: "poetry run build-tools.py", source: "README.md" },
    ];
    expect(generateBootcamp(facts, mockOptions)).not.toContain("Build/verify: `poetry run");
    facts.quickstart.commands[0].name = "build";
    expect(generateBootcamp(facts, mockOptions)).toContain(
      "Build/verify: `poetry run build-tools.py`"
    );
  });
  it("includes clone instructions", () => {
    const result = generateOnboarding(mockFacts);
    expect(result).toContain("git clone");
    expect(result).toContain("test/repo");
    expect(result).toContain("git clone https://github.com/test/repo.git\ncd repo");
  });

  it.each([
    "https://github.com/owner/project",
    "https://gitlab.com/group/team/project",
    "https://bitbucket.org/team/project",
  ])("uses the actual remote and scoped checkout for %s", (url) => {
    const repoInfo = { ...parseGitHubUrl(url), sourcePathPrefix: "packages/my app" };
    const result = generateOnboarding(mockFacts, undefined, { repoInfo });
    expect(result).toContain(
      `git clone --branch 'main' -- '${url}.git'\ncd -- 'project/packages/my app'`
    );
    expect(result).not.toContain("git clone https://github.com/test/repo");
    expect(result).not.toContain("cd team");
    expect(result).toContain("Check existing repository issues");
    expect(result).not.toContain("Check existing issues on GitHub");
  });

  it.each(["main", "master", "local", "release/v2", "feature's $branch"])(
    "preserves the analyzed remote branch %s without changing documented commands",
    (branch) => {
      const facts = structuredClone(mockFacts);
      facts.quickstart.commands = facts.quickstart.commands.filter(
        (command) => command.name !== "install"
      );
      facts.quickstart.commands.push({
        name: "install",
        command: "npm ci --ignore-scripts",
        source: "README.md",
      });
      const repoInfo = { ...parseGitHubUrl("owner/project"), branch };
      const result = generateOnboarding(facts, undefined, { repoInfo });
      const quoted = "'" + branch.replace(/'/g, `'"'"'`) + "'";
      expect(result).toContain(
        `git clone --branch ${quoted} -- 'https://github.com/owner/project.git'`
      );
      expect(result).toContain("# Install dependencies\nnpm ci --ignore-scripts");
    }
  );

  it("uses an explicit analyzed tag when Git reports detached HEAD and retains .git URLs", () => {
    const repoInfo = {
      ...parseGitHubUrl("owner/project"),
      url: "https://github.com/owner/project.git",
      branch: "HEAD",
    };
    const result = generateOnboarding(mockFacts, undefined, { repoInfo, ref: "v2.0" });
    expect(result).toContain("git clone --branch 'v2.0' -- 'https://github.com/owner/project.git'");
    expect(result).not.toContain(".git.git");
  });

  it.each(["", "HEAD"])("does not invent a clone ref from %j", (branch) => {
    const repoInfo = { ...parseGitHubUrl("owner/project"), branch };
    expect(generateOnboarding(mockFacts, undefined, { repoInfo })).toContain(
      "git clone -- 'https://github.com/owner/project.git'"
    );
  });

  it("keeps explicit ref metadata out of local checkout instructions", () => {
    const repoInfo = {
      ...parseGitHubUrl("owner/project"),
      url: "file:///checkout",
      branch: "release/v2",
    };
    const result = generateOnboarding(mockFacts, undefined, {
      repoInfo,
      ref: "v2.0",
      localPath: "/checkout",
    });
    expect(result).toContain("cd -- '/checkout'");
    expect(result).not.toContain("git clone");
    expect(result).not.toContain("--branch");
  });

  it("uses an existing local scope and quotes shell metacharacters", () => {
    const result = generateOnboarding(mockFacts, undefined, {
      repoInfo: {
        ...parseGitHubUrl("owner/project"),
        url: "file:///checkout",
        sourcePathPrefix: "packages/app",
      },
      localPath: "/checkout/My app's $data;folder",
    });
    expect(result).toContain("## Checkout & Install");
    expect(result).toContain(`cd -- '/checkout/My app'"'"'s $data;folder'`);
    expect(result).not.toContain("git clone");
    expect(result).not.toContain("github.com/local/");
  });

  it("retains literal POSIX backslashes and formats Windows paths for the Bash instructions", () => {
    const repoInfo = { ...parseGitHubUrl("owner/project"), url: "file:///checkout" };
    expect(
      generateOnboarding(mockFacts, undefined, { repoInfo, localPath: "/checkout/back\\slash" })
    ).toContain("cd -- '/checkout/back\\slash'");
    expect(
      generateOnboarding(mockFacts, undefined, { repoInfo, localPath: "C:\\Users\\Arthur\\My app" })
    ).toContain("cd -- 'C:/Users/Arthur/My app'");
  });

  it("uses the local URL and selected prefix when no explicit checkout path is supplied", () => {
    const root = join(tmpdir(), "My app#notes");
    const result = generateOnboarding(mockFacts, undefined, {
      repoInfo: {
        ...parseGitHubUrl("owner/project"),
        url: pathToFileURL(root).href,
        sourcePathPrefix: "packages/my app",
      },
    });
    const selectedPath = join(root, "packages/my app");
    const bashPath = /^[A-Za-z]:\\/.test(selectedPath)
      ? selectedPath.replace(/\\/g, "/")
      : selectedPath;
    expect(result).toContain(`cd -- '${bashPath}'`);
    expect(result).not.toContain("My%20app%23notes");
    expect(result).not.toContain("git clone");
  });

  it("includes commands", () => {
    const result = generateOnboarding(mockFacts);
    expect(result).toContain("npm install");
    expect(result).toContain("npm run dev");
  });

  it.each(["npm", "pnpm", "yarn", "bun"])(
    "retains the known %s installation convention without a documented install command",
    (packageManager) => {
      const facts = structuredClone(mockFacts);
      facts.stack.packageManager = packageManager;
      facts.quickstart.commands = facts.quickstart.commands.filter((c) => c.name !== "install");
      expect(generateOnboarding(facts)).toContain(
        `# Install dependencies\n${packageManager} install`
      );
    }
  );

  it.each(["pip", "cargo", "poetry", "uv", "custom-tool", null])(
    "uses setup documentation instead of inventing an install command for %s",
    (packageManager) => {
      const facts = structuredClone(mockFacts);
      facts.stack.packageManager = packageManager;
      facts.quickstart.commands = [{ name: "test", command: "make test", source: "README.md" }];
      const result = generateOnboarding(facts);
      expect(result).toContain(
        "cd repo\n```\n\nFollow the repository's README or contribution guide"
      );
      expect(result).not.toContain("# Install dependencies");
      expect(result).not.toContain(`${packageManager || "npm"} install`);
      expect(result).toContain("make test");
      const html = markdownToHtml(result);
      expect(html).toContain("<p>Follow the repository's README or contribution guide");
    }
  );

  it.each(["pip", "cargo", "poetry", "uv", null])(
    "preserves documented installation commands verbatim for %s",
    (packageManager) => {
      const facts = structuredClone(mockFacts);
      facts.stack.packageManager = packageManager;
      const command = "python3 -m venv '.venv'\npython3 -m pip install -r 'requirements dev.txt'";
      facts.quickstart.commands = [{ name: "install", command, source: "README.md" }];
      expect(generateOnboarding(facts)).toContain(`# Install dependencies\n${command}\n\`\`\``);
    }
  );

  it("includes common errors", () => {
    const result = generateOnboarding(mockFacts);
    expect(result).toContain("Port already in use");
  });

  it("includes test command", () => {
    const result = generateOnboarding(mockFacts);
    expect(result).toContain("npm test");
  });

  it("includes audience-specific onboarding journey", () => {
    const result = generateOnboarding(mockFacts, { audience: "frontend" });
    expect(result).toContain("Frontend Start Here");
    expect(result).toContain("Suggested first tasks");
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

  it("includes audience-specific architecture focus", () => {
    const result = generateArchitecture(mockFacts, { audience: "sre" });
    expect(result).toContain("Operations & Reliability Focus");
    expect(result).toContain(".github/workflows/ci.yml");
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
  it("numbers sections in display order while recommending by audience priority", () => {
    const firstTasks = [
      {
        ...mockFacts.firstTasks[0],
        title: "Server feature",
        difficulty: "advanced" as const,
        category: "feature" as const,
        files: ["src/server.ts"],
      },
      {
        ...mockFacts.firstTasks[0],
        title: "Setup notes",
        difficulty: "beginner" as const,
        category: "docs" as const,
        files: ["README.md"],
      },
      {
        ...mockFacts.firstTasks[0],
        title: "Request test",
        difficulty: "beginner" as const,
        category: "test" as const,
        files: ["test/request.ts"],
      },
    ];
    const input = { ...mockFacts, firstTasks };
    const picks = getFirstTaskRecommendations(input, { audience: "backend" });
    expect(picks.map(({ title, taskNumber }) => [title, taskNumber])).toEqual([
      ["Server feature", 3],
      ["Request test", 1],
      ["Setup notes", 2],
    ]);
    const doc = generateFirstTasks(input, { audience: "backend" });
    expect(doc.indexOf("### 1. Request test")).toBeLessThan(doc.indexOf("### 2. Setup notes"));
    expect(doc.indexOf("### 2. Setup notes")).toBeLessThan(doc.indexOf("### 3. Server feature"));
    expect(input.firstTasks.map((task) => task.title)).toEqual([
      "Server feature",
      "Setup notes",
      "Request test",
    ]);
  });

  it("gives repeated task objects separate section numbers and respects minimal style limits", () => {
    const task = { ...mockFacts.firstTasks[0], title: "Repeated task" };
    const input = { ...mockFacts, firstTasks: [task, task, task, task] };
    const picks = getFirstTaskRecommendations(input, { style: "minimal" });
    expect(picks.map((task) => task.taskNumber)).toEqual([1, 2, 3]);
    const doc = generateFirstTasks(input, { style: "minimal" });
    expect(doc).toContain("### 3. Repeated task");
    expect(doc).not.toContain("### 4.");
  });

  it("does not recommend tasks when no task sections are generated", () => {
    expect(getFirstTaskRecommendations({ ...mockFacts, firstTasks: [] })).toEqual([]);
  });

  it("retains the complete formatted task heading identity", () => {
    const input = {
      ...mockFacts,
      firstTasks: [{ ...mockFacts.firstTasks[0], title: "Fix **retry** & `timeout` behavior" }],
    };
    const [pick] = getFirstTaskRecommendations(input);
    expect(pick.taskHeadingHtml).toBe(
      '<h3 id="1-fix-retry-timeout-behavior">1. Fix <strong>retry</strong> &amp; <code>timeout</code> behavior</h3>'
    );
  });
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

  it("includes audience-specific first-task picks", () => {
    const result = generateFirstTasks(mockFacts, { audience: "backend" });
    expect(result).toContain("Backend-first task picks");
    expect(result).toContain("Add unit test");
  });

  it("limits and simplifies tasks for minimal style", () => {
    const expandedFacts = {
      ...mockFacts,
      firstTasks: Array.from({ length: 6 }, (_, i) => ({
        title: `Task ${i + 1}`,
        description: `Description ${i + 1}`,
        difficulty: (i % 3 === 0 ? "beginner" : i % 3 === 1 ? "intermediate" : "advanced") as
          "beginner" | "intermediate" | "advanced",
        category: "docs" as const,
        files: [`file-${i + 1}.ts`],
        why: `Why ${i + 1}`,
      })),
    };

    const minimal = generateFirstTasks(expandedFacts, { audience: "backend", style: "minimal" });
    const corporate = generateFirstTasks(expandedFacts, {
      audience: "backend",
      style: "corporate",
    });

    expect((minimal.match(/^### /gm) || []).length).toBe(3);
    expect(minimal).not.toContain("Why this matters");
    expect(corporate).toContain("Why this matters");
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
    const audiences: Array<"backend" | "frontend" | "sre"> = ["backend", "frontend", "sre"];
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
        {
          title: "Easy",
          description: "d",
          difficulty: "beginner" as const,
          category: "docs" as const,
          files: [],
          why: "w",
        },
        {
          title: "Medium",
          description: "d",
          difficulty: "intermediate" as const,
          category: "test" as const,
          files: [],
          why: "w",
        },
        {
          title: "Hard",
          description: "d",
          difficulty: "advanced" as const,
          category: "feature" as const,
          files: [],
          why: "w",
        },
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

describe("scoped remote documentation links", () => {
  it("links architecture, codemap and first tasks to the package while keeping displayed paths relative", () => {
    const repoInfo = {
      owner: "owner",
      repo: "project",
      fullName: "owner/project",
      url: "https://github.com/owner/project",
      branch: "main",
      host: "github.com",
      sourcePathPrefix: "packages/app",
    };
    const facts = {
      ...mockFacts,
      firstTasks: [
        {
          title: "Fix entry",
          description: "Fix entry",
          why: "Learn",
          difficulty: "beginner" as const,
          category: "bug-fix" as const,
          files: ["src/index.ts"],
        },
      ],
    };
    const expected =
      "[`src/index.ts`](https://github.com/owner/project/blob/main/packages/app/src/index.ts)";
    expect(generateArchitecture(facts, undefined, repoInfo)).toContain(expected);
    expect(generateCodemap(facts, repoInfo)).toContain(expected);
    expect(generateFirstTasks(facts, undefined, undefined, repoInfo)).toContain(expected);
  });
});

describe("generated HTML source links", () => {
  it("keeps bracketed route sources clickable with code formatting", () => {
    const path = "src/routes/[id]/page.ts";
    const facts = {
      ...mockFacts,
      structure: {
        ...mockFacts.structure,
        entrypoints: [{ path, type: "route", description: "Dynamic route" }],
      },
    };
    const repoInfo = {
      owner: "owner",
      repo: "project",
      fullName: "owner/project",
      url: "https://github.com/owner/project",
      branch: "main",
      host: "github.com",
      sourcePathPrefix: "packages/app",
    };
    const html = markdownToHtml(generateCodemap(facts, repoInfo));
    expect(html).toContain(
      '<a href="https://github.com/owner/project/blob/main/packages/app/src/routes/%5Bid%5D/page.ts"><code>src/routes/[id]/page.ts</code></a>'
    );
  });
});

describe("literal generated command presentation", () => {
  const commands = [
    "npm run test",
    "npm run 'test`literal`'",
    "npm run 'dev```literal```'",
    "npm run 'test  unit'",
    "printf '%s\\n' 'first\n```\nlast'",
    "printf '%s' '<img src=x onerror=alert(1)>&'",
    "echo '[source](./ONBOARDING.md)'",
    "echo 'left|right'",
    "  npm run test  ",
    "printf 'literal'  ",
    "`literal`",
  ];
  const codePayloads = (html: string) =>
    [...html.matchAll(/<code(?: [^>]*)?>([\s\S]*?)<\/code>/g)].map((match) =>
      match[1]
        .replaceAll("&quot;", '"')
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&")
    );

  it.each(commands)("preserves original command %j in every affected guide format", (command) => {
    const facts: RepoFacts = {
      ...mockFacts,
      quickstart: {
        ...mockFacts.quickstart,
        commands: ["build", "test", "dev"].map((name) => ({ name, command, source: "README.md" })),
      },
      runbook: { ...mockFacts.runbook!, applicable: false },
    };
    const before = JSON.stringify(facts);
    for (const markdown of [
      generateBootcamp(facts),
      generateOnboarding(facts),
      generateRunbook(facts),
    ]) {
      for (const html of [
        markdownToHtml(markdown),
        convertToHtml(markdown, "Guide"),
        convertToPdf(markdown, "Guide"),
      ]) {
        expect(codePayloads(html)).toContain(command);
        expect(html).not.toContain("<img src=x");
        expect(html).not.toContain('<a href="./ONBOARDING.md">source</a>');
      }
    }
    expect(JSON.stringify(facts)).toBe(before);
  });

  it("retains a multiline verification command outside the limited summary", () => {
    const command = "printf 'first\n```\nlast'";
    const facts: RepoFacts = {
      ...mockFacts,
      quickstart: {
        ...mockFacts.quickstart,
        commands: [
          ...Array.from({ length: 5 }, (_, i) => ({
            name: "unrelated" + i,
            command: "echo literal" + i,
            source: "README.md",
          })),
          { name: "dev", command, source: "README.md" },
        ],
      },
    };
    const markdown = generateBootcamp(facts);
    expect(markdown).toContain("Run the dev server using the command below");
    expect(markdown).toContain("**Command for step 2:**");
    expect(codePayloads(markdownToHtml(markdown))).toContain(command);
  });
});
