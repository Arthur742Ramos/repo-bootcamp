import { expect, test, type Page } from "@playwright/test";
import { getIndexHtml } from "../../src/web/templates.js";

test.beforeEach(async ({ page }) => {
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: getIndexHtml() })
  );
  await page.goto("http://bootcamp.test/");
  await page.evaluate(`
    currentJobId = 'owned-focus';
    document.getElementById('results').classList.add('show');
    const button = document.createElement('button');
    button.textContent = 'Preview ONBOARDING.md';
    button.dataset.file = 'ONBOARDING.md';
    button.addEventListener('click', () => { window.ownedPreview = viewFile('ONBOARDING.md'); });
    document.getElementById('files').append(button);
  `);
});

async function delayedPreview(page: Page, html: string | null) {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/files/**", async (route) => {
    started();
    await gate;
    await route.fulfill({
      json: { content: "# Owned onboarding\n\n## Setup\n\nInstall dependencies.", html },
    });
  });
  await page.getByRole("button", { name: "Preview ONBOARDING.md", exact: true }).focus();
  await page.keyboard.press("Enter");
  await request;
  await expect(page.locator("#closeBtn")).toBeFocused();
  return release;
}

async function expectVisibleDialogFocus(page: Page) {
  expect(
    await page.evaluate(() => {
      const active = document.activeElement;
      return Boolean(
        active &&
        document.getElementById("modal")?.contains(active) &&
        active.getClientRects().length
      );
    })
  ).toBe(true);
}

for (const width of [1440, 320]) {
  test(`loading Markdown retains visible keyboard focus and traps both Tab directions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 1000 });
    const release = await delayedPreview(
      page,
      "<h1>Owned onboarding</h1><h2>Setup</h2><p>Install dependencies.</p>"
    );
    await page.keyboard.press("Tab");
    await expect(page.locator("#modalContent")).toBeFocused();
    release();
    await expect(page.locator("#renderedContent h1")).toHaveText("Owned onboarding");
    await page.screenshot({ path: test.info().outputPath("reader-transition.png") });
    await expect(page.locator("#renderedContent")).toBeFocused();
    await expect(page.locator(".skip-link")).toHaveAttribute("inert", "");
    for (const key of ["Tab", "Shift+Tab"] as const) {
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press(key);
        await expectVisibleDialogFocus(page);
      }
    }
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Preview ONBOARDING.md", exact: true })
    ).toBeFocused();
    await expect(page.locator(".skip-link")).not.toHaveAttribute("inert", "");
  });
}

test("a focused visible control is not replaced by document focus when loading completes", async ({
  page,
}) => {
  const release = await delayedPreview(page, "<h1>Owned onboarding</h1><h2>Setup</h2>");
  release();
  await expect(page.locator("#renderedContent h1")).toHaveText("Owned onboarding");
  await expect(page.locator("#closeBtn")).toBeFocused();
});

test("source-only output keeps the loading surface focused", async ({ page }) => {
  const release = await delayedPreview(page, null);
  await page.keyboard.press("Tab");
  await expect(page.locator("#modalContent")).toBeFocused();
  release();
  await expect(page.locator("#modalContent")).toContainText("Install dependencies.");
  await expect(page.locator("#modalContent")).toBeFocused();
  await expect(page.locator("#renderedContent")).toBeHidden();
});

test("view transitions move only focus that would become hidden", async ({ page }) => {
  const release = await delayedPreview(page, "<h1>Owned onboarding</h1><h2>Setup</h2>");
  release();
  await expect(page.locator("#renderedContent h1")).toBeVisible();
  await page.locator("#renderedContent h2").focus();
  await page.evaluate("setPreviewMode(false)");
  await expect(page.locator("#modalContent")).toBeFocused();
  await page.evaluate("setPreviewMode(true)");
  await expect(page.locator("#renderedContent")).toBeFocused();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.getByRole("button", { name: "Source", exact: true })).toBeFocused();
});

test("closing before response completion leaves the original trigger focused", async ({ page }) => {
  const release = await delayedPreview(page, "<h1>Obsolete document</h1>");
  await page.keyboard.press("Escape");
  release();
  await page.evaluate("window.ownedPreview");
  await expect(page.locator("#modal")).not.toHaveClass(/show/);
  await expect(
    page.getByRole("button", { name: "Preview ONBOARDING.md", exact: true })
  ).toBeFocused();
});

test("failure and retry retain visible focus through the next delayed response", async ({
  page,
}) => {
  await page.route("**/files/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Owned temporary failure" } })
  );
  await page.getByRole("button", { name: "Preview ONBOARDING.md", exact: true }).click();
  await expect(page.locator("#modalContent")).toContainText("Couldn't load");
  await page.locator("#modalContent").focus();
  await expectVisibleDialogFocus(page);
  await page.unroute("**/files/**");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/files/**", async (route) => {
    await gate;
    await route.fulfill({ json: { content: "# Recovered", html: "<h1>Recovered</h1>" } });
  });
  await page.getByRole("button", { name: "Retry preview", exact: true }).click();
  await expect(page.locator("#closeBtn")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#modalContent")).toBeFocused();
  release();
  await expect(page.locator("#renderedContent h1")).toHaveText("Recovered");
  await expect(page.locator("#renderedContent")).toBeFocused();
});
