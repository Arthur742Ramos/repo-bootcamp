import { expect, test } from "@playwright/test";
import { getIndexHtml } from "../../src/web/templates.js";

for (const width of [1440, 320]) {
  test(`long progress keeps its summary visible and respects manual scrolling at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 1000 });
    await page.route("http://bootcamp.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: getIndexHtml() })
    );
    await page.goto("http://bootcamp.test/");
    await page.evaluate(`
      document.getElementById('progress').hidden = false;
      document.getElementById('progressMeta').textContent = '42.0s elapsed';
      addProgressItem('Analyzing saved local fixture facts', 'phase', 'analyze');
      for (let i = 1; i <= 35; i++) addProgressItem('Fixture message ' + i);
    `);
    await page.locator("#progress").scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("long-progress.png") });
    const summaryVisible = await page.evaluate(() => {
      const panel = document.getElementById("progress")!.getBoundingClientRect();
      return ["progressMeta", "phaseRail"].every((id) => {
        const rect = document.getElementById(id)!.getBoundingClientRect();
        return rect.top >= panel.top && rect.bottom <= panel.bottom;
      });
    });
    expect(summaryVisible).toBe(true);
    const messages = page.locator("#progressItems");
    await expect(messages).toHaveAttribute("tabindex", "0");
    await expect(messages).toHaveAttribute("role", "log");
    expect(
      await messages.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
    ).toBeLessThan(5);
    await messages.focus();
    await page.keyboard.press("Home");
    await messages.evaluate((el) => {
      el.scrollTop = 80;
    });
    const earlier = await messages.evaluate((el) => el.scrollTop);
    await page.evaluate(`addProgressItem('Fixture message 36')`);
    expect(await messages.evaluate((el) => el.scrollTop)).toBe(earlier);
    await messages.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.evaluate(`addProgressItem('Fixture message 37')`);
    expect(
      await messages.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
    ).toBeLessThan(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });
}
