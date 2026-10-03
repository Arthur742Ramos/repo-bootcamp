import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runbookFacts } from "../helpers/runbook-facts.js";

const root = process.cwd();

async function exportedDependencies(mixed: boolean) {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-browser-python-comments-"));
  try {
    const repo = join(base, "repo");
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "README.md"), "# Owned dependency browser fixture\n");
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
        'dev = ["pytest>=8", # "phantom-dev>=99" ]',
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
    for (const dir of ["home", "cache", "tmp"]) await mkdir(join(base, dir));
    const response = join(base, "response.json");
    const facts = runbookFacts();
    facts.repoName = "local/repo";
    await writeFile(response, JSON.stringify(facts));
    const preload = join(base, "owned-home.mjs");
    await writeFile(
      preload,
      "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>process.env.OWNED_PYTHON_HOME;syncBuiltinESMExports();"
    );
    const docs = new Map<string, string>();
    for (const format of ["html", "pdf"]) {
      const output = join(base, format);
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          pathToFileURL(join(root, "node_modules", "tsx", "dist", "loader.mjs")).href,
          "--import",
          pathToFileURL(preload).href,
          join(root, "src", "cli.ts"),
          repo,
          "--no-clone",
          "--no-cache",
          "--quiet",
          "--format",
          format,
          "--output",
          output,
        ],
        {
          cwd: base,
          encoding: "utf8",
          timeout: 60_000,
          env: {
            PATH: process.env.PATH,
            NODE_ENV: "test",
            REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
            OWNED_PYTHON_HOME: join(base, "home"),
            HOME: join(base, "home"),
            USERPROFILE: join(base, "home"),
            XDG_CACHE_HOME: join(base, "cache"),
            TMPDIR: join(base, "tmp"),
            TSX_DISABLE_CACHE: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_SYSTEM: "/dev/null",
          },
        }
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const summary = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
      expect(summary.deps).toEqual({ total: mixed ? 7 : 6, runtime: mixed ? 5 : 4, dev: 2 });
      docs.set(format, await readFile(join(output, "DEPENDENCIES.html"), "utf8"));
    }
    return docs;
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

for (const mixed of [false, true]) {
  test(`native dependency tables exclude comment packages with mixed=${mixed}`, async ({
    page,
  }) => {
    const docs = await exportedDependencies(mixed);
    await page.route("**/*", (route) => route.abort());
    let content = "";
    await page.route("http://dependency-export.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: content })
    );
    for (const format of ["html", "pdf"]) {
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        content = docs.get(format)!;
        await page.goto("http://dependency-export.test/");
        await expect(
          page.getByRole("heading", { name: "Dependency Overview", exact: true })
        ).toBeVisible();
        await expect(page.locator("body")).not.toContainText("phantom");
        const total = page
          .getByRole("row")
          .filter({ has: page.getByRole("cell", { name: "Total", exact: true }) });
        await expect(total.getByRole("cell").last()).toHaveText(String(mixed ? 7 : 6));
        for (const name of ["requests", "direct", "flask", "httpx", "pytest", "ruff"]) {
          await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
        }
        await expect(
          page.getByRole("cell", {
            name: "@ https://example.invalid/package.whl#owned",
            exact: true,
          })
        ).toBeVisible();
        if (mixed) {
          const row = page
            .getByRole("row")
            .filter({ has: page.getByRole("cell", { name: "requests", exact: true }) });
          await expect(row.getByRole("cell")).toHaveText([
            "requests",
            ">=2.28",
            "python",
            "pyproject.toml",
          ]);
          await expect(page.getByRole("cell", { name: "typescript", exact: true })).toBeVisible();
        }
      }
    }
  });
}
