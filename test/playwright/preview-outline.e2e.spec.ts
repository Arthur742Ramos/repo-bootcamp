import { expect, test, type Page } from "@playwright/test";
import { getIndexHtml } from "../../src/web/templates.js";
import { markdownToHtml } from "../../src/formatter.js";

async function mockDocuments(page: Page, documents: Record<string, string>) {
  await page.evaluate((names) => {
    for (const name of names) {
      const file = document.createElement("button");
      file.dataset.file = name;
      document.getElementById("files")!.append(file);
    }
  }, Object.keys(documents));
  await page.route("**/files/**", (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!);
    const content = documents[name];
    return route.fulfill({ json: { content, html: markdownToHtml(content) } });
  });
}

async function openFile(page: Page, name: string, fragment = "") {
  await page.evaluate(
    ({ name, fragment }) =>
      (
        window as unknown as { viewFile: (name: string, fragment: string) => Promise<void> }
      ).viewFile(name, fragment),
    { name, fragment }
  );
}

const longGuide = `# Onboarding\n\n[Hidden setup](#setup)\n\n${"Read the repository before changing it.\n\n".repeat(30)}
<details>
<summary>Advanced</summary>
<details>
<summary>Platform instructions</summary>

## Setup

Install the pinned toolchain.

</details>
</details>

## Validation

[Architecture](./ARCHITECTURE.md)
`;

test.beforeEach(async ({ page }) => {
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: getIndexHtml() })
  );
  await page.goto("http://bootcamp.test/");
  await page.evaluate("currentJobId = 'fixture'");
});

test("outline jumps into nested disclosures and keeps keyboard focus in the reader", async ({
  page,
}) => {
  await mockDocuments(page, { "ONBOARDING.md": longGuide, "ARCHITECTURE.md": "# Architecture" });
  await openFile(page, "ONBOARDING.md");
  const outline = page.getByRole("combobox", { name: "Jump to section" });
  await expect(outline.locator("option")).toHaveText([
    "Choose a section…",
    "Onboarding",
    "Setup",
    "Validation",
  ]);
  await outline.selectOption({ label: "Setup" });
  await expect(page.locator('[data-anchor="setup"]')).toBeFocused();
  await expect(page.locator('[data-anchor="setup"]')).toBeVisible();
  await expect(page.locator("#renderedContent details[open]")).toHaveCount(2);
  expect(await page.locator("#modal").evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Architecture", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeFocused();
  await page.screenshot({
    path: `test-results/preview-outline-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
});

test("same-file and cross-file fragment links reveal hidden destinations and synchronize the outline", async ({
  page,
}) => {
  await mockDocuments(page, {
    "ONBOARDING.md": longGuide,
    "START.md": "# Start\n\n[Setup guide](./ONBOARDING.md#setup)",
  });
  await openFile(page, "ONBOARDING.md");
  await page.getByRole("link", { name: "Hidden setup", exact: true }).click();
  await expect(page.locator('[data-anchor="setup"]')).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Jump to section" })).toHaveValue("1");
  await page.keyboard.press("Escape");
  await openFile(page, "START.md");
  await page.getByRole("link", { name: "Setup guide", exact: true }).click();
  await expect(page.locator('[data-anchor="setup"]')).toBeVisible();
  await expect(page.locator('[data-anchor="setup"]')).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Jump to section" })).toHaveValue("1");
});

test("outline navigates duplicate and international titles by position without inserting active HTML", async ({
  page,
}) => {
  const outgoing: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("evil.test")) outgoing.push(request.url());
  });
  await page.route("**/files/**", (route) =>
    route.fulfill({
      json: {
        content: "source",
        html: '<h1>Guide</h1><h2>Setup</h2><h2>Setup</h2><h2>環境設定 &amp; café</h2><h2>&lt;img src=x onerror=alert(1)&gt;</h2><h2><img src="https://evil.test/pixel"></h2><script><h2>Injected</h2></script>',
      },
    })
  );
  await openFile(page, "GUIDE.md");
  const outline = page.getByRole("combobox", { name: "Jump to section" });
  await expect(outline.locator("option")).toHaveText([
    "Choose a section…",
    "Guide",
    "Setup",
    "Setup",
    "環境設定 & café",
    "<img src=x onerror=alert(1)>",
    "Untitled section",
  ]);
  await outline.selectOption("2");
  await expect(page.locator("#renderedContent h2").nth(1)).toBeFocused();
  await outline.selectOption("3");
  await expect(page.locator("#renderedContent h2").nth(2)).toBeFocused();
  await expect(page.locator("#previewSection img, #previewSection script")).toHaveCount(0);
  expect(outgoing).toEqual([]);
});

test("Back restores the chosen section, expanded disclosures, focus and reading position", async ({
  page,
}) => {
  await mockDocuments(page, {
    "ONBOARDING.md": longGuide,
    "ARCHITECTURE.md": "# Architecture\n\n## Modules\n\nRead the module map.",
  });
  await openFile(page, "ONBOARDING.md");
  await page.getByRole("combobox", { name: "Jump to section" }).selectOption("1");
  const link = page.getByRole("link", { name: "Architecture", exact: true });
  await link.focus();
  const scroll = await page.locator("#modal").evaluate((el) => el.scrollTop);
  await link.click();
  await expect(page.locator("#renderedContent h1")).toHaveText("Architecture");
  await page.getByRole("button", { name: "Back to ONBOARDING.md", exact: true }).click();
  await expect(link).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Jump to section" })).toHaveValue("1");
  await expect(page.locator("#renderedContent details[open]")).toHaveCount(2);
  expect(await page.locator("#modal").evaluate((el) => el.scrollTop)).toBeCloseTo(scroll, 0);
});

test("Back restores the exact heading even when anchor text is empty or collides", async ({
  page,
}) => {
  await mockDocuments(page, {
    "GUIDE.md": "# Guide\n\n## Setup\n\n## Setup\n\n## Setup-1\n\n## 環境設定",
    "OTHER.md": "# Other guide",
  });
  for (const index of ["3", "4"]) {
    await openFile(page, "GUIDE.md");
    await page.getByRole("combobox", { name: "Jump to section" }).selectOption(index);
    const heading = page.locator("#renderedContent h2").nth(Number(index) - 1);
    await expect(heading).toBeFocused();
    await openFile(page, "OTHER.md");
    await page.getByRole("button", { name: "Back to GUIDE.md", exact: true }).click();
    await expect(heading).toBeFocused();
    await expect(page.getByRole("combobox", { name: "Jump to section" })).toHaveValue(index);
    await page.keyboard.press("Escape");
  }
});

test("outline hides in source mode and for documents with fewer than two headings", async ({
  page,
}) => {
  await mockDocuments(page, {
    "LONG.md": longGuide,
    "SHORT.md": "# Short",
    "PLAIN.md": "No headings.",
  });
  await openFile(page, "LONG.md");
  await page.getByRole("combobox", { name: "Jump to section" }).selectOption("2");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator("#previewOutline")).toBeHidden();
  expect(await page.locator("#modalContent").textContent()).toBe(longGuide);
  await page.getByRole("button", { name: "Rendered", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Jump to section" })).toHaveValue("2");
  for (const name of ["SHORT.md", "PLAIN.md"]) {
    await openFile(page, name);
    await expect(page.locator("#previewOutline")).toBeHidden();
  }
});

test("keyboard-only section selection focuses its heading and Escape returns to the trigger", async ({
  page,
}) => {
  await mockDocuments(page, { "GUIDE.md": longGuide });
  await page.getByRole("button", { name: "Analyze", exact: true }).focus();
  await openFile(page, "GUIDE.md");
  const outline = page.getByRole("combobox", { name: "Jump to section" });
  await outline.focus();
  await page.keyboard.press("v");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-anchor="validation"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeFocused();
  await expect(page.locator("#previewSection option")).toHaveCount(1);
});

test("outline clears while a new file is pending and stays hidden on failed or raw responses", async ({
  page,
}) => {
  await mockDocuments(page, { "GUIDE.md": longGuide });
  await openFile(page, "GUIDE.md");
  await page.unroute("**/files/**");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/files/**", async (route) => {
    await gate;
    return route.fulfill({ status: 503 });
  });
  await page.evaluate("void viewFile('FAILED.md')");
  await expect(page.locator("#modalContent")).toHaveText("Loading…");
  await expect(page.locator("#previewOutline")).toBeHidden();
  await expect(page.locator("#previewSection option")).toHaveCount(1);
  release();
  await expect(page.locator("#retryPreviewBtn")).toBeVisible();
  await expect(page.locator("#previewOutline")).toBeHidden();
  await page.unroute("**/files/**");
  await page.route("**/files/**", (route) =>
    route.fulfill({ json: { content: '{"ok":true}', html: null } })
  );
  await openFile(page, "DATA.json");
  await expect(page.locator("#previewOutline")).toBeHidden();
});

test("fragment links distinguish suffix collisions and reach Unicode headings", async ({
  page,
}) => {
  await mockDocuments(page, {
    "GUIDE.md":
      "# Guide\n\n[Suffix](#setup-1-1) [Unicode](#%E7%92%B0%E5%A2%83%E8%A8%AD%E5%AE%9A)\n\n## Setup\n\n## Setup\n\n## Setup-1\n\n## 環境設定",
  });
  await openFile(page, "GUIDE.md");
  const anchors = await page
    .locator("#renderedContent [data-anchor]")
    .evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.anchor));
  expect(anchors).toEqual(["guide", "setup", "setup-1", "setup-1-1", "環境設定"]);
  await page.getByRole("link", { name: "Suffix", exact: true }).click();
  await expect(page.locator('[data-anchor="setup-1-1"]')).toBeFocused();
  await page.getByRole("link", { name: "Unicode", exact: true }).click();
  await expect(page.locator('[data-anchor="環境設定"]')).toBeFocused();
});

test("heading anchors use sanitized visible text and ignore supplied IDs", async ({ page }) => {
  await page.route("**/files/**", (route) =>
    route.fulfill({
      json: {
        content: "source",
        html: '<a href="#setup">Setup</a><h2 id="mainContent"><script>hidden</script>Setup</h2>',
      },
    })
  );
  await openFile(page, "GUIDE.md");
  await expect(page.locator("#renderedContent h2")).toHaveAttribute("data-anchor", "setup");
  await expect(page.locator("#renderedContent [id], #renderedContent script")).toHaveCount(0);
  await page.getByRole("link", { name: "Setup", exact: true }).click();
  await expect(page.locator("#renderedContent h2")).toBeFocused();
});
