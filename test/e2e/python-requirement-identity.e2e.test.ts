import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { runbookFacts } from "../helpers/runbook-facts.js";

const root = process.cwd();
// PyPA permits ASCII space/tab before extras, empty extras, comparator spacing,
// and URL semicolons. Identity folds runs of [-_.] and case, not separator removal.
// Normative sources: https://packaging.python.org/en/latest/specifications/dependency-specifiers/
// and https://packaging.python.org/en/latest/specifications/name-normalization/
const pyproject = String.raw`[project]
name = "owned-python-requirement-identities"
version = "1.0.0"
description = 'dependencies = ["metadata-phantom>=99"]'
dependencies = [
  'Requests [ security , tests ] >= 2.28, < 3 ; python_version >= "3.10" and platform_system == "Windows"',
  'requests>=99',
  "foo_bar\t[ fast , lint ]\t!= 1.0, >= 2 ; sys_platform == \"linux\"",
  'foo-bar==9',
  'foo.bar==10',
  'foo--bar==11',
  'foobar [] == 4.0',
  'Foo.Bar.Baz [ ] ( >= 5, < 6 )',
  'foo-bar-baz==99',
  "Space.Ref\t[ fast ] @ https://example.invalid/package.whl;path?channel=stable;query#owned;sha256=abc\t; python_version >= \"3.10\"",
  'unversioned [ ]',
]
classifiers = ["classifiers-phantom"]
[project.optional-dependencies]
feature = [
  'REQUESTS [ feature ] >=100',
  'FOO._--BAR==100',
  'FOOBAR==100',
  'foo_bar_baz==100',
  'space-ref @ https://example.invalid/duplicate-optional.whl#sha256=unused',
  "Opt.Ref [ feature ] @ https://example.invalid/optional.whl\u003Bowned?feature=extra;yes#sha256=def ; python_version >= \"3.10\"",
  'opt_ref==100',
]
[dependency-groups]
dev = [
  'requests [ test ] ~= 8.0 ; python_version >= "3.10"',
  'FOO--BAR [ ] != 0, >= 1',
  'foo.bar==101',
  'Foobar >= 7',
  'foo_bar_baz [ lint ] == 9',
  'Foo.Bar.Baz==102',
  "Dev.Ref\t[ tooling ] @ https://example.invalid/dev.whl?channel=test;owned#fragment;sha256=ghi\t; sys_platform == \"linux\"",
  'dev-ref==103',
]
lint = [
  'REQUESTS==104',
  'foo_bar==105',
]
`;
const poetryTables = String.raw`
[tool.poetry.dependencies]
python = ">=3.10"
requests = "== 20"
foo_bar = { version = ">= 21", extras = ["fast"] }
[tool.poetry.dev-dependencies]
Requests = "~= 22"
[tool.poetry.group.test.dependencies]
FOO-BAR = "!= 23"
[tool.poetry.group.docs.dependencies]
foo--bar = "== 24"
PoetryOnly = "== 25"
`;
const pipRequirements = `# Owned named requirements only
Requests\t[security,tests]\t>=2.28,<3 ; python_version >= "3.10"
requests==99
foo_bar [ fast ] !=1.0, >=2
foo-bar==9
foo.bar==10
foo--bar==11
foobar [] ==4.0
Foo.Bar.Baz [ ] ~=5.0
foo-bar-baz==99
# URL requirements and options retain their existing exclusion behavior.
ignored [ extra ] @ https://example.invalid/ignored.whl#sha256=abc
-r other.txt
`;
const runtime = [
  ["Requests", ">= 2.28, < 3"],
  ["foo_bar", "!= 1.0, >= 2"],
  ["foobar", "== 4.0"],
  ["Foo.Bar.Baz", "( >= 5, < 6 )"],
  ["Space.Ref", "@ https://example.invalid/package.whl;path?channel=stable;query#owned;sha256=abc"],
  ["unversioned", "*"],
  ["Opt.Ref", "@ https://example.invalid/optional.whl;owned?feature=extra;yes#sha256=def"],
];
const dev = [
  ["requests", "~= 8.0"],
  ["FOO--BAR", "!= 0, >= 1"],
  ["Foobar", ">= 7"],
  ["foo_bar_baz", "== 9"],
  ["Dev.Ref", "@ https://example.invalid/dev.whl?channel=test;owned#fragment;sha256=ghi"],
];
const nodeRows = [
  ["foo_bar", "^1.0.0"],
  ["foo-bar", "^2.0.0"],
  ["foo.bar", "^3.0.0"],
];
const rustRows = [
  ["foo_bar", "1.0"],
  ["foo-bar", "2.0"],
];
const goRows = [
  ["example.invalid/foo_bar", "v1.0.0"],
  ["example.invalid/foo-bar", "v2.0.0"],
];
const pipRows = [
  ["Requests", "2.28,<3"],
  ["requests", "99"],
  ["foo_bar", "1.0, >=2"],
  ["foo-bar", "9"],
  ["foo.bar", "10"],
  ["foo--bar", "11"],
  ["foobar", "4.0"],
  ["Foo.Bar.Baz", "5.0"],
  ["foo-bar-baz", "99"],
];
type FixtureMode = "pyproject" | "hybrid" | "pip";

async function fixture(mixed: boolean, mode: FixtureMode = "pyproject") {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-python-requirement-identity-"));
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "README.md"), "# Owned Python identity fixture\n");
  await writeFile(join(repo, "src", "index.py"), "metadata_only = True\n");
  await writeFile(
    join(repo, mode === "pip" ? "requirements.txt" : "pyproject.toml"),
    mode === "pip" ? pipRequirements : pyproject + (mode === "hybrid" ? poetryTables : "")
  );
  if (mixed) {
    // Identity normalization belongs only to accepted pyproject records. These
    // alias-shaped pairs in other ecosystems must remain distinct and ordered.
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        name: "owned-node-sidecar",
        dependencies: Object.fromEntries(nodeRows),
      })
    );
    await writeFile(
      join(repo, "Cargo.toml"),
      '[package]\nname = "owned-rust-sidecar"\nversion = "1.0.0"\n[dependencies]\nfoo_bar = "1.0"\nfoo-bar = "2.0"\n'
    );
    await writeFile(
      join(repo, "go.mod"),
      "module example.invalid/owned\n\ngo 1.22\n\nrequire (\n example.invalid/foo_bar v1.0.0\n example.invalid/foo-bar v2.0.0\n)\n"
    );
  }
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

function expectedRows(mixed: boolean, mode: FixtureMode) {
  const pythonRuntime =
    mode === "pip"
      ? pipRows
      : mode === "hybrid"
        ? [
            ["requests", "== 20"],
            ["foo_bar", ">= 21"],
            ["PoetryOnly", "== 25"],
            ...runtime.slice(2),
          ]
        : runtime;
  const pythonDev =
    mode === "pip"
      ? []
      : mode === "hybrid"
        ? [["Requests", "~= 22"], ["FOO-BAR", "!= 23"], ...dev.slice(2)]
        : dev;
  const provenance = (rows: string[][], ecosystem: string, sourceFile: string) =>
    rows.map(([name, version]) => [name, version, ecosystem, sourceFile]);
  return {
    runtime: mixed
      ? [
          ...provenance(nodeRows, "node", "package.json"),
          ...provenance(rustRows, "rust", "Cargo.toml"),
          ...provenance(pythonRuntime, "python", "pyproject.toml"),
          ...provenance(goRows, "go", "go.mod"),
        ]
      : pythonRuntime,
    dev: mixed ? provenance(pythonDev, "python", "pyproject.toml") : pythonDev,
  };
}

function expectAnalysis(
  deps: {
    totalCount: number;
    counts: Record<string, number>;
    runtime: unknown[];
    dev: unknown[];
    peer: unknown[];
    packageManager: string;
    packageManagers?: string[];
  },
  mixed: boolean,
  mode: FixtureMode
) {
  const rows = expectedRows(mixed, mode);
  expect(deps.totalCount).toBe(rows.runtime.length + rows.dev.length);
  expect(deps.counts).toEqual({ runtime: rows.runtime.length, dev: rows.dev.length, peer: 0 });
  for (const kind of ["runtime", "dev"] as const) {
    expect(deps[kind]).toEqual(
      rows[kind].map(([name, version, ecosystem, sourceFile]) => ({
        name,
        version,
        type: kind,
        ...(mixed ? { ecosystem, sourceFile } : {}),
        ...(mode === "hybrid" && kind === "runtime" && name === "foo_bar"
          ? { description: 'Declared Poetry metadata: {"extras":["fast"],"version":">= 21"}' }
          : {}),
      }))
    );
  }
  expect(deps.peer).toEqual([]);
  expect(deps.packageManager).toBe(mixed ? "npm" : mode === "hybrid" ? "poetry" : "pip");
  if (mixed) expect(deps.packageManagers).toEqual(["npm", "cargo", "pip", "go"]);
  else expect(deps).not.toHaveProperty("packageManagers");
  return rows;
}

describe("actual Python requirement-prefix and identity exports", () => {
  for (const [mixed, mode] of [
    [false, "pyproject"],
    [true, "pyproject"],
    [false, "pip"],
  ] as const) {
    it(`retains exact names, versions and provenance, mixed=${mixed}, mode=${mode}`, async () => {
      const owned = await fixture(mixed, mode);
      try {
        const result = await cli(owned, ["deps", owned.repo, "--json"]);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const rows = expectAnalysis(JSON.parse(result.stdout), mixed, mode);
        const expected = [...rows.runtime, ...rows.dev];
        const total = expected.length;
        const diagram = await cli(owned, ["deps", owned.repo, "--diagram"]);
        expect(diagram.status, diagram.stdout + diagram.stderr).toBe(0);
        expect(diagram.stdout).not.toMatch(
          /python_version|platform_system|sys_platform|metadata-phantom|classifiers-phantom|duplicate-optional|security|tooling/
        );
        // Diagrams intentionally cap runtime at 10 and dev at 8; exports
        // below still assert every record, including all mixed sidecars.
        for (const [name] of [...rows.runtime.slice(0, 10), ...rows.dev.slice(0, 8)])
          expect(diagram.stdout).toContain(name);
        if (mixed) expect(diagram.stdout).toContain("+4 more");
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
          const allRows = documentRows(doc, format === "markdown");
          const packageRows = allRows.filter(
            (row) =>
              row.length === (mixed ? 4 : 2) &&
              !["Type", "Runtime", "Development", "**Total**", "Total", "Package"].includes(row[0])
          );
          // Exact complete rows catch alias leaks, extra/marker contamination,
          // unknown metadata packages, accidental provenance and changed order.
          expect(packageRows).toEqual(expected);
          expect(packageRows).toHaveLength(total);
          const summary = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
          expect(summary.deps).toEqual({
            total,
            runtime: rows.runtime.length,
            dev: rows.dev.length,
          });
        }
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    });
  }

  it("deduplicates hybrid Poetry/PEP aliases in existing traversal order independently per target", async () => {
    const owned = await fixture(false, "hybrid");
    try {
      const result = await cli(owned, ["deps", owned.repo, "--json"]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const rows = expectAnalysis(JSON.parse(result.stdout), false, "hybrid");
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
        const allRows = documentRows(doc, format === "markdown");
        const packageRows = allRows.filter(
          (row) =>
            row.length === 2 &&
            !["Type", "Runtime", "Development", "**Total**", "Total", "Package"].includes(row[0])
        );
        expect(packageRows).toEqual(
          [...rows.runtime, ...rows.dev].map(([name, version]) => [
            name,
            format === "markdown" && name === "foo_bar" ? "` >= 21 `" : version,
          ])
        );
        const metadata = '{"extras":["fast"],"version":">= 21"}';
        expect(allRows.filter((row) => row.length === 3 && row[0] !== "Dependency")).toEqual([
          format === "markdown"
            ? ["` foo_bar `", "runtime", "` " + metadata + " `"]
            : ["foo_bar", "runtime", metadata],
        ]);
        const summary = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
        expect(summary.deps).toEqual({
          total: rows.runtime.length + rows.dev.length,
          runtime: rows.runtime.length,
          dev: rows.dev.length,
        });
      }
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  });
});
