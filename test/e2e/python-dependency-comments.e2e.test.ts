import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { runbookFacts } from "../helpers/runbook-facts.js";

const root = process.cwd();

async function fixture(mixed: boolean) {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-python-comments-"));
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "README.md"), "# Owned Python dependency fixture\n");
  await writeFile(join(repo, "src", "index.py"), "metadata_only = True\n");
  await writeFile(
    join(repo, "pyproject.toml"),
    [
      "[project]",
      'name = "owned-python-comments"',
      '# dependencies = ["phantom-project>=99"]',
      "dependencies = [",
      '  "requests>=2.28", # "phantom-inline>=99" ] [',
      '  "direct @ https://example.invalid/package.whl#owned",',
      "]",
      "[project.optional-dependencies]",
      '# example = ["phantom-extra>=99"]',
      'web = ["flask>=2.0", "httpx>=0.27"]',
      "[dependency-groups]",
      '# example = ["phantom-dev>=99"]',
      "dev = [",
      "  \"pytest>=8\", # 'phantom-test>=99' ]",
      '  "ruff>=0.5",',
      "]",
    ].join("\n")
  );
  if (mixed) {
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ name: "owned-node-sidecar", dependencies: { typescript: "^6.0.0" } })
    );
  }
  const response = join(base, "response.json");
  const facts = runbookFacts();
  facts.repoName = "local/" + basename(repo);
  await writeFile(response, JSON.stringify(facts));
  for (const directory of ["home", "tmp", "cache"]) await mkdir(join(base, directory));
  const preload = join(base, "owned-home.mjs");
  await writeFile(
    preload,
    "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>process.env.OWNED_PYTHON_HOME;syncBuiltinESMExports();"
  );
  return { base, repo, response, preload };
}

function cli(owned: Awaited<ReturnType<typeof fixture>>, args: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(join(root, "node_modules", "tsx", "dist", "loader.mjs")).href,
      "--import",
      pathToFileURL(owned.preload).href,
      join(root, "src", "cli.ts"),
      ...args,
    ],
    {
      cwd: owned.base,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        NODE_ENV: "test",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: owned.response,
        OWNED_PYTHON_HOME: join(owned.base, "home"),
        HOME: join(owned.base, "home"),
        USERPROFILE: join(owned.base, "home"),
        TMPDIR: join(owned.base, "tmp"),
        XDG_CACHE_HOME: join(owned.base, "cache"),
        TSX_DISABLE_CACHE: "1",
      },
    }
  );
}

describe("actual Python dependency comment boundaries", () => {
  it.each([false, true])(
    "keeps comments out of standalone and saved mixed=%s output",
    async (mixed) => {
      const owned = await fixture(mixed);
      try {
        const total = mixed ? 7 : 6;
        const result = cli(owned, ["deps", owned.repo, "--json"]);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const deps = JSON.parse(result.stdout);
        expect(deps.totalCount).toBe(total);
        expect(deps.counts).toEqual({ runtime: mixed ? 5 : 4, dev: 2, peer: 0 });
        expect(result.stdout).not.toContain("phantom");
        expect(deps.runtime.find((dep: { name: string }) => dep.name === "direct").version).toBe(
          "@ https://example.invalid/package.whl#owned"
        );
        if (mixed) {
          expect(deps.packageManagers).toEqual(["npm", "pip"]);
          expect(
            deps.runtime.find((dep: { name: string }) => dep.name === "requests")
          ).toMatchObject({
            ecosystem: "python",
            sourceFile: "pyproject.toml",
          });
        }
        const diagram = cli(owned, ["deps", owned.repo, "--diagram"]);
        expect(diagram.status, diagram.stdout + diagram.stderr).toBe(0);
        expect(diagram.stdout).not.toContain("phantom");
        expect(diagram.stdout).toContain("requests");
        for (const format of ["markdown", "html", "pdf"] as const) {
          const output = join(owned.base, format);
          const generated = cli(owned, [
            owned.repo,
            "--no-clone",
            "--no-cache",
            "--quiet",
            "--format",
            format,
            "--output",
            output,
          ]);
          expect(generated.status, generated.stdout + generated.stderr).toBe(0);
          const doc = await readFile(
            join(output, "DEPENDENCIES" + (format === "markdown" ? ".md" : ".html")),
            "utf8"
          );
          expect(doc).not.toContain("phantom");
          expect(doc).toContain("requests");
          expect(doc).toContain("#owned");
          const summary = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
          expect(summary.deps).toEqual({ total, runtime: mixed ? 5 : 4, dev: 2 });
        }
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    }
  );
});
