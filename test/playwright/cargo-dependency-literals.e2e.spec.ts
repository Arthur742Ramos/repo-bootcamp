import { expect, test } from "@playwright/test";
import { cargoDocuments, cargoExpectedRows } from "../helpers/cargo-literal-fixtures.js";

for (const mixed of [false, true]) {
  test(`actual Cargo literal exports retain ordered data and keyboard containment, mixed=${mixed}`, async ({
    page,
  }) => {
    await page.route("**/*", (route) => route.abort());
    let content = "";
    await page.route("http://cargo-export.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: content })
    );
    const docs = await cargoDocuments(mixed);
    const expected = cargoExpectedRows(mixed);
    for (const format of ["html", "pdf"] as const) {
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        content = docs[format];
        await page.goto("http://cargo-export.test/");
        await expect(
          page.getByRole("heading", { name: "Dependency Overview", exact: true })
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        const packages = page
          .locator("table")
          .filter({ has: page.getByRole("columnheader", { name: "Package", exact: true }) });
        await expect(packages).toHaveCount(2);
        for (const [index, kind] of (["runtime", "dev"] as const).entries()) {
          const table = packages.nth(index);
          await expect(table.getByRole("columnheader")).toHaveText(
            mixed ? ["Package", "Version", "Ecosystem", "Manifest"] : ["Package", "Version"]
          );
          const rows = table.locator("tr").filter({ has: page.locator("td") });
          await expect(rows).toHaveCount(expected[kind].length);
          for (const [rowIndex, cells] of expected[kind].entries())
            expect(await rows.nth(rowIndex).locator("td").allTextContents()).toEqual(cells);
          await expect(table.locator("a,img,script,iframe")).toHaveCount(0);
        }
        const names = await packages
          .locator("tr")
          .filter({ has: page.locator("td") })
          .locator("td:first-child")
          .allTextContents();
        for (const phantom of [
          "phantom",
          "target_phantom",
          "not_a_package",
          "version",
          "features",
          "path",
          "workspace",
        ])
          expect(names).not.toContain(phantom);
        const region = page
          .getByRole("region", { name: "Scrollable table", exact: true })
          .filter({ has: page.getByRole("columnheader", { name: "Package", exact: true }) })
          .first();
        await expect(region).toHaveCount(1);
        await region.focus();
        await expect(region).toBeFocused();
        expect(await region.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe(
          "2px"
        );
        const dimensions = await region.evaluate((element) => ({
          scroll: element.scrollWidth,
          client: element.clientWidth,
        }));
        if (width === 320) expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
        await page.keyboard.press("ArrowRight");
        if (dimensions.scroll > dimensions.client)
          await expect
            .poll(() => region.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
        else expect(await region.evaluate((element) => element.scrollLeft)).toBe(0);
        await expect(region).toBeFocused();
        expect(await page.evaluate(() => scrollX)).toBe(0);
      }
    }
  });
}
