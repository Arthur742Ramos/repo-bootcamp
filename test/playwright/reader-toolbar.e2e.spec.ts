import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { getIndexHtml } from "../../src/web/templates.js";
import { markdownToHtml } from "../../src/formatter.js";

const guide = `# Setup guide\n\n${"Read the setup notes before editing files.\n\n".repeat(30)}## Validation\n\n\`\`\`sh\nnpm test\n\`\`\`\n\n${"Review the repository conventions.\n\n".repeat(30)}## First change\n\nAdd a route test.`;
const docs: Record<string, string> = {
  "BOOTCAMP.md": "# Overview\n\n[Validation instructions](./ONBOARDING.md#validation)",
  "ONBOARDING.md": guide,
};

test.beforeEach(async ({ page }) => {
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: getIndexHtml("fixture-nonce"),
      headers: {
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'nonce-fixture-nonce'; style-src 'self' 'nonce-fixture-nonce'; style-src-attr 'none'",
      },
    })
  );
  await page.goto("http://bootcamp.test/");
  await page.evaluate((names) => {
    for (const name of names) {
      const button = document.createElement("button");
      button.dataset.file = name;
      button.textContent = name;
      document.getElementById("files")!.append(button);
    }
  }, Object.keys(docs));
  await page.evaluate("currentJobId = 'fixture'");
  await page.route("**/files/**", (route) => {
    const filename = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!);
    const content = docs[filename];
    return route.fulfill({ json: { content, html: markdownToHtml(content) } });
  });
});

async function openOverview(page: Page) {
  await page.evaluate("viewFile('BOOTCAMP.md')");
  await expect(page.locator("#renderedContent h1")).toHaveText("Overview");
}

async function expectReaderControls(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ids = [
          "closeBtn",
          "copyBtn",
          "downloadBtn",
          "sourceBtn",
          "previewSection",
          "previewBackBtn",
        ];
        return ids.every((id) => {
          const element = document.getElementById(id)!;
          if (element.hidden || element.offsetParent === null) return true;
          const rect = element.getBoundingClientRect();
          return (
            rect.top >= 0 &&
            rect.bottom <= innerHeight &&
            rect.left >= 0 &&
            rect.right <= innerWidth
          );
        });
      })
    )
    .toBe(true);
  expect(await page.locator("#modal").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true
  );
  await expect(page.locator("#modal [style], #modal[style]")).toHaveCount(0);
}

async function expectHeadingBelowControls(page: Page, anchor: string) {
  await expect(page.locator(`[data-anchor="${anchor}"]`)).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate((value) => {
        const toolbar = document.getElementById("previewToolbar")!.getBoundingClientRect();
        const heading = document.querySelector(`[data-anchor="${value}"]`)!.getBoundingClientRect();
        return heading.top >= toolbar.bottom && heading.bottom <= innerHeight;
      }, anchor)
    )
    .toBe(true);
}

test("deep links keep controls available, reveal the target below them, and preserve Back", async ({
  page,
}) => {
  await openOverview(page);
  await page.getByRole("link", { name: "Validation instructions", exact: true }).click();
  await expect(page.locator('[data-anchor="validation"]')).toBeFocused();
  await expectReaderControls(page);
  await expectHeadingBelowControls(page, "validation");
  await page
    .getByRole("combobox", { name: "Jump to section" })
    .selectOption({ label: "First change" });
  await expect(page.locator('[data-anchor="first-change"]')).toBeFocused();
  await expectReaderControls(page);
  await expectHeadingBelowControls(page, "first-change");
  await page.getByRole("button", { name: "Back to BOOTCAMP.md", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Validation instructions", exact: true })
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal")).toBeHidden();
});

test("source reading retains exact Copy and Download output after scrolling", async ({ page }) => {
  await openOverview(page);
  await page.getByRole("link", { name: "Validation instructions", exact: true }).click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator("#modalContent")).toHaveText(guide);
  await page.locator("#modal").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expectReaderControls(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
    })
  );
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { copied: string }).copied))
    .toBe(guide);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("ONBOARDING.md");
  expect(await readFile((await download.path())!, "utf8")).toBe(guide);
  await page.getByRole("button", { name: "Rendered", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Jump to section" })
    .selectOption({ label: "Validation" });
  await expectHeadingBelowControls(page, "validation");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("region", { name: "Code block", exact: true })).toBeFocused();
  await expectReaderControls(page);
});

test("short landscape keeps reading space and visible heading navigation", async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await openOverview(page);
  await page.getByRole("link", { name: "Validation instructions", exact: true }).click();
  await expectReaderControls(page);
  await expectHeadingBelowControls(page, "validation");
  expect(
    await page
      .locator("#previewToolbar")
      .evaluate((el) => innerHeight - el.getBoundingClientRect().bottom)
  ).toBeGreaterThan(150);
});

test("enlarged text updates the toolbar offset without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await openOverview(page);
  await page.getByRole("link", { name: "Validation instructions", exact: true }).click();
  await expectReaderControls(page);
  await expectHeadingBelowControls(page, "validation");
});

test("toolbar measurements replace one authorized CSS rule across mode and viewport changes", async ({
  page,
}) => {
  await openOverview(page);
  await page.getByRole("link", { name: "Validation instructions", exact: true }).click();
  await expectHeadingBelowControls(page, "validation");
  const initialRules = await page.evaluate(
    () => document.querySelector("style")!.sheet!.cssRules.length
  );
  for (const width of [740, 412, 1024, 568]) {
    await page.setViewportSize({ width, height: 360 });
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByRole("button", { name: "Rendered", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Jump to section" })
      .selectOption({ label: "Validation" });
    await expectHeadingBelowControls(page, "validation");
    await expectReaderControls(page);
  }
  expect(await page.evaluate(() => document.querySelector("style")!.sheet!.cssRules.length)).toBe(
    initialRules
  );
});
