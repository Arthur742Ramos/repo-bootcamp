import { execFileSync, spawn } from "child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoFacts } from "../../src/types.js";

// Every GitHub boundary is owned by this child-process fixture. All other
// commands, including repository ingestion and cleanup, run normally.
const fakeGhPreload = `
const cp = require('node:child_process');
const { promisify } = require('node:util');
const { syncBuiltinESMExports } = require('node:module');
const fs = require('node:fs');
const original = cp.execFile;
const originalAsync = promisify(original);
const policy = JSON.parse(process.env.BOOTCAMP_OWNED_GH_POLICY);
let creates = 0;
function fake(file, args) {
  if (file !== 'gh' && !(file === 'which' && args[0] === 'gh')) return null;
  fs.appendFileSync(process.env.BOOTCAMP_OWNED_GH_LOG, JSON.stringify({ file, args }) + '\\n');
  if (file === 'which') return { stdout: 'owned-fixture-gh', stderr: '' };
  if (args[0] === 'auth') return { stdout: 'Owned fixture auth', stderr: '' };
  if (args[0] === 'issue' && args[1] === 'list') return { stdout: JSON.stringify(policy.existing || []), stderr: '' };
  if (args[0] === 'issue' && args[1] === 'create') {
    const attempt = creates++;
    if ((policy.fail || []).includes(attempt)) throw new Error('Owned issue creation failure');
    return { stdout: 'https://github.com/fixture/repository/issues/' + (attempt + 1), stderr: '' };
  }
  throw new Error('Unexpected owned gh command');
}
function exec(file, args, options, callback) {
  if (file !== 'gh' && !(file === 'which' && args[0] === 'gh')) return original(...arguments);
  const cb = typeof options === 'function' ? options : callback;
  try { const result = fake(file, args); cb(null, result.stdout, result.stderr); }
  catch (error) { cb(error, '', ''); }
}
exec[promisify.custom] = async (file, args, ...rest) => {
  const result = fake(file, args);
  return result || originalAsync(file, args, ...rest);
};
cp.execFile = exec;
syncBuiltinESMExports();
`;

function buildMockFacts(repoName: string): RepoFacts {
  return {
    repoName,
    purpose: "A local fixture repo for end-to-end CLI coverage",
    description: "Minimal Express application used to verify the full generator command.",
    confidence: "high",
    sources: ["README.md", "package.json"],
    stack: {
      languages: ["TypeScript"],
      frameworks: ["Express"],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: true,
    },
    quickstart: {
      prerequisites: ["Node.js 20+"],
      steps: ["npm install", "npm test"],
      commands: [
        { name: "test", command: "npm test", source: "package.json" },
        { name: "build", command: "npm run build", source: "package.json" },
      ],
      commonErrors: [],
      sources: ["README.md"],
    },
    structure: {
      keyDirs: [{ path: "src/", purpose: "Source code", keyFiles: ["src/index.ts"] }],
      entrypoints: [{ path: "src/index.ts", type: "main", description: "Express app entrypoint" }],
      testDirs: ["test"],
      docsDirs: [],
      sources: ["src/index.ts", "package.json"],
    },
    ci: {
      workflows: [
        {
          name: "CI",
          file: ".github/workflows/ci.yml",
          triggers: ["push"],
          mainSteps: ["npm test"],
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
          file: "src/index.ts",
          code: "export const app = express();",
          explanation: "Initializes the application instance exported by the module.",
        },
      ],
      sources: ["src/index.ts"],
    },
    firstTasks: [
      {
        title: "Add a health check route",
        description: "Expose a `/health` endpoint for smoke checks.",
        difficulty: "beginner",
        category: "feature",
        files: ["src/index.ts"],
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

type GhCall = { file: string; args: string[] };
const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture({
  provider = "github",
  fail = [] as number[],
  existing = [] as { title: string }[],
  titles = ["First task", "Second task"],
  dryRun = false,
  keepTemp = false,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "bootcamp-issue-results-"));
  tempDirs.push(root);
  const repo = join(root, "repository");
  const selected = join(repo, "packages", "app");
  await mkdir(join(selected, "src"), { recursive: true });
  await writeFile(join(selected, "src", "index.ts"), "export const fixture = true;\n");
  await writeFile(join(selected, "README.md"), "# Owned fixture\n");
  await writeFile(
    join(selected, "package.json"),
    JSON.stringify({ name: "owned-app", scripts: { test: "echo fixture" } })
  );
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "ignore" });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Owned Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--no-gpg-sign",
      "-m",
      "Owned fixture",
    ],
    { cwd: repo, stdio: "ignore" }
  );
  const facts = buildMockFacts("fixture/repository");
  facts.firstTasks = titles.map((title) => ({ ...facts.firstTasks[0], title }));
  const response = join(root, "response.json");
  await writeFile(response, JSON.stringify(facts));
  const preload = join(root, "fake-gh.cjs");
  await writeFile(preload, fakeGhPreload);
  const log = join(root, "gh.jsonl");
  const output = join(root, "output");
  await mkdir(output);
  await writeFile(join(output, "sentinel.txt"), "preserve existing output");
  const input =
    provider === "local"
      ? repo
      : `https://${provider === "github" ? "github.com" : provider === "gitlab" ? "gitlab.com" : "bitbucket.org"}/fixture/repository`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
    GH_HOST: "enterprise.example",
    BOOTCAMP_OWNED_GH_POLICY: JSON.stringify({ fail, existing }),
    BOOTCAMP_OWNED_GH_LOG: log,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${pathToFileURL(repo).href}.insteadOf`,
    GIT_CONFIG_VALUE_0: input + ".git",
  };
  delete env.NODE_OPTIONS;
  const args = [
    "--require",
    preload,
    "--import",
    pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
    resolve("src/cli.ts"),
    input,
    "--create-issues",
    "--no-cache",
    "--quiet",
    "--output",
    output,
    "--subdir",
    "packages/app",
    ...(provider === "local" ? ["--no-clone"] : []),
    ...(dryRun ? ["--dry-run"] : []),
    ...(keepTemp ? ["--keep-temp"] : []),
  ];
  const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolveResult, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Owned issue CLI fixture timed out"));
      }, 30_000);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolveResult({ exitCode: code ?? -1, stdout, stderr });
      });
    }
  );
  const calls: GhCall[] = (await readFile(log, "utf-8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const creates = calls.filter(
    (call) => call.file === "gh" && call.args[0] === "issue" && call.args[1] === "create"
  );
  const clones = await readdir(join(root, ".tmp")).catch(() => []);
  expect(await readFile(join(output, "sentinel.txt"), "utf-8")).toBe("preserve existing output");
  expect(await readFile(join(output, "repo_facts.json"), "utf-8")).toContain("First");
  expect(await readFile(join(output, "BOOTCAMP.md"), "utf-8")).toContain("fixture");
  expect(await readFile(join(selected, "src", "index.ts"), "utf-8")).toContain("fixture = true");
  return { ...result, calls, creates, clones, output, root };
}

describe("starter issue results in the real CLI", () => {
  it.each(["gitlab", "bitbucket", "local"])(
    "rejects live %s creation before every gh command while preserving output and cleanup",
    async (provider) => {
      const result = await fixture({ provider });
      expect(result.exitCode).toBe(1);
      expect(result.stderr + result.stdout).toContain("matching GitHub repository metadata");
      expect(result.calls).toEqual([]);
      expect(result.clones).toEqual([]);
    }
  );

  it.each(["gitlab", "bitbucket", "local"])(
    "exports offline manual %s previews",
    async (provider) => {
      const result = await fixture({ provider, dryRun: true });
      expect(result.exitCode).toBe(0);
      expect(result.calls).toEqual([]);
      expect(result.clones).toEqual([]);
      expect(await readFile(join(result.output, "ISSUES_PREVIEW.md"), "utf-8")).toContain(
        "manual issue creation"
      );
    }
  );

  it("creates only one issue per successful duplicate title using a host-qualified package-aware destination", async () => {
    const result = await fixture({ titles: ["First task", "First task"] });
    expect(result.exitCode).toBe(0);
    expect(result.creates).toHaveLength(1);
    const issueCalls = result.calls.filter(
      (call) => call.file === "gh" && call.args[0] === "issue"
    );
    expect(issueCalls).toHaveLength(2);
    for (const { args } of issueCalls)
      expect(args[args.indexOf("--repo") + 1]).toBe("github.com/fixture/repository");
    const args = result.creates[0].args;
    expect(args[args.indexOf("--body") + 1]).toContain(
      "https://github.com/fixture/repository/blob/main/packages/app/src/index.ts"
    );
    expect(result.clones).toEqual([]);
  });

  it("treats existing title skips as successful", async () => {
    const result = await fixture({ existing: [{ title: "First task" }, { title: "Second task" }] });
    expect(result.exitCode).toBe(0);
    expect(result.creates).toHaveLength(0);
    expect(result.stdout).toContain("Skipped: 2 existing issues");
    expect(result.clones).toEqual([]);
  });

  it.each([[0], [0, 1]])(
    "fails the CLI after partial/all failures without deleting documents or temporary-clone leaks: %j",
    async (...fail) => {
      const result = await fixture({ fail });
      expect(result.exitCode).toBe(1);
      expect(result.creates).toHaveLength(2);
      expect(result.stdout + result.stderr).toContain(
        `${fail.length} starter issue${fail.length === 1 ? "" : "s"} could not be created`
      );
      expect(result.clones).toEqual([]);
    }
  );

  it("retries a failed duplicate, skips the next after success, and reports the earlier failure", async () => {
    const result = await fixture({ titles: ["First task", "First task", "First task"], fail: [0] });
    expect(result.exitCode).toBe(1);
    expect(result.creates).toHaveLength(2);
    expect(result.stdout).toContain("Skipped: 1 existing issues");
    expect(result.clones).toEqual([]);
  });

  it("retains only the owned clone when keep-temp is explicit after failure", async () => {
    const result = await fixture({ fail: [0, 1], keepTemp: true });
    expect(result.exitCode).toBe(1);
    expect(result.clones).toHaveLength(1);
    expect(
      await readFile(
        join(result.root, ".tmp", result.clones[0], "packages", "app", "src", "index.ts"),
        "utf-8"
      )
    ).toContain("fixture = true");
  });
});
