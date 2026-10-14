import { expect, test, type Page } from "@playwright/test";
import { getIndexHtml } from "../../src/web/templates.js";
import { markdownToHtml } from "../../src/formatter.js";
import { useMemoryClipboard } from "../helpers/browser-clipboard.js";

const onboarding =
  "# Onboarding\n\n## Prerequisites Checklist\n\n- Node.js\n\n## Clone & Install\n\nUse the documented checkout and dependency setup.\n\n[Architecture](./ARCHITECTURE.md)";

async function showFixture(
  page: Page,
  subdir: string,
  files = ["ONBOARDING.md", "ARCHITECTURE.md"]
) {
  await page.route("**/api/analyze", (route) =>
    route.fulfill({ json: { jobId: "setup-fixture" } })
  );
  await page.route("**/stream", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body:
        "data: " +
        JSON.stringify({
          type: "complete",
          message: "Fixture complete",
          data: {
            files,
            stats: {
              securityScore: 100,
              securityGrade: "A",
              riskScore: 0,
              riskGrade: "A",
              dependencies: 0,
            },
            manifest: { repository: { fullName: "fixture/monorepo", branch: "main" } },
            quickstartCommands: [{ name: "test", command: "npm test", source: "package.json" }],
          },
        }) +
        "\n\n",
    })
  );
  await page.locator("#repoUrl").fill("fixture/monorepo");
  await page.locator("#advancedOptions").evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
  await page.locator("#subdir").fill(subdir);
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator("#results")).toHaveClass("results show");
}

test.beforeEach(async ({ page }) => {
  await useMemoryClipboard(page);
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: getIndexHtml() })
  );
  await page.route("**/files/**", (route) => {
    const content = route.request().url().includes("ONBOARDING.md")
      ? onboarding
      : "# Architecture\n\nFixture architecture.";
    return route.fulfill({ json: { content, html: markdownToHtml(content) } });
  });
  await page.goto("http://bootcamp.test/");
});

for (const width of [1440, 320]) {
  test(`setup precedes commands and opens prerequisites with navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 1000 });
    await showFixture(page, "packages/app");
    const setup = page.locator("#setupGuidance");
    await expect(setup).toContainText("monorepo/packages/app", { timeout: 2000 });
    expect(
      await setup.evaluate((el) =>
        Boolean(
          el.compareDocumentPosition(document.getElementById("quickstartPanel")!) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      )
    ).toBe(true);
    await setup.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("setup-before-commands.png") });
    await page.getByRole("button", { name: "Open setup guide", exact: true }).click();
    await expect(page.locator("#modalTitle")).toHaveText("ONBOARDING.md");
    await expect(
      page.getByRole("heading", { name: "Prerequisites Checklist", exact: true })
    ).toBeFocused();
    await page.getByRole("link", { name: "Architecture", exact: true }).click();
    await expect(page.locator("#modalTitle")).toHaveText("ARCHITECTURE.md");
    await page.locator("#previewBackBtn").click();
    await expect(page.locator("#modalTitle")).toHaveText("ONBOARDING.md");
    await page.keyboard.press("Escape");
    await expect(page.locator("#setupGuideBtn")).toBeFocused();
    await page.getByRole("button", { name: "Copy test command", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npm test");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });
}

test("root context and missing guide have useful setup guidance without a dead control", async ({
  page,
}) => {
  await showFixture(page, "", ["ARCHITECTURE.md"]);
  await expect(page.locator("#setupGuidance")).toContainText("monorepo", { timeout: 2000 });
  await expect(page.locator("#setupGuideBtn")).toBeHidden();
  await expect(page.locator("#setupFallback")).toContainText("README or contribution guide");
  await expect(page.locator("#quickstartCommands code")).toHaveText("npm test");
});
