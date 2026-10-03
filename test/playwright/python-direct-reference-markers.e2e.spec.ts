import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { runbookFacts } from "../helpers/runbook-facts.js";

const root = process.cwd();
const runtime = [
  ["sample", "@ https://example.invalid/package.whl;owned#sha256=abc"],
  ["query-ref", "@ https://example.invalid/package.whl?channel=stable;owned#sha256=def"],
  ["fragment-ref", "@ https://example.invalid/package.whl#owned;sha256=ghi"],
  [
    "space-marker",
    "@ https://example.invalid/package.whl;path?channel=stable;query#owned;fragment",
  ],
  ["tab-marker", "@ https://example.invalid/package.whl;owned#sha256=jkl"],
  ["ordinary", ">=2.28"],
  ["range-pin", ">=2,<3"],
  ["option-ref", "@ https://example.invalid/optional.whl;owned?feature=extra;yes#sha256=mno"],
];
const dev = [
  ["sample", "@ https://example.invalid/dev-sample.whl;owned#sha256=pqr"],
  ["dev-ref", "@ https://example.invalid/dev.whl;owned#sha256=stu"],
  ["dev-query", "@ https://example.invalid/dev.whl?channel=test;owned#sha256=vwx"],
  ["dev-ordinary", "~=8.0"],
];

async function fixture(mixed: boolean) {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-python-direct-reference-"));
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "README.md"), "# Owned direct-reference marker fixture\n");
  await writeFile(join(repo, "src", "index.py"), "metadata_only = True\n");
  // These are TOML source escapes, not JavaScript escapes. Every decoded string
  // is valid PEP 508. Semicolons within URL tokens are data; a marker
  // delimiter follows space or tab. No requirement URL is ever retrieved.
  await writeFile(
    join(repo, "pyproject.toml"),
    String.raw`[project]
name = "owned-python-direct-references"
version = "1.0.0"
description = 'dependencies = ["metadata-phantom>=99"]'
dependencies = [
  'sample @ https://example.invalid/package.whl;owned#sha256=abc',
  'query-ref @ https://example.invalid/package.whl?channel=stable;owned#sha256=def',
  'fragment-ref @ https://example.invalid/package.whl#owned;sha256=ghi',
  'space-marker[fast] @ https://example.invalid/package.whl;path?channel=stable;query#owned;fragment ; python_version >= "3.10" and platform_system == "Windows"',
  "tab-marker @ https://example.invalid/package.whl;owned#sha256=jkl\t; sys_platform == \"linux\"",
  'ordinary[security]>=2.28;python_version >= "3.10"',
  'range-pin >=2,<3; python_version >= "3.10"',
  'sample @ https://example.invalid/duplicate-runtime.whl;ignored#sha256=unused',
]
classifiers = ["classifiers-phantom"]
[project.optional-dependencies]
feature = [
  "option-ref[extra] @ https://example.invalid/optional.whl\u003Bowned?feature=extra;yes#sha256=mno ; python_version >= \"3.10\"",
  'sample @ https://example.invalid/duplicate-optional.whl;ignored#sha256=unused',
]
[dependency-groups]
dev = [
  'sample @ https://example.invalid/dev-sample.whl;owned#sha256=pqr',
  '''dev-ref[lint] @ https://example.invalid/dev.whl;owned#sha256=stu ; platform_release == "[" and implementation_name == "cpython"''',
  "dev-query @ https://example.invalid/dev.whl?channel=test;owned#sha256=vwx\t; python_version >= \"3.10\"",
  'dev-ordinary[tooling]~=8.0;python_version >= "3.10"',
  'dev-ref @ https://example.invalid/duplicate-dev.whl;ignored#sha256=unused',
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

async function exportedDependencies(mixed: boolean) {
  const owned = await fixture(mixed);
  try {
    const docs = new Map<string, string>();
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
      expect(summary.deps).toEqual({ total: mixed ? 13 : 12, runtime: mixed ? 9 : 8, dev: 4 });
      docs.set(format, await readFile(join(output, "DEPENDENCIES.html"), "utf8"));
    }
    return docs;
  } finally {
    await rm(owned.base, { recursive: true, force: true });
  }
}

for (const mixed of [false, true]) {
  test(`hosted Python direct-reference tables retain exact URL versions, mixed=${mixed}`, async ({
    page,
  }) => {
    // Block every request first, then allow only this owned document. CDN
    // scripts, fonts and package URLs are never fetched by this regression.
    await page.route("**/*", (route) => route.abort());
    let content = "";
    await page.route("http://direct-reference-export.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: content })
    );
    const docs = await exportedDependencies(mixed);
    const runtimeRows = mixed ? [["typescript", "^6.0.0"], ...runtime] : runtime;
    const expected = [...runtimeRows, ...dev];
    for (const format of ["html", "pdf"]) {
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        content = docs.get(format)!;
        await page.goto("http://direct-reference-export.test/");
        await expect(
          page.getByRole("heading", { name: "Dependency Overview", exact: true })
        ).toBeVisible();
        const summary = page.locator("table").filter({
          has: page.getByRole("columnheader", { name: "Type", exact: true }),
        });
        await expect(summary).toHaveCount(1);
        for (const [name, count] of [
          ["Runtime", runtimeRows.length],
          ["Development", dev.length],
          ["Total", expected.length],
        ] as const) {
          const row = summary
            .getByRole("row")
            .filter({ has: page.getByRole("cell", { name, exact: true }) });
          await expect(row.getByRole("cell")).toHaveText([name, String(count)]);
        }
        const tables = page.locator("table").filter({
          has: page.getByRole("columnheader", { name: "Package", exact: true }),
        });
        await expect(tables).toHaveCount(2);
        for (const [index, rows] of [runtimeRows, dev].entries()) {
          const table = tables.nth(index);
          await expect(table.getByRole("columnheader")).toHaveText(
            mixed ? ["Package", "Version", "Ecosystem", "Manifest"] : ["Package", "Version"]
          );
          await expect(table.getByRole("cell")).toHaveCount(rows.length * (mixed ? 4 : 2));
          for (const [name, version] of rows) {
            const nameCell = table.getByRole("cell", { name, exact: true });
            await expect(nameCell).toBeVisible();
            const row = table.getByRole("row").filter({
              has: page.getByRole("cell", { name, exact: true }),
            });
            await expect(row.getByRole("cell")).toHaveText(
              mixed
                ? [
                    name,
                    version,
                    name === "typescript" ? "node" : "python",
                    name === "typescript" ? "package.json" : "pyproject.toml",
                  ]
                : [name, version]
            );
          }
        }
        // Direct references must remain inert text cells, never links or images.
        await expect(tables.getByRole("link")).toHaveCount(0);
        await expect(tables.locator("img")).toHaveCount(0);
        await expect(page.getByRole("cell", { name: "and", exact: true })).toHaveCount(0);
        await expect(page.getByRole("cell", { name: "metadata-phantom", exact: true })).toHaveCount(
          0
        );
        await expect(
          page.getByRole("cell", { name: "classifiers-phantom", exact: true })
        ).toHaveCount(0);
      }
    }
  });
}
