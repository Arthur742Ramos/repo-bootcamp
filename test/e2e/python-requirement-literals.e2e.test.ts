import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { runbookFacts } from "../helpers/runbook-facts.js";

const root = process.cwd();
const runtime = [
  ["requests", ">=2.28"],
  ["urllib3", ">=2,<3"],
  ["httpx", ">=0.27"],
  ["packaging", ">=24"],
  ["Flask", ">=3.0"],
  ["rich", "~=13.0"],
];
const dev = [
  ["pytest", ">=8"],
  ["ruff", ">=0.5"],
];

async function fixture(mixed: boolean) {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-python-literals-"));
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "README.md"), "# Owned requirement literal fixture\n");
  await writeFile(join(repo, "src", "index.py"), "metadata_only = True\n");
  // These are TOML source escapes, not JavaScript escapes. Every decoded string
  // is a valid PEP 508 requirement; marker brackets are ordinary quoted text.
  await writeFile(
    join(repo, "pyproject.toml"),
    String.raw`[project]
name = "owned-python-literals"
version = "1.0.0"
description = 'dependencies = ["classifiers>=99"]'
dependencies = [
  "requests[security]>=2.28; python_version >= \"3.10\" and platform_system == \"Windows\"",
  "\u0075rllib3\u003E=\u0032,<3\u003B python_version >= \"3.10\"",
  """httpx>=0.27; sys_platform == "linux"""",
  'packaging>=24; platform_release == "[" and implementation_name == "cpython"',
  "Flask>=3.0",
]
classifiers = ["classifiers"]
[project.optional-dependencies]
pretty = ['''rich~=13.0; platform_system == 'Darwin' ''']
[dependency-groups]
dev = [
  "pytest>=8; python_version >= \"3.10\" and platform_system == \"Windows\"",
  "\U00000072uff\u003E=0.5\u003B python_version >= \"3.10\"",
]
`
  );
  if (mixed)
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        name: "owned-node-sidecar",
        dependencies: { typescript: "^6.0.0" },
      })
    );
  const response = join(base, "response.json");
  const facts = runbookFacts();
  facts.repoName = "local/repo";
  await writeFile(response, JSON.stringify(facts));
  const preload = join(base, "owned-home.mjs");
  await writeFile(
    preload,
    "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>process.env.OWNED_PYTHON_HOME;syncBuiltinESMExports();"
  );
  return { base, repo, response, preload };
}

async function cli(owned: Awaited<ReturnType<typeof fixture>>, args: string[]) {
  // Each actual process receives a fresh home, cache and temp directory. The
  // preload patches os.homedir before the CLI (and its configuration) imports.
  const processBase = await mkdtemp(join(owned.base, "process-"));
  for (const dir of ["home", "cache", "tmp"]) await mkdir(join(processBase, dir));
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
      cwd: processBase,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: owned.response,
        OWNED_PYTHON_HOME: join(processBase, "home"),
        HOME: join(processBase, "home"),
        USERPROFILE: join(processBase, "home"),
        TMPDIR: join(processBase, "tmp"),
        XDG_CACHE_HOME: join(processBase, "cache"),
        TSX_DISABLE_CACHE: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    }
  );
}

function documentRows(doc: string, markdown: boolean): string[][] {
  if (markdown)
    return doc
      .split("\n")
      .filter((line) => line.startsWith("| "))
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim())
      );
  const decode = (value: string) =>
    value
      .replace(/<[^>]*>/g, "")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  return [...doc.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decode(cell[1]))
  );
}

describe("actual Python requirement literal exports", () => {
  it.each([false, true])(
    "decodes requirements without phantom packages, mixed=%s",
    async (mixed) => {
      const owned = await fixture(mixed);
      try {
        const runtimeRows = mixed ? [["typescript", "^6.0.0"], ...runtime] : runtime;
        const expected = [...runtimeRows, ...dev];
        const total = expected.length;
        const result = await cli(owned, ["deps", owned.repo, "--json"]);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const deps = JSON.parse(result.stdout);
        expect(deps.totalCount).toBe(total);
        expect(deps.counts).toEqual({ runtime: runtimeRows.length, dev: dev.length, peer: 0 });
        for (const [kind, rows] of [
          ["runtime", runtimeRows],
          ["dev", dev],
        ] as const) {
          expect(
            deps[kind].map((dep: { name: string; version: string }) => [dep.name, dep.version])
          ).toEqual(rows);
          for (const dep of deps[kind]) {
            expect(dep.type).toBe(kind);
            if (mixed)
              expect(dep).toMatchObject(
                dep.name === "typescript"
                  ? { ecosystem: "node", sourceFile: "package.json" }
                  : { ecosystem: "python", sourceFile: "pyproject.toml" }
              );
          }
        }
        expect(deps.peer).toEqual([]);
        if (mixed) expect(deps.packageManagers).toEqual(["npm", "pip"]);
        else expect(deps.packageManager).toBe("pip");
        const diagram = await cli(owned, ["deps", owned.repo, "--diagram"]);
        expect(diagram.status, diagram.stdout + diagram.stderr).toBe(0);
        expect(diagram.stdout).not.toMatch(/\band\b|\bclassifiers\b/);
        for (const [name] of expected) expect(diagram.stdout).toContain(name);
        for (const format of ["markdown", "html", "pdf"] as const) {
          const output = join(owned.base, format);
          const generated = await cli(owned, [
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
          const rows = documentRows(doc, format === "markdown");
          const names = new Set(expected.map(([name]) => name));
          expect(rows.filter((row) => names.has(row[0]))).toEqual(
            expected.map(([name, version]) =>
              mixed
                ? [
                    name,
                    version,
                    name === "typescript" ? "node" : "python",
                    name === "typescript" ? "package.json" : "pyproject.toml",
                  ]
                : [name, version]
            )
          );
          expect(rows.some((row) => ["and", "classifiers"].includes(row[0]))).toBe(false);
          // Count all package rows, including any unknown metadata-derived name.
          expect(
            rows.filter(
              (row) =>
                row.length === (mixed ? 4 : 2) &&
                !["Type", "Runtime", "Development", "**Total**", "Total", "Package"].includes(
                  row[0]
                )
            )
          ).toHaveLength(total);
          const summary = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
          expect(summary.deps).toEqual({ total, runtime: runtimeRows.length, dev: dev.length });
        }
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    }
  );
});
