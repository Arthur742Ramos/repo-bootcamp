import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
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
async function fixture(mixed: boolean) {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-python-requirement-identity-"));
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "README.md"), "# Owned Python identity fixture\n");
  await writeFile(join(repo, "src", "index.py"), "metadata_only = True\n");
  await writeFile(join(repo, "pyproject.toml"), pyproject);
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

function expectedRows(mixed: boolean) {
  const provenance = (rows: string[][], ecosystem: string, sourceFile: string) =>
    rows.map(([name, version]) => [name, version, ecosystem, sourceFile]);
  return {
    runtime: mixed
      ? [
          ...provenance(nodeRows, "node", "package.json"),
          ...provenance(rustRows, "rust", "Cargo.toml"),
          ...provenance(runtime, "python", "pyproject.toml"),
          ...provenance(goRows, "go", "go.mod"),
        ]
      : runtime,
    dev: mixed ? provenance(dev, "python", "pyproject.toml") : dev,
  };
}

async function exportedDependencies(mixed: boolean) {
  const owned = await fixture(mixed);
  try {
    const docs = new Map<string, string>();
    const rows = expectedRows(mixed);
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
        total: rows.runtime.length + rows.dev.length,
        runtime: rows.runtime.length,
        dev: rows.dev.length,
      });
      docs.set(format, await readFile(join(output, "DEPENDENCIES.html"), "utf8"));
    }
    return docs;
  } finally {
    await rm(owned.base, { recursive: true, force: true });
  }
}

for (const mixed of [false, true]) {
  test(`hosted Python identity tables retain exact first records, mixed=${mixed}`, async ({
    page,
  }) => {
    // Abort all requests first; only this owned document is fulfilled. Fonts,
    // CDN scripts, package URLs and direct-reference artifacts stay unfetched.
    await page.route("**/*", (route) => route.abort());
    let content = "";
    await page.route("http://requirement-identity-export.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: content })
    );
    const docs = await exportedDependencies(mixed);
    const rows = expectedRows(mixed);
    for (const format of ["html", "pdf"]) {
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        content = docs.get(format)!;
        await page.goto("http://requirement-identity-export.test/");
        await expect(
          page.getByRole("heading", { name: "Dependency Overview", exact: true })
        ).toBeVisible();
        const summary = page
          .locator("table")
          .filter({ has: page.getByRole("columnheader", { name: "Type", exact: true }) });
        await expect(summary).toHaveCount(1);
        for (const [name, count] of [
          ["Runtime", rows.runtime.length],
          ["Development", rows.dev.length],
          ["Total", rows.runtime.length + rows.dev.length],
        ] as const) {
          // The predicate is page-rooted: Playwright evaluates it relative to
          // each candidate row, rather than re-rooting at an outer table.
          const row = summary
            .getByRole("row")
            .filter({ has: page.getByRole("cell", { name, exact: true }) });
          await expect(row.getByRole("cell")).toHaveText([name, String(count)]);
        }
        const tables = page
          .locator("table")
          .filter({ has: page.getByRole("columnheader", { name: "Package", exact: true }) });
        await expect(tables).toHaveCount(2);
        for (const [index, expected] of [rows.runtime, rows.dev].entries()) {
          const table = tables.nth(index);
          await expect(table.getByRole("columnheader")).toHaveText(
            mixed ? ["Package", "Version", "Ecosystem", "Manifest"] : ["Package", "Version"]
          );
          await expect(table.getByRole("row")).toHaveCount(expected.length + 1);
          await expect(table.getByRole("cell")).toHaveText(expected.flat());
          for (const [rowIndex, cells] of expected.entries()) {
            // Mixed sidecars deliberately repeat names in different ecosystems;
            // complete ordered row assertions preserve that identity boundary.
            const row = table.getByRole("row").nth(rowIndex + 1);
            await expect(row.getByRole("cell")).toHaveText(cells);
            await expect(row.getByRole("cell").first()).toBeVisible();
            const version = row.getByRole("cell").nth(1);
            await expect(version).not.toContainText(
              /\[|security|tooling|python_version|sys_platform|duplicate-optional/
            );
          }
        }
        await expect(page.getByRole("cell", { name: "foo.bar", exact: true })).toHaveCount(
          mixed ? 1 : 0
        );
        await expect(tables.getByRole("link")).toHaveCount(0);
        await expect(tables.locator("img")).toHaveCount(0);
        for (const name of [
          "and",
          "metadata-phantom",
          "classifiers-phantom",
          "foo--bar",
          "FOO._--BAR",
          "foo-bar-baz",
          "opt_ref",
          "dev-ref",
        ]) {
          await expect(page.getByRole("cell", { name, exact: true })).toHaveCount(0);
        }
      }
    }
  });
}
