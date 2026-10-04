import { expect, test } from "@playwright/test";
import {
  configurations,
  declarationDocuments,
  declarations,
  expectedInventory,
  expectedTables,
  poetryMetadata,
} from "../helpers/declared-version-display.js";

for (const config of configurations) {
  test(`hosted actual declared-version tables retain literal payloads, mixed=${config.mixed} capped=${config.capped}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.route("**/*", (route) => route.abort());
    let content = "";
    await page.route("http://declaration-export.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: content })
    );
    const docs = await declarationDocuments(config);
    const expected = expectedTables(config);
    const inventory = expectedInventory(config);
    const values = declarations(config);
    for (const format of ["html", "pdf"] as const) {
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        content = docs[format];
        await page.goto("http://declaration-export.test/");
        await expect(
          page.getByRole("heading", { name: "Dependency Overview", exact: true })
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        const summary = page
          .locator("table")
          .filter({ has: page.getByRole("columnheader", { name: "Type", exact: true }) });
        await expect(summary).toHaveCount(1);
        await expect(summary.getByRole("cell")).toHaveText([
          "Runtime",
          String(inventory.runtime.length),
          "Development",
          String(inventory.dev.length),
          "Peer",
          String(inventory.peer.length),
          "Total",
          String(inventory.runtime.length + inventory.dev.length + inventory.peer.length),
        ]);
        const packages = page
          .locator("table")
          .filter({ has: page.getByRole("columnheader", { name: "Package", exact: true }) });
        await expect(packages).toHaveCount(expected.length);
        for (const [index, expectedTable] of expected.entries()) {
          const table = packages.nth(index);
          await expect(table.getByRole("columnheader")).toHaveText(expectedTable.headers);
          const rows = table.locator("tr").filter({ has: page.locator("td") });
          await expect(rows).toHaveCount(expectedTable.rows.length);
          await expect(table.locator("td")).toHaveCount(
            expectedTable.rows.length * expectedTable.headers.length
          );
          await expect(table.locator("td a, td img, td script, td iframe, td svg")).toHaveCount(0);
          for (const [rowIndex, cells] of expectedTable.rows.entries()) {
            const row = rows.nth(rowIndex);
            expect(await row.locator("td").allTextContents()).toEqual(cells);
            const declaration = values[expectedTable.kind].find((item) => item.name === cells[0]);
            if (declaration?.display === "notation") {
              // Visible JSON notation is reversible metadata, not a replacement
              // selector or a resolved/normalized version.
              expect(JSON.parse(cells[1])).toBe(declaration.value);
            }
            if (declaration)
              await expect(row.locator("td").nth(1).locator("code")).toHaveCount(
                declaration.display === "plain" ? 0 : 1
              );
          }
        }
        expect(
          await page.evaluate(() => Reflect.get(globalThis, "declarationInjected"))
        ).toBeUndefined();
        const metadata = page
          .locator("table")
          .filter({ has: page.getByRole("columnheader", { name: "Declaration", exact: true }) });
        if (config.mixed && !config.capped) {
          await expect(metadata).toHaveCount(1);
          await expect(metadata.getByRole("columnheader")).toHaveText([
            "Dependency",
            "Kind",
            "Declaration",
            "Ecosystem",
            "Manifest",
          ]);
          const rows = metadata.locator("tr").filter({ has: page.locator("td") });
          await expect(rows).toHaveCount(1);
          expect(await rows.first().locator("td").allTextContents()).toEqual([
            "poetry-control",
            "runtime",
            JSON.stringify(poetryMetadata),
            "python",
            "pyproject.toml",
          ]);
          await expect(metadata.locator("td a, td img, td script")).toHaveCount(0);
        } else await expect(metadata).toHaveCount(0);
        const names = await packages
          .locator("tr")
          .filter({ has: page.locator("td") })
          .locator("td:first-child")
          .allTextContents();
        if (config.capped) {
          expect(names).not.toContain("runtime-fill-53");
          expect(names).not.toContain("dev-fill-32");
          expect(names).not.toContain("peer-fill-32");
          expect(names.filter((name) => name === "...")).toHaveLength(3);
        } else expect(names).not.toContain("...");
        const region = page
          .getByRole("region", { name: "Scrollable table", exact: true })
          .filter({ has: packages.first() });
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
        expect(await page.evaluate(() => scrollX)).toBe(0);
        if (!config.capped) {
          await testInfo.attach(`${format}-declared-versions-${width}-mixed-${config.mixed}`, {
            body: await packages.first().screenshot(),
            contentType: "image/png",
          });
        }
      }
    }
  });
}
