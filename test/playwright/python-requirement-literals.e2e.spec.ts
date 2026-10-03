import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
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
      expect(summary.deps).toEqual({ total: mixed ? 9 : 8, runtime: mixed ? 7 : 6, dev: 2 });
      docs.set(format, await readFile(join(output, "DEPENDENCIES.html"), "utf8"));
    }
    return docs;
  } finally {
    await rm(owned.base, { recursive: true, force: true });
  }
}

for (const mixed of [false, true]) {
  test(`hosted exported Python requirement tables retain exact literals, mixed=${mixed}`, async ({
    page,
  }) => {
    // Block every request first, then allow only this owned document. CDN
    // scripts, fonts and package URLs are never fetched by this regression.
    await page.route("**/*", (route) => route.abort());
    let content = "";
    await page.route("http://requirement-export.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: content })
    );
    const docs = await exportedDependencies(mixed);
    const runtimeRows = mixed ? [["typescript", "^6.0.0"], ...runtime] : runtime;
    const expected = [...runtimeRows, ...dev];
    for (const format of ["html", "pdf"]) {
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        content = docs.get(format)!;
        await page.goto("http://requirement-export.test/");
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
            const row = table.getByRole("row").filter({ has: nameCell });
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
        await expect(page.getByRole("cell", { name: "and", exact: true })).toHaveCount(0);
        await expect(page.getByRole("cell", { name: "classifiers", exact: true })).toHaveCount(0);
      }
    }
  });
}
