import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepoFacts } from "../../src/types.js";

export async function createPackageMonorepo(root: string): Promise<void> {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "fixture-root",
      packageManager: "npm@10.0.0",
      scripts: { dev: "node root.js" },
    }),
    "README.md": "# ROOT ONLY\nRoot workspaces overview.",
    "root.js": "console.log('root');",
    "packages/app/package.json": JSON.stringify({
      name: "fixture-app",
      packageManager: "pnpm@9.0.0",
      scripts: { dev: "vite", test: "vitest" },
    }),
    "packages/app/README.md": "# APP ONLY\nRun pnpm dev from this package.",
    "packages/app/src/main.ts": "export const app = 'selected app';",
    "packages/core/package.json": JSON.stringify({ name: "fixture-core" }),
    "packages/core/src/core.ts": "export const core = 'sibling';",
  };
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, name);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, content);
  }
}

export function packageFacts(repoName = "monorepo"): RepoFacts {
  return {
    repoName,
    purpose: "A local fixture repo for end-to-end CLI coverage",
    description: "Minimal Express application used to verify the full generator command.",
    confidence: "high",
    sources: ["README.md", "package.json"],
    stack: {
      languages: ["TypeScript"],
      frameworks: ["Express"],
      buildSystem: "pnpm",
      packageManager: "pnpm",
      hasDocker: false,
      hasCi: true,
    },
    quickstart: {
      prerequisites: ["Node.js 20+"],
      steps: ["pnpm install", "pnpm test"],
      commands: [
        { name: "test", command: "pnpm test", source: "package.json" },
        { name: "dev", command: "pnpm dev", source: "package.json" },
      ],
      commonErrors: [],
      sources: ["README.md"],
    },
    structure: {
      keyDirs: [{ path: "src/", purpose: "Source code", keyFiles: ["src/main.ts"] }],
      entrypoints: [{ path: "src/main.ts", type: "main", description: "Express app entrypoint" }],
      testDirs: ["test"],
      docsDirs: [],
      sources: ["src/main.ts", "package.json"],
    },
    ci: {
      workflows: [
        {
          name: "CI",
          file: ".github/workflows/ci.yml",
          triggers: ["push"],
          mainSteps: ["pnpm test"],
        },
      ],
      mainChecks: ["Tests pass"],
      sources: [".github/workflows/ci.yml"],
    },
    contrib: {
      howToAddFeature: ["Create code in src/", "Add or update tests"],
      howToAddTest: ["Add a .test.ts file in test/"],
      codeStyle: "TypeScript with straightforward module structure",
      sources: ["README.md"],
    },
    architecture: {
      overview: "Small Express application with a utility module and a single entrypoint.",
      components: [
        { name: "Application", description: "Express app bootstrap", directory: "src/" },
      ],
      dataFlow: "CLI or HTTP interaction -> app logic -> response",
      keyAbstractions: [{ name: "app", description: "Express application instance" }],
      codeExamples: [
        {
          title: "Express app bootstrap",
          file: "src/main.ts",
          code: "export const app = express();",
          explanation: "Initializes the application instance exported by the module.",
        },
      ],
      sources: ["src/main.ts"],
    },
    firstTasks: [
      {
        title: "Add a health check route",
        description: "Expose a `/health` endpoint for smoke checks.",
        difficulty: "beginner",
        category: "feature",
        files: ["src/main.ts"],
        why: "It touches the entrypoint and produces an immediately testable improvement.",
      },
    ],
    runbook: {
      applicable: false,
      deploySteps: [],
      observability: [],
      incidents: [],
      sources: [],
    },
  };
}
