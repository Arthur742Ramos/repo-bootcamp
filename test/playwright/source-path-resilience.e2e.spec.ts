import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  fixture,
  generate,
  remote,
  validFiles,
  sourceUrls,
  rejectedPaths,
  command,
  example,
} from "../helpers/source-path-resilience.js";

async function exports() {
  const owned = await fixture();
  try {
    const docs = new Map<string, string>();
    for (const format of ["html", "pdf"] as const) {
      const { result, output } = await generate(owned, format);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const facts = JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8"));
      expect(facts.structure.entrypoints).toEqual(owned.facts.structure.entrypoints);
      expect(facts.architecture.codeExamples).toEqual(owned.facts.architecture.codeExamples);
      for (const name of ["CODEMAP", "ARCHITECTURE", "FIRST_TASKS", "ONBOARDING", "RUNBOOK"])
        docs.set(`${format}/${name}`, await readFile(join(output, name + ".html"), "utf8"));
    }
    return docs;
  } finally {
    await rm(owned.base, { recursive: true, force: true });
  }
}
test("hosted actual source-path exports preserve exact labels, literal controls and intercepted destinations", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const intercepted: string[] = [];
  await page.route("**/*", (route) => route.abort());
  await page.route(`${remote}/**`, (route) => {
    intercepted.push(route.request().url());
    return route.fulfill({
      contentType: "text/plain",
      body: "Owned intercepted source destination",
    });
  });
  let content = "";
  await page.route("http://source-path-export.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: content })
  );
  const docs = await exports();
  // Qualification can replay a separately generated, provenance-recorded
  // pre-fix CLI artifact. Routine CI never requires a second checkout or file.
  const baselineHtml = process.env.REPO_BOOTCAMP_TEST_SOURCE_PATH_BASELINE_HTML;
  if (baselineHtml) {
    content = await readFile(baselineHtml, "utf8");
    await page.goto("http://source-path-export.test/");
    const legacy = page.locator(`a[href="${sourceUrls[0]}"]`).first();
    await expect(legacy).toHaveCount(1);
    await expect(legacy.locator("code")).toHaveText("src/read");
    expect(await legacy.textContent()).not.toBe(validFiles[0]);
    await testInfo.attach("before-main209-actual-cli-html-backtick-source-label", {
      body: await legacy.screenshot(),
      contentType: "image/png",
    });
  }
  for (const format of ["html", "pdf"]) {
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of ["CODEMAP", "ARCHITECTURE", "FIRST_TASKS"]) {
        content = docs.get(`${format}/${name}`)!;
        await page.goto("http://source-path-export.test/");
        for (const [index, path] of validFiles.entries()) {
          const links = page.getByRole("link", { name: path, exact: true });
          expect(await links.count()).toBeGreaterThan(0);
          const link = links.first();
          await expect(link).toHaveAttribute("href", sourceUrls[index]);
          await expect(link.locator("code")).toHaveText(path);
          expect(await link.evaluate((element) => element.textContent)).toBe(path);
          await expect(link.locator("a, img, script")).toHaveCount(0);
          expect(
            await link.evaluate((element) => new URL((element as HTMLAnchorElement).href).hash)
          ).toBe("");
        }
        for (const path of rejectedPaths) {
          const text = path.includes("outside") ? path : JSON.stringify(path);
          const literals = page.locator("code").filter({ hasText: text });
          expect(await literals.count()).toBeGreaterThan(0);
          expect(await literals.first().textContent()).toBe(text);
          await expect(page.getByRole("link", { name: text, exact: true })).toHaveCount(0);
        }
        const sourceAnchors = await page
          .locator('a[href*="/blob/"]')
          .evaluateAll((elements) => elements.map((element) => element.getAttribute("href")));
        expect(sourceAnchors.length).toBeGreaterThan(0);
        expect(sourceAnchors.every((href) => sourceUrls.includes(href!))).toBe(true);
        if (name === "ARCHITECTURE") {
          const entryTable = page
            .locator("table")
            .filter({ has: page.getByRole("columnheader", { name: "Path", exact: true }) });
          await expect(entryTable).toHaveCount(1);
          await expect(entryTable.getByRole("columnheader")).toHaveText([
            "Path",
            "Type",
            "Description",
          ]);
          const rows = entryTable.locator("tbody tr");
          await expect(rows).toHaveCount(validFiles.length + rejectedPaths.length);
          for (const [index, path] of [...validFiles, ...rejectedPaths].entries()) {
            const label = rejectedPaths.slice(0, 2).includes(path) ? JSON.stringify(path) : path;
            expect(await rows.nth(index).locator("td").allTextContents()).toEqual([
              label,
              "library",
              `Owned entrypoint ${index}`,
            ]);
          }
          await expect(
            page.locator("pre code").filter({ hasText: "export const label" })
          ).toHaveText(example);
          await testInfo.attach(`${format}-source-paths-${width}`, {
            body: await entryTable.screenshot(),
            contentType: "image/png",
          });
        }
        if (name === "CODEMAP") {
          await testInfo.attach(`${format}-after-backtick-source-label-${width}`, {
            body: await page
              .getByRole("link", { name: validFiles[0], exact: true })
              .first()
              .screenshot(),
            contentType: "image/png",
          });
        }
        const selected = width === 320 ? 0 : validFiles.length - 1;
        const link = page.getByRole("link", { name: validFiles[selected], exact: true }).first();
        await link.focus();
        await expect(link).toBeFocused();
        await Promise.all([page.waitForURL(sourceUrls[selected]), page.keyboard.press("Enter")]);
        await expect(page.locator("body")).toHaveText("Owned intercepted source destination");
        expect(intercepted.at(-1)).toBe(sourceUrls[selected]);
        await page.goBack();
        await expect(
          page.getByRole("link", { name: validFiles[selected], exact: true }).first()
        ).toHaveAttribute("href", sourceUrls[selected]);
      }
      for (const name of ["ONBOARDING", "RUNBOOK"]) {
        content = docs.get(`${format}/${name}`)!;
        await page.goto("http://source-path-export.test/");
        const blocks = await page.locator("pre code").allTextContents();
        expect(blocks).toContain(command);
      }
    }
  }
  expect(intercepted).toHaveLength(12);
});
