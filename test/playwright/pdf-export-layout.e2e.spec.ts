import { expect, test } from "@playwright/test";
import { convertToPdf } from "../../src/formatter.js";

const markdown = `# Dependencies

| Package | Version | Ecosystem | Source |
|---|---|---|---|
| github.com/example/repository-integration | v1.2.3 | Go | go.mod |
| @company/repository-integration | ^4.5.6 | Node.js | package.json |
| literal-package | range\\|with\\|pipes\\\\suffix | Python | pyproject.toml |
`;
const expectedCells = [
  "github.com/example/repository-integration",
  "v1.2.3",
  "Go",
  "go.mod",
  "@company/repository-integration",
  "^4.5.6",
  "Node.js",
  "package.json",
  "literal-package",
  "range|with|pipes\\suffix",
  "Python",
  "pyproject.toml",
];

for (const width of [320, 375, 1280]) {
  test(`PDF-ready tables preserve data and scroll locally at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(convertToPdf(markdown, "Dependencies"));
    expect(await page.evaluate(() => innerWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(page.locator("th")).toHaveText(["Package", "Version", "Ecosystem", "Source"]);
    await expect(page.locator("td")).toHaveText(expectedCells);

    const region = page.getByRole("region", { name: "Scrollable table" });
    await region.focus();
    await expect(region).toBeFocused();
    expect(await region.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("2px");
    if (width < 1280) {
      expect(await region.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
        await region.evaluate((element) => element.clientWidth)
      );
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      for (let index = 0; index < 30; index++) await page.keyboard.press("ArrowRight");
      await expect
        .poll(() =>
          region.evaluate(
            (element) => element.scrollWidth - element.clientWidth - element.scrollLeft
          )
        )
        .toBeLessThanOrEqual(1);
      const right = await region.evaluate((element) => element.getBoundingClientRect().right);
      const lastCell = page.locator("td").last();
      expect(
        await lastCell.evaluate((element) => element.getBoundingClientRect().right)
      ).toBeLessThanOrEqual(right + 1);
      await expect(lastCell).toHaveText("pyproject.toml");
    }
    expect(await page.evaluate(() => scrollX)).toBe(0);
  });
}

test("PDF-ready mobile navigation uses the requested viewport at normal reading scale", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 900 },
    isMobile: true,
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    await page.route("http://pdf-export.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: convertToPdf(markdown, "Dependencies") })
    );
    await page.goto("http://pdf-export.test/");
    expect(await page.evaluate(() => innerWidth)).toBe(320);
    expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  } finally {
    await context.close();
  }
});

test("PDF-ready print tables retain automatic columns and existing typography", async ({
  page,
}) => {
  await page.setViewportSize({ width: 643, height: 900 });
  await page.setContent(
    convertToPdf(
      markdown
        .replace("github.com/example/repository-integration", "github.com/prometheus/client_golang")
        .replace("range\\|with\\|pipes\\\\suffix", "^1.2.3"),
      "Dependencies"
    )
  );
  await page.emulateMedia({ media: "print" });
  const region = page.getByRole("region", { name: "Scrollable table" });
  expect(await region.evaluate((element) => getComputedStyle(element).overflowX)).toBe("visible");
  expect(
    await page.locator("table").evaluate((element) => getComputedStyle(element).tableLayout)
  ).toBe("auto");
  expect(await page.locator("body").evaluate((element) => getComputedStyle(element).fontSize)).toBe(
    "14.6667px"
  );
  await expect(page.locator("td")).toHaveText(
    expectedCells.map((cell) =>
      cell === "github.com/example/repository-integration"
        ? "github.com/prometheus/client_golang"
        : cell === "range|with|pipes\\suffix"
          ? "^1.2.3"
          : cell
    )
  );
  const right = await page
    .locator("body")
    .evaluate((element) => element.getBoundingClientRect().right);
  expect(
    await page.locator("table").evaluate((element) => element.getBoundingClientRect().right)
  ).toBeLessThanOrEqual(right + 1);
});
