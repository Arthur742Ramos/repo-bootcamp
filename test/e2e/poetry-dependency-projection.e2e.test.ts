import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { runbookFacts } from "../helpers/runbook-facts.js";

const root = process.cwd();
// Fixture declarations are TOML/schema metadata, not installable/resolved plans.
const marker =
  '[tool.poetry.dependencies]\nphantom = "^99"\n``` | [link](https://example.invalid/owned) ![image](https://example.invalid/image) <script>globalThis.poetryInjected=true</script>';
const alternatives = [
  {
    url: "https://example.invalid/owned.whl#sha256=0123456789",
    markers: 'sys_platform == "linux"',
    subdirectory: "wheel/pkg",
  },
  { version: " >= 2, < 4 ", python: ">=3.10", optional: false, extras: ["security", "socks"] },
];
const declared: Record<string, unknown> = {
  "root.pkg": { version: "^1", extras: ["root"] },
  pytest: { version: "^8", extras: ["test"], markers: 'python_version >= "3.10"' },
  "spaced-version": {
    version: " >= 1, < 3 ",
    extras: ["security", "socks"],
    markers: 'python_version >= "3.10"',
    optional: true,
    source: "owned",
    python: ">=3.8",
    platform: "linux",
    "allow-prereleases": true,
    "allows-prereleases": false,
  },
  "fake-source": { source: 'version = "^99"' },
  "fake-marker": { markers: "os_name == \"version = '^99'\"" },
  gitpkg: {
    git: "https://example.invalid/owned.git#retained",
    rev: "deadbeef",
    subdirectory: "packages/owned",
    develop: true,
    extras: ["git-extra"],
    optional: false,
    python: ">=3.9",
    markers: 'sys_platform == "linux"',
  },
  filepkg: { file: "./owned.whl", subdirectory: "wheel/pkg", optional: true },
  pathpkg: { path: "../owned path/pkg", develop: false, extras: ["local"], platform: "darwin" },
  urlpkg: { url: "https://example.invalid/owned.whl#sha256=0123456789", subdirectory: "wheel/pkg" },
  options: {
    python: ">=3.10",
    platform: "linux",
    "allow-prereleases": false,
    develop: true,
    source: "owned",
  },
  empty: {},
  conditional: alternatives,
  dotted: { version: "^5", extras: ["dotted"] },
  nested: { version: "^6", markers: marker, extras: ["nested"] },
  tablealternatives: [
    { version: "^1", python: ">=3.8,<3.10" },
    { version: "^2", python: ">=3.10" },
  ],
};
function canonical(value: unknown): string {
  const plain = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(plain)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, field]) => [key, plain(field)])
          )
        : item;
  return JSON.stringify(plain(value));
}
const poetryToml = String.raw`[tool.poetry.dependencies]
"root.pkg".version = "^1"
"root.pkg".extras = ["root"]
"python" = ">=3.9"
"quoted-only" = "^2"
'literal.pkg' = '^3'
"\u0075nicode" = "^4"
"spaced-version" = { version = " >= 1, < 3 ", extras = ["security", "socks"], markers = 'python_version >= "3.10"', optional = true, source = "owned", python = ">=3.8", platform = "linux", allow-prereleases = true, allows-prereleases = false }
"fake-source" = { source = 'version = "^99"' }
"fake-marker" = { markers = '''os_name == "version = '^99'"''' }
gitpkg = { git = "https://example.invalid/owned.git#retained", rev = "deadbeef", subdirectory = "packages/owned", develop = true, extras = ["git-extra"], optional = false, python = ">=3.9", markers = 'sys_platform == "linux"' }
filepkg = { file = "./owned.whl", subdirectory = "wheel/pkg", optional = true }
pathpkg = { path = "../owned path/pkg", develop = false, extras = ["local"], platform = "darwin" }
urlpkg = { url = "https://example.invalid/owned.whl#sha256=0123456789", subdirectory = "wheel/pkg" }
options = { python = ">=3.10", platform = "linux", allow-prereleases = false, develop = true, source = "owned" }
empty = {}
conditional = [
  { url = "https://example.invalid/owned.whl#sha256=0123456789", markers = 'sys_platform == "linux"', subdirectory = "wheel/pkg" },
  { version = " >= 2, < 4 ", python = ">=3.10", optional = false, extras = ["security", "socks"] },
]
dotted.version = "^5"
dotted.extras = ["dotted"]
[tool.poetry.dependencies.nested]
version = "^6"
extras = ["nested"]
markers = '''[tool.poetry.dependencies]
phantom = "^99"
\x60\x60\x60 | [link](https://example.invalid/owned) ![image](https://example.invalid/image) <script>globalThis.poetryInjected=true</script>'''
[[tool.poetry.dependencies.tablealternatives]]
version = "^1"
python = ">=3.8,<3.10"
[[tool.poetry.dependencies.tablealternatives]]
version = "^2"
python = ">=3.10"
[tool.poetry.group.docs]
optional = true
[tool.poetry.group.web.dependencies]
alpha = "^1"
[tool.poetry.group.docs.dependencies]
ALPHA = "^99"
sphinx = "^8"
[tool.poetry.group.test.dependencies]
"pytest" = "^99"
ruff = "^0.5"
[tool.poetry.dev-dependencies]
"pytest" = { version = "^8", extras = ["test"], markers = 'python_version >= "3.10"' }
[project]
name = "owned-poetry-projection"
version = "1.0.0"
dependencies = ["ROOT_pkg>=99", "modern>=7"]
[project.optional-dependencies]
feature = ["quoted_only>=99", "feature>=9"]
[dependency-groups]
dev = ["PYTEST>=99", "dev-extra>=10"]
[tool.other]
description = '''[tool.poetry.dependencies]
foreign = "^99"
'''
["tool.poetry".dependencies]
namespace-phantom = "^99"
`.replaceAll("\\x60", "`");
const pythonRuntime = [
  ["root.pkg", "^1"],
  ["quoted-only", "^2"],
  ["literal.pkg", "^3"],
  ["unicode", "^4"],
  ["spaced-version", " >= 1, < 3 "],
  ["fake-source", "*"],
  ["fake-marker", "*"],
  ["gitpkg", "*"],
  ["filepkg", "*"],
  ["pathpkg", "*"],
  ["urlpkg", "*"],
  ["options", "*"],
  ["empty", "*"],
  ["conditional", canonical(alternatives)],
  ["dotted", "^5"],
  ["nested", "^6"],
  ["tablealternatives", canonical(declared.tablealternatives)],
  ["alpha", "^1"],
  ["sphinx", "^8"],
  ["modern", ">=7"],
  ["feature", ">=9"],
];
const pythonDev = [
  ["pytest", "^8"],
  ["ruff", "^0.5"],
  ["dev-extra", ">=10"],
];
function expectedRows(mixed: boolean) {
  const row = (name: string, version: string, ecosystem: string, manifest: string) =>
    mixed ? [name, version, ecosystem, manifest] : [name, version];
  return {
    runtime: [
      ...(mixed
        ? [row("gitpkg", "^20", "node", "package.json"), row("gitpkg", "2", "rust", "Cargo.toml")]
        : []),
      ...pythonRuntime.map(([name, version]) => row(name, version, "python", "pyproject.toml")),
      ...(mixed ? [row("example.invalid/owned", "v1.2.3", "go", "go.mod")] : []),
    ],
    dev: [
      ...(mixed
        ? [
            row("node-dev", "^1", "node", "package.json"),
            row("rust-dev", "3", "rust", "Cargo.toml"),
          ]
        : []),
      ...pythonDev.map(([name, version]) => row(name, version, "python", "pyproject.toml")),
    ],
    metadata: [
      ...pythonRuntime.map(([name]) => [name, "runtime"]),
      ...pythonDev.map(([name]) => [name, "dev"]),
    ]
      .filter(([name]) => Object.hasOwn(declared, name))
      .map(([name, kind]) => [
        name,
        kind,
        canonical(declared[name]),
        ...(mixed ? ["python", "pyproject.toml"] : []),
      ]),
  };
}
async function fixture(mixed: boolean, toml = poetryToml) {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-poetry-projection-"));
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "README.md"), "# Owned Poetry projection fixture\n");
  await writeFile(join(repo, "src", "index.py"), "metadata_only = True\n");
  await writeFile(join(repo, "pyproject.toml"), toml);
  if (mixed) {
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        name: "owned-node",
        dependencies: { gitpkg: "^20" },
        devDependencies: { "node-dev": "^1" },
      })
    );
    await writeFile(
      join(repo, "Cargo.toml"),
      '[package]\nname = "owned-rust"\nversion = "1.0.0"\n[dependencies]\ngitpkg = "2"\n[dev-dependencies]\nrust-dev = "3"\n'
    );
    await writeFile(
      join(repo, "go.mod"),
      "module example.invalid/fixture\ngo 1.22\nrequire example.invalid/owned v1.2.3\n"
    );
  }
  const response = join(base, "response.json");
  const facts = runbookFacts();
  facts.repoName = "local/repo";
  await writeFile(response, JSON.stringify(facts));
  const preload = join(base, "owned-home.mjs");
  await writeFile(
    preload,
    "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>process.env.OWNED_POETRY_HOME;syncBuiltinESMExports();"
  );
  return { base, repo, response, preload };
}
async function cli(owned: Awaited<ReturnType<typeof fixture>>, args: string[]) {
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
        OWNED_POETRY_HOME: join(processBase, "home"),
        HOME: join(processBase, "home"),
        USERPROFILE: join(processBase, "home"),
        TMPDIR: join(processBase, "tmp"),
        TMP: join(processBase, "tmp"),
        TEMP: join(processBase, "tmp"),
        XDG_CACHE_HOME: join(processBase, "cache"),
        TSX_DISABLE_CACHE: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    }
  );
}

function documentTables(doc: string, markdown: boolean): { headers: string[]; rows: string[][] }[] {
  const decode = (value: string) =>
    value
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  const htmlCell = (value: string) => {
    const code = value.match(/^\s*<code>([\s\S]*?)<\/code>\s*$/);
    return code ? decode(code[1]) : decode(value.replace(/<[^>]*>/g, "")).trim();
  };
  if (!markdown)
    return [...doc.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].map((table) => ({
      headers: [...table[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((cell) =>
        htmlCell(cell[1])
      ),
      rows: [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
        .map((row) =>
          [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => htmlCell(cell[1]))
        )
        .filter((row) => row.length),
    }));
  const cells = (line: string) => {
    const values = line
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim().replace(/\\\|/g, "|"));
    return values.map((cell) => {
      const span = cell.match(/^(`+) ([\s\S]*?) \1$/);
      return span ? span[2] : cell;
    });
  };
  return [...doc.matchAll(/(?:^|\n)(\|[^\n]+\|)\n\|[-| ]+\|\n((?:\|[^\n]*\|(?:\n|$))*)/g)].map(
    (table) => ({
      headers: cells(table[1]),
      rows: table[2].trim().split("\n").filter(Boolean).map(cells),
    })
  );
}

describe("actual Poetry dependency projection exports", () => {
  it.each([false, true])(
    "retains complete declarations, exact ordered Package rows and provenance, mixed=%s",
    async (mixed) => {
      const owned = await fixture(mixed);
      try {
        const expected = expectedRows(mixed);
        const total = expected.runtime.length + expected.dev.length;
        const result = await cli(owned, ["deps", owned.repo, "--json"]);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const deps = JSON.parse(result.stdout);
        expect(deps.totalCount).toBe(total);
        expect(deps.counts).toEqual({
          runtime: expected.runtime.length,
          dev: expected.dev.length,
          peer: 0,
        });
        expect(deps.peer).toEqual([]);
        for (const kind of ["runtime", "dev"] as const) {
          expect(
            deps[kind].map(
              (dep: { name: string; version: string; ecosystem?: string; sourceFile?: string }) => [
                dep.name,
                dep.version,
                ...(mixed ? [dep.ecosystem, dep.sourceFile] : []),
              ]
            )
          ).toEqual(expected[kind]);
          for (const dep of deps[kind]) expect(dep.type).toBe(kind);
        }
        const poetry = [...deps.runtime, ...deps.dev].filter(
          (dep: { ecosystem?: string }) => !mixed || dep.ecosystem === "python"
        );
        for (const dep of poetry) {
          if (Object.hasOwn(declared, dep.name))
            expect(dep.description).toBe(
              "Declared Poetry metadata: " + canonical(declared[dep.name])
            );
          else expect(dep).not.toHaveProperty("description");
          if (!mixed) {
            expect(dep).not.toHaveProperty("ecosystem");
            expect(dep).not.toHaveProperty("sourceFile");
          }
        }
        if (mixed) expect(deps.packageManagers).toEqual(["npm", "cargo", "poetry", "go"]);
        else expect(deps.packageManager).toBe("poetry");
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
          const tables = documentTables(doc, format === "markdown");
          const packages = tables.filter((table) => table.headers[0] === "Package");
          expect(packages).toHaveLength(2);
          for (const [index, kind] of (["runtime", "dev"] as const).entries()) {
            expect(packages[index].headers).toEqual(
              mixed ? ["Package", "Version", "Ecosystem", "Manifest"] : ["Package", "Version"]
            );
            expect(packages[index].rows).toEqual(expected[kind]);
          }
          const metadata = tables.filter((table) => table.headers[0] === "Dependency");
          expect(metadata).toHaveLength(1);
          expect(metadata[0].headers).toEqual(
            mixed
              ? ["Dependency", "Kind", "Declaration", "Ecosystem", "Manifest"]
              : ["Dependency", "Kind", "Declaration"]
          );
          expect(metadata[0].rows).toEqual(expected.metadata);
          expect(doc).toContain("no branch is selected");
          const summary = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
          expect(summary.deps).toEqual({
            total,
            runtime: expected.runtime.length,
            dev: expected.dev.length,
          });
        }
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    },
    120_000
  );

  // Authoritative tomllib/schema equivalences: quoted-only never has a bare key;
  // dotted assignment and explicit table paths represent the same complete value.
  const shape = { version: " >= 1, < 3 ", extras: ["security"], source: "owned" };
  const syntaxes = [
    [
      "quoted-only",
      String.raw`["tool"."poetry"."dependencies"]
"\u0072equests" = "^2"
`,
    ],
    [
      "full dotted",
      'tool.poetry.dependencies."requests".version = " >= 1, < 3 "\ntool.poetry.dependencies."requests".extras = ["security"]\ntool.poetry.dependencies."requests".source = "owned"\n',
    ],
    [
      "relative dotted",
      '[tool.poetry]\ndependencies.requests.version = " >= 1, < 3 "\ndependencies.requests.extras = ["security"]\ndependencies.requests.source = "owned"\n',
    ],
    [
      "explicit nested",
      '[tool.poetry.dependencies.requests]\nversion = " >= 1, < 3 "\nextras = ["security"]\nsource = "owned"\n',
    ],
    [
      "quoted dotted group",
      '["tool"."poetry"."group"."docs.prod"."dependencies"."requests"]\nversion = " >= 1, < 3 "\nextras = ["security"]\nsource = "owned"\n',
    ],
    [
      "full dotted group",
      'tool.poetry.group."docs.prod".dependencies.requests.version = " >= 1, < 3 "\ntool.poetry.group."docs.prod".dependencies.requests.extras = ["security"]\ntool.poetry.group."docs.prod".dependencies.requests.source = "owned"\n',
    ],
    [
      "literal quoted nested",
      "['tool'.'poetry'.'dependencies'.'requests']\nversion = ' >= 1, < 3 '\nextras = ['security']\nsource = 'owned'\n",
    ],
  ];
  it.each(syntaxes)("projects the complete %s namespace", async (label, toml) => {
    const owned = await fixture(false, toml);
    try {
      const result = await cli(owned, ["deps", owned.repo, "--json"]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const deps = JSON.parse(result.stdout);
      expect(deps.runtime).toEqual([
        label === "quoted-only"
          ? { name: "requests", version: "^2", type: "runtime" }
          : {
              name: "requests",
              version: " >= 1, < 3 ",
              type: "runtime",
              description: "Declared Poetry metadata: " + canonical(shape),
            },
      ]);
      expect(deps.dev).toEqual([]);
      expect(deps.totalCount).toBe(1);
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  });
  it("does not reserve identity for invalid attributes or incomplete alternatives", async () => {
    const owned = await fixture(
      false,
      `[tool.poetry.dependencies]\nFoo_Bar = { unknown = "^0", version = "^99" }\nfoo-bar = "^9"\nBad_Array = [{ version = "^1" }, { unknown = "^2" }]\nbad-array = "^4"\n[tool.poetry.group.docs.prod.dependencies]\nphantom = "^99"\n`
    );
    try {
      const result = await cli(owned, ["deps", owned.repo, "--json"]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const deps = JSON.parse(result.stdout);
      expect(deps.runtime).toEqual([
        { name: "foo-bar", version: "^9", type: "runtime" },
        { name: "bad-array", version: "^4", type: "runtime" },
      ]);
      expect(deps.totalCount).toBe(2);
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  });
});
