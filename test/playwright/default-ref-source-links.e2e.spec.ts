import { expect, test } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { convertToHtml } from "../../src/formatter.js";
import { runbookFacts } from "../helpers/runbook-facts.js";

const root = process.cwd();
const remote = "https://github.com/owned/default-ref-fixture";

async function exportFixture(ref: string) {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-browser-ref-"));
  try {
    const repo = join(base, "repo");
    const selected = join(repo, "packages", "ref app");
    await mkdir(join(selected, "src"), { recursive: true });
    await writeFile(join(selected, "package.json"), '{"name":"owned-ref-package"}\n');
    await writeFile(join(selected, "README.md"), "# Owned browser source-ref fixture\n");
    await writeFile(join(selected, "src", "index.ts"), "export const metadataOnly = true;\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    git("init", "-b", "main");
    git("config", "user.name", "Owned Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("add", ".");
    git("commit", "--no-gpg-sign", "-m", "Owned browser metadata");
    git("checkout", "-b", ref);
    for (const dir of ["home", "cache", "tmp"]) await mkdir(join(base, dir));
    const preload = join(base, "owned-home.mjs");
    await writeFile(
      preload,
      "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>process.env.OWNED_REF_HOME;syncBuiltinESMExports();"
    );
    const response = join(base, "response.json");
    const facts = runbookFacts();
    facts.repoName = "owned/default-ref-fixture";
    await writeFile(response, JSON.stringify(facts));
    const env = {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
      OWNED_REF_HOME: join(base, "home"),
      HOME: join(base, "home"),
      USERPROFILE: join(base, "home"),
      XDG_CACHE_HOME: join(base, "cache"),
      TMPDIR: join(base, "tmp"),
      TSX_DISABLE_CACHE: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(repo).href}.insteadOf`,
      GIT_CONFIG_VALUE_0: remote + ".git",
    };
    const loader = pathToFileURL(join(root, "node_modules", "tsx", "dist", "loader.mjs")).href;
    const docs = new Map<string, string>();
    for (const format of ["markdown", "html", "pdf"] as const) {
      const output = join(base, format);
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          loader,
          "--import",
          pathToFileURL(preload).href,
          join(root, "src", "cli.ts"),
          remote,
          "--subdir",
          "packages/ref app",
          "--no-cache",
          "--quiet",
          "--format",
          format,
          "--output",
          output,
        ],
        { cwd: base, env, encoding: "utf8", timeout: 60_000 }
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
      for (const name of ["CODEMAP", "ARCHITECTURE"]) {
        docs.set(
          `${format}/${name}`,
          await readFile(join(output, name + (format === "markdown" ? ".md" : ".html")), "utf8")
        );
      }
    }
    return docs;
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

for (const [ref, encodedRef] of [
  ["release/v2#candidate", "release/v2%23candidate"],
  ["release/v2(candidate)", "release/v2%28candidate%29"],
  ["release/v2%complete", "release/v2%25complete"],
]) {
  test(`native exported source links retain detected default ref ${ref}`, async ({ page }) => {
    const docs = await exportFixture(ref);
    const expected = `${remote}/blob/${encodedRef}/packages/ref%20app/src/index.ts`;
    const intercepted: string[] = [];
    await page.route(`${remote}/**`, (route) => {
      intercepted.push(route.request().url());
      return route.fulfill({
        contentType: "text/plain",
        body: "Owned intercepted source destination",
      });
    });
    let content = "";
    await page.route("http://source-export.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: content })
    );
    // A legacy raw-ref projection must visibly fail the same URL contract in
    // Chromium; the real CLI exports below must satisfy it without live traffic.
    content = convertToHtml(
      docs.get("markdown/CODEMAP")!.replaceAll(`/blob/${encodedRef}/`, `/blob/${ref}/`),
      "Legacy source-ref control"
    );
    await page.goto("http://source-export.test/");
    const oldLink = page.getByRole("link", { name: "src/index.ts", exact: true }).first();
    await expect(oldLink).toBeVisible();
    await expect(oldLink).not.toHaveAttribute("href", expected);
    for (const format of ["html", "pdf"]) {
      for (const name of ["CODEMAP", "ARCHITECTURE"]) {
        for (const width of [320, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          content = docs.get(`${format}/${name}`)!;
          await page.goto("http://source-export.test/");
          const link = page.getByRole("link", { name: "src/index.ts", exact: true }).first();
          await expect(link).toBeVisible();
          await expect(link).toHaveAttribute("href", expected);
          expect(
            await link.evaluate((element) => new URL((element as HTMLAnchorElement).href).hash)
          ).toBe("");
          await link.focus();
          await expect(link).toBeFocused();
          await Promise.all([page.waitForURL(expected), page.keyboard.press("Enter")]);
          await expect(page.locator("body")).toContainText("Owned intercepted source destination");
          expect(intercepted.at(-1)).toBe(expected);
          await page.goBack();
          await expect(
            page.getByRole("link", { name: "src/index.ts", exact: true }).first()
          ).toHaveAttribute("href", expected);
        }
      }
    }
    expect(intercepted).toHaveLength(8);
  });
}
