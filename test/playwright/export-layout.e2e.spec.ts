import { expect, test } from "@playwright/test";
import { convertToHtml, markdownToHtml } from "../../src/formatter.js";
import { getIndexHtml } from "../../src/web/templates.js";

const filename =
  "packages/workspace-with-a-long-name/src/routes/a-deeply-nested-dynamic-endpoint/[organizationId]/page.ts";
const markdown = `# Code map\n\nRead [\`${filename}\`](https://example.com/${filename}) before editing.\n\n| Package | Version | Purpose | Imported by |\n|---|---|---|---|\n| @company/repository-integration | 1.2.3 | Source integration | \`${filename}\` |\n\n\`\`\`sh\nnpm run verify:repository-integration -- --target=${filename}\n\`\`\``;

test("HTML exports contain wide tables and support keyboard scrolling", async ({ page }) => {
  await page.setContent(convertToHtml(markdown, "Code map"));
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => innerWidth)).toBe(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width
  );
  const table = page.getByRole("region", { name: "Scrollable table" });
  await table.focus();
  await expect(table).toBeFocused();
  const overflow = await table.evaluate((element) => element.scrollWidth > element.clientWidth);
  if (overflow) {
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  }
  const code = page.getByRole("region", { name: "Code block" });
  await code.focus();
  await expect(code).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => code.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await code.innerText()).toContain(filename);
});

test("the sanitized web reader preserves table and code keyboard scroll regions", async ({
  page,
}) => {
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: getIndexHtml() })
  );
  await page.route("**/files/**", (route) =>
    route.fulfill({ json: { content: markdown, html: markdownToHtml(markdown) } })
  );
  await page.goto("http://bootcamp.test/");
  await page.evaluate("currentJobId = 'fixture'; void viewFile('CODEMAP.md')");
  const table = page.getByRole("region", { name: "Scrollable table" });
  await expect(table).toBeVisible();
  await table.focus();
  await expect(table).toBeFocused();
  const code = page.getByRole("region", { name: "Code block" });
  await code.focus();
  await expect(code).toBeFocused();
  if (await code.evaluate((element) => element.scrollWidth > element.clientWidth)) {
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => code.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  }
  expect(await code.innerText()).toContain(filename);
  expect(
    await page.locator("#modal").evaluate((element) => element.scrollWidth <= element.clientWidth)
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal")).toBeHidden();
});

test("printed HTML exports retain all table columns and wrap long commands", async ({ page }) => {
  await page.setContent(convertToHtml(markdown, "Code map"));
  await page.emulateMedia({ media: "print" });
  const table = page.getByRole("region", { name: "Scrollable table" });
  expect(await table.evaluate((element) => getComputedStyle(element).overflowX)).toBe("visible");
  const bounds = await page
    .locator("th")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().right));
  const right = await page
    .locator("body")
    .evaluate((element) => element.getBoundingClientRect().right);
  expect(Math.max(...bounds)).toBeLessThanOrEqual(right + 1);
  await expect(page.locator("th").last()).toHaveText("Imported by");
  const code = page.getByRole("region", { name: "Code block" });
  expect(await code.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true
  );
  expect(await code.innerText()).toContain(filename);
});
