import { expect, test } from "@playwright/test";
import {
  toolingConfigurations,
  toolingDocuments,
  toolingInventory,
  toolingTables,
} from "../helpers/tooling-pyproject-fixtures.js";
import { rejectedLocalNames } from "../helpers/root-local-references.js";

for (const config of toolingConfigurations) {
  test(`hosted actual tooling-only pyproject HTML/PDF exports retain exact fallback rows and containment: ${config.id}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const ownedUrl = "http://tooling-pyproject-export.test/";
    const finished: string[] = [];
    const denied: string[] = [];
    page.on("requestfinished", (request) => finished.push(request.url()));
    await page.route("**/*", async (route) => {
      denied.push(route.request().url());
      await route.abort();
    });
    let content = "";
    // Actual CLI-exported bytes are the sole owned hosted response. PDF mode
    // currently emits printable HTML, so these checks do not claim PDF pixels.
    await page.route(ownedUrl, (route) =>
      route.fulfill({ contentType: "text/html", body: content })
    );
    const docs = await toolingDocuments(config);
    const inventory = toolingInventory(config);
    const tables = toolingTables(config);
    for (const format of ["html", "pdf"] as const) {
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        content = docs[format];
        await page.goto(ownedUrl);
        await expect(
          page.getByRole("heading", { name: "Dependency Overview", exact: true })
        ).toBeVisible();
        expect(await page.evaluate(() => innerWidth)).toBe(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        const summary = page
          .locator("table")
          .filter({ has: page.getByRole("columnheader", { name: "Type", exact: true }) });
        await expect(summary).toHaveCount(1);
        await expect(summary.getByRole("columnheader")).toHaveText(["Type", "Count"]);
        await expect(summary.getByRole("cell")).toHaveText([
          "Runtime",
          String(inventory.runtime.length),
          "Development",
          String(inventory.dev.length),
          ...(inventory.peer.length ? ["Peer", String(inventory.peer.length)] : []),
          "Total",
          String(inventory.runtime.length + inventory.dev.length + inventory.peer.length),
        ]);
        const packages = page
          .locator("table")
          .filter({ has: page.getByRole("columnheader", { name: "Package", exact: true }) });
        await expect(packages).toHaveCount(tables.length);
        await expect(page.locator("table")).toHaveCount(tables.length + 1);
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
        for (const phantom of [...rejectedLocalNames, "metadata-phantom", "string-owned-phantom"])
          expect(names).not.toContain(phantom);
        // A unique td-bearing row anchors only the real fallback runtime table.
        const anchor = packages
          .locator("tr")
          .filter({
            has: page.getByRole("cell", {
              name: config.minimal ? "requests" : "named-relative",
              exact: true,
            }),
          })
          .filter({ has: page.locator("td") });
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
          left: element.getBoundingClientRect().left,
          right: element.getBoundingClientRect().right,
        }));
        expect(dimensions.left).toBeGreaterThanOrEqual(0);
        expect(dimensions.right).toBeLessThanOrEqual(width);
        if (width === 320 && config.mixed)
          expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
        await page.keyboard.press("ArrowRight");
        if (dimensions.scroll > dimensions.client)
          await expect
            .poll(() => region.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
        else expect(await region.evaluate((element) => element.scrollLeft)).toBe(0);
        await expect(region).toBeFocused();
        expect(await page.evaluate(() => scrollX)).toBe(0);
        // Successful screenshot attachments are not retained by normal CI;
        // automated DOM/layout results do not constitute manual pixel review.
        await testInfo.attach(`${format}-tooling-pyproject-${config.id}-${width}`, {
          body: await packages.first().screenshot(),
          contentType: "image/png",
        });
      }
    }
    expect(finished).toEqual([ownedUrl, ownedUrl, ownedUrl, ownedUrl]);
    expect(denied).not.toContain(ownedUrl);
  });
}
