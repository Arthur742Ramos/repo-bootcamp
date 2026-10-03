import { execFileSync } from "child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup() {
  const temp = await mkdtemp(join(tmpdir(), "bootcamp-mixed-cli-"));
  dirs.push(temp);
  const repo = join(temp, "repo");
  const child = join(repo, "app");
  await mkdir(child, { recursive: true });
  await writeFile(join(repo, "package.json"), JSON.stringify({ dependencies: { outerOnly: "1" } }));
  await writeFile(
    join(child, "package.json"),
    JSON.stringify({ private: true, devDependencies: { prettier: "^3" } })
  );
  await writeFile(
    join(child, "pyproject.toml"),
    '[project]\nname = "owned-app"\nversion = "1.0.0"\ndependencies = ["fastapi>=0.110", "uvicorn>=0.29", "typer>=0.12"]\n'
  );
  await writeFile(join(child, "README.md"), "# Owned Python app\n");
  await writeFile(join(child, "app.py"), "from fastapi import FastAPI\napp = FastAPI()\n");
  const facts = {
    repoName: "owned/app",
    purpose: "Python app with formatting tooling",
    description: "Offline fixture",
    stack: {
      languages: ["Python"],
      frameworks: ["FastAPI"],
      packageManager: null,
      buildSystem: "pip",
      hasDocker: false,
      hasCi: false,
    },
    quickstart: {
      prerequisites: [],
      steps: ["Read README.md"],
      commands: [],
      commonErrors: [],
      sources: ["README.md"],
    },
    structure: { keyDirs: [], entrypoints: [], testDirs: [], docsDirs: [], sources: [] },
    ci: { workflows: [], mainChecks: [], sources: [] },
    contrib: { howToAddFeature: [], howToAddTest: [], sources: [] },
    architecture: { overview: "Small application", components: [], sources: [] },
    firstTasks: [],
  };
  const response = join(temp, "response.json");
  await writeFile(response, JSON.stringify(facts));
  const preload = join(temp, "owned-home.mjs");
  await writeFile(
    preload,
    `import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>${JSON.stringify(join(temp, "home"))};syncBuiltinESMExports();`
  );
  const env = { ...process.env, NODE_ENV: "test", REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response };
  delete env.NODE_OPTIONS;
  const run = (args: string[]) =>
    execFileSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(join(process.cwd(), "node_modules/tsx/dist/loader.mjs")).href,
        "--import",
        pathToFileURL(preload).href,
        join(process.cwd(), "src/cli.ts"),
        ...args,
      ],
      {
        cwd: temp,
        env,
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  return { temp, repo, child, run };
}

describe("actual mixed dependency CLI journeys", () => {
  it("reports the same complete selected-root inventory as JSON, text and graph without invoking a model", async () => {
    const { child, run } = await setup();
    const json = JSON.parse(run(["deps", child, "--json"]));
    expect(json.packageManager).toBe("npm");
    expect(json.packageManagers).toEqual(["npm", "pip"]);
    expect(json.counts).toEqual({ runtime: 3, dev: 1, peer: 0 });
    expect(json.totalCount).toBe(4);
    expect(json.runtime.map((dep: { name: string }) => dep.name)).toEqual([
      "fastapi",
      "uvicorn",
      "typer",
    ]);
    expect(
      json.runtime.every((dep: { sourceFile: string }) => dep.sourceFile === "pyproject.toml")
    ).toBe(true);
    const text = run(["deps", child]);
    expect(text).toContain("Package managers:");
    expect(text).toContain("fastapi");
    expect(text).toContain("prettier");
    const graph = run(["deps", child, "--diagram"]);
    expect(graph).toContain('Runtime_0["fastapi (python)"]');
    expect(graph).toContain('Dev_0["prettier (node)"]');
    expect(graph).not.toContain("outerOnly");
  });

  it.each(
    [false, true].flatMap((fast) => ["markdown", "html", "pdf"].map((format) => ({ fast, format })))
  )(
    "preserves Python runtime and Node dev in scoped exports ($format, fast=$fast)",
    async ({ fast, format }) => {
      const { temp, repo, run } = await setup();
      const out = join(temp, "out");
      run([
        repo,
        "--no-clone",
        "--no-cache",
        "--subdir",
        "app",
        "--style",
        "corporate",
        "--format",
        format,
        "--output",
        out,
        ...(fast ? ["--fast"] : []),
      ]);
      const doc = await readFile(
        join(out, `DEPENDENCIES.${format === "markdown" ? "md" : "html"}`),
        "utf8"
      );
      expect(doc).not.toContain("No runtime dependencies found");
      expect(doc).not.toContain("outerOnly");
      for (const name of ["fastapi", "uvicorn", "typer", "prettier"]) expect(doc).toContain(name);
      if (format === "markdown") {
        expect(doc).toContain("| fastapi | >=0.110 | python | pyproject.toml |");
        expect(doc).toContain("| prettier | ^3 | node | package.json |");
      } else {
        expect(doc).toContain(
          "<td>fastapi</td><td>&gt;=0.110</td><td>python</td><td>pyproject.toml</td>"
        );
        expect(doc).toContain("<td>prettier</td><td>^3</td><td>node</td><td>package.json</td>");
      }
      expect(JSON.parse(await readFile(join(out, "summary.json"), "utf8")).deps).toEqual({
        total: 4,
        runtime: 3,
        dev: 1,
      });
    }
  );
});
