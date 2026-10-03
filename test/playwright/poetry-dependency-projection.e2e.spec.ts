import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { runbookFacts } from "../helpers/runbook-facts.js";

const root = process.cwd();
// Fixture declarations are TOML/schema metadata, not installable/resolved plans.
const marker =
  '[tool.poetry.dependencies]\nphantom = "^99"\n``` | [link](https://example.invalid/owned) ![image](https://example.invalid/image) <script>globalThis.poetryInjected=true</script>';
const escapedVersion =
  "\\| [owned](https://example.invalid/link) ![image](https://example.invalid/image)";
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
  "whitespace-version": " ",
  "escaped-version": { version: escapedVersion, source: "owned" },
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
"whitespace-version" = " "
"escaped-version" = { version = '\| [owned](https://example.invalid/link) ![image](https://example.invalid/image)', source = "owned" }
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
  ["whitespace-version", " "],
  ["escaped-version", escapedVersion],
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

async function exportedDependencies(mixed: boolean) {
  const owned = await fixture(mixed);
  try {
    const docs = new Map<string, string>();
    const expected = expectedRows(mixed);
    for (const format of ["html", "pdf"]) {
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
      const summary = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
      expect(summary.deps).toEqual({
        total: expected.runtime.length + expected.dev.length,
        runtime: expected.runtime.length,
        dev: expected.dev.length,
      });
      docs.set(format, await readFile(join(output, "DEPENDENCIES.html"), "utf8"));
    }
    return docs;
  } finally {
    await rm(owned.base, { recursive: true, force: true });
  }
}
for (const mixed of [false, true]) {
  test(`hosted actual Poetry declarations remain literal and keyboard-scrollable, mixed=${mixed}`, async ({
    page,
  }) => {
    // Route order matters: deny all network first, then intercept the owned
    // document. Origins, CDN scripts, marker links and images never get fetched.
    await page.route("**/*", (route) => route.abort());
    let content = "";
    await page.route("http://poetry-export.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: content })
    );
    const docs = await exportedDependencies(mixed);
    const expected = expectedRows(mixed);
    for (const format of ["html", "pdf"]) {
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        content = docs.get(format)!;
        await page.goto("http://poetry-export.test/");
        await expect(
          page.getByRole("heading", { name: "Dependency Overview", exact: true })
        ).toBeVisible();
        expect(await page.evaluate(() => innerWidth)).toBe(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        const summary = page
          .locator("table")
          .filter({ has: page.getByRole("columnheader", { name: "Type", exact: true }) });
        await expect(summary).toHaveCount(1);
        await expect(summary.getByRole("cell")).toHaveText([
          "Runtime",
          String(expected.runtime.length),
          "Development",
          String(expected.dev.length),
          "Total",
          String(expected.runtime.length + expected.dev.length),
        ]);
        const packages = page
          .locator("table")
          .filter({ has: page.getByRole("columnheader", { name: "Package", exact: true }) });
        await expect(packages).toHaveCount(2);
        for (const [index, kind] of (["runtime", "dev"] as const).entries()) {
          const table = packages.nth(index);
          await expect(table.getByRole("columnheader")).toHaveText(
            mixed ? ["Package", "Version", "Ecosystem", "Manifest"] : ["Package", "Version"]
          );
          await expect(table.locator("tbody a, tbody img, tbody script, tbody iframe")).toHaveCount(
            0
          );
          // The formatter emits header/data rows without thead; Chromium puts
          // both inside an implicit tbody. Count data cells explicitly.
          const rows = table.locator("tr").filter({ has: page.locator("td") });
          await expect(rows).toHaveCount(expected[kind].length);
          for (const [rowIndex, cells] of expected[kind].entries()) {
            const row = rows.nth(rowIndex);
            // Ordered exact rows distinguish duplicate names across ecosystems.
            expect(await row.locator("td").allTextContents()).toEqual(cells);
            if (
              kind === "runtime" &&
              Object.hasOwn(declared, cells[0]) &&
              (!mixed || cells[2] === "python")
            ) {
              await expect(row.locator("td").nth(1).locator("code")).toHaveCount(1);
            }
          }
        }
        const metadata = page
          .locator("table")
          .filter({ has: page.getByRole("columnheader", { name: "Declaration", exact: true }) });
        await expect(metadata).toHaveCount(1);
        await expect(metadata.getByRole("columnheader")).toHaveText(
          mixed
            ? ["Dependency", "Kind", "Declaration", "Ecosystem", "Manifest"]
            : ["Dependency", "Kind", "Declaration"]
        );
        const metadataRows = metadata.locator("tr").filter({ has: page.locator("td") });
        await expect(metadataRows).toHaveCount(expected.metadata.length);
        for (const [rowIndex, cells] of expected.metadata.entries()) {
          const row = metadataRows.nth(rowIndex);
          expect(await row.locator("td").allTextContents()).toEqual(cells);
          const declaration = row.locator("td").nth(2);
          await expect(declaration.locator("code")).toHaveCount(1);
          await expect(declaration.locator("a, img, script, iframe, svg")).toHaveCount(0);
        }
        expect(
          await page.evaluate(() => Reflect.get(globalThis, "poetryInjected"))
        ).toBeUndefined();
        for (const phantom of [
          "phantom",
          "foreign",
          "namespace-phantom",
          "version",
          "extras",
          "markers",
          "python",
          "optional",
          "ALPHA",
        ]) {
          await expect(packages.getByRole("cell", { name: phantom, exact: true })).toHaveCount(0);
        }
        const region = page
          .getByRole("region", { name: "Scrollable table", exact: true })
          .filter({ has: metadata });
        await expect(region).toHaveCount(1);
        await region.focus();
        await expect(region).toBeFocused();
        expect(await region.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe(
          "2px"
        );
        expect(await region.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
          await region.evaluate((element) => element.clientWidth)
        );
        await page.keyboard.press("ArrowRight");
        await expect
          .poll(() => region.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
        expect(await page.evaluate(() => scrollX)).toBe(0);
        await expect(
          page.getByText("Ordered alternatives are descriptive and no branch is selected.", {
            exact: false,
          })
        ).toBeVisible();
      }
    }
  });
}
