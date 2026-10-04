import { expect, test } from "@playwright/test";
import {
  expectedInventory,
  expectedTables,
  rejectedNames,
  requirementDocuments,
} from "../helpers/root-requirement-lines.js";

for (const mixed of [false, true]) {
  test(`hosted actual root logical-line exports retain exact ordered packages, mixed=${mixed}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.route("**/*", (route) => route.abort());
    let content = "";
    await page.route("http://root-requirement-export.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: content })
    );
    const config = { mixed, ending: "\n" as const };
    const docs = await requirementDocuments(config);
    const tables = expectedTables(config);
    const inventory = expectedInventory(config);
    for (const format of ["html", "pdf"] as const) {
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        content = docs[format];
        await page.goto("http://root-requirement-export.test/");
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
          ...(mixed ? ["Peer", String(inventory.peer.length)] : []),
          "Total",
          String(inventory.runtime.length + inventory.dev.length + inventory.peer.length),
        ]);
        const packages = page
          .locator("table")
          .filter({ has: page.getByRole("columnheader", { name: "Package", exact: true }) });
        await expect(packages).toHaveCount(tables.length);
        for (const [index, expected] of tables.entries()) {
          const table = packages.nth(index);
          await expect(table.getByRole("columnheader")).toHaveText(expected.headers);
          const rows = table.locator("tr").filter({ has: page.locator("td") });
          await expect(rows).toHaveCount(expected.rows.length);
          await expect(table.locator("td")).toHaveCount(
            expected.rows.length * expected.headers.length
          );
          await expect(table.locator("td a, td img, td script, td iframe")).toHaveCount(0);
          for (const [rowIndex, cells] of expected.rows.entries())
            expect(await rows.nth(rowIndex).locator("td").allTextContents()).toEqual(cells);
        }
        const names = await packages
          .locator("tr")
          .filter({ has: page.locator("td") })
          .locator("td:first-child")
          .allTextContents();
        for (const name of rejectedNames) expect(names).not.toContain(name);
        // A real unique data-cell anchor selects only the runtime table's
        // keyboard region; header text is shared by runtime/dev/peer tables.
        const anchor = packages.getByRole("cell", { name: "envliteral", exact: true });
        await expect(anchor).toHaveCount(1);
        const region = page
          .getByRole("region", { name: "Scrollable table", exact: true })
          .filter({ has: anchor });
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
        if (width === 320 && mixed) expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
        await page.keyboard.press("ArrowRight");
        if (dimensions.scroll > dimensions.client)
          await expect
            .poll(() => region.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
        else expect(await region.evaluate((element) => element.scrollLeft)).toBe(0);
        expect(await page.evaluate(() => scrollX)).toBe(0);
        await testInfo.attach(`${format}-root-logical-lines-${width}-mixed-${mixed}`, {
          body: await packages.first().screenshot(),
          contentType: "image/png",
        });
      }
    }
  });
}
