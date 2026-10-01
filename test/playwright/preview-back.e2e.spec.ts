import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { getIndexHtml } from "../../src/web/templates.js";
import { markdownToHtml } from "../../src/formatter.js";

async function addFiles(page: Page, names: string[]) {
  await page.evaluate((filenames) => {
    document.getElementById("results")!.classList.add("show");
    for (const filename of filenames) {
      const button = document.createElement("button");
      button.dataset.file = filename;
      button.textContent = filename;
      button.addEventListener("click", () => {
        void (window as unknown as { viewFile: (name: string) => Promise<void> }).viewFile(
          filename
        );
      });
      document.getElementById("files")!.append(button);
    }
  }, names);
}

async function mockDocuments(page: Page, documents: Record<string, string>) {
  await addFiles(page, Object.keys(documents));
  await page.route("**/files/**", (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!);
    const content = documents[name];
    return route.fulfill({ json: { content, html: markdownToHtml(content) } });
  });
}

async function openFile(page: Page, name: string) {
  await page.evaluate(
    (filename) =>
      (window as unknown as { viewFile: (name: string) => Promise<void> }).viewFile(filename),
    name
  );
}

const paragraphs = (count: number) =>
  Array.from({ length: count }, (_, i) => `Reading paragraph ${i}.`).join("\n\n");
const backTo = (page: Page, name: string) =>
  page.getByRole("button", { name: `Back to ${name}`, exact: true });

test.beforeEach(async ({ page }) => {
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: getIndexHtml() })
  );
  await page.goto("http://bootcamp.test/");
  await page.evaluate("currentJobId = 'fixture'");
});

test("Back resumes a three-document reading path and restores the original keyboard trigger", async ({
  page,
}) => {
  await mockDocuments(page, {
    "A.md": `# First guide\n\n[Chapter](#chapter)\n\n${paragraphs(20)}\n\n## Chapter\n\n[Second guide](./B.md#setup)\n\n${paragraphs(30)}`,
    "B.md": `# Second guide\n\n${paragraphs(20)}\n\n## Setup\n\n[Third guide](./C.md)\n\n${paragraphs(30)}`,
    "C.md": "# Third guide\n\nRead the architecture, then return to your task.",
  });
  await page.getByRole("button", { name: "A.md", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: "Chapter", exact: true }).click();
  await expect(page.locator('[data-anchor="chapter"]')).toBeFocused();
  const firstScroll = await page.locator("#modal").evaluate((el) => el.scrollTop);
  expect(firstScroll).toBeGreaterThan(100);
  await page.getByRole("link", { name: "Second guide", exact: true }).click();
  await expect(page.locator('[data-anchor="setup"]')).toBeFocused();
  const secondScroll = await page.locator("#modal").evaluate((el) => el.scrollTop);
  await page.getByRole("link", { name: "Third guide", exact: true }).click();
  await expect(page.locator("#renderedContent h1")).toHaveText("Third guide");
  await expect(backTo(page, "B.md")).toBeVisible({ timeout: 1000 });
  await backTo(page, "B.md").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "Third guide", exact: true })).toBeFocused();
  expect(await page.locator("#modal").evaluate((el) => el.scrollTop)).toBeCloseTo(secondScroll, 0);
  await backTo(page, "A.md").click();
  await expect(page.getByRole("link", { name: "Second guide", exact: true })).toBeFocused();
  expect(await page.locator("#modal").evaluate((el) => el.scrollTop)).toBeCloseTo(firstScroll, 0);
  await expect(page.locator("#previewBackBtn")).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(page.locator("#copyBtn")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: "Second guide", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "A.md", exact: true })).toBeFocused();
});

test("Back restores source mode, scroll and the exact copied/downloaded file", async ({ page }) => {
  const source = `# Original source\n\n${paragraphs(60)}`;
  await mockDocuments(page, { "A.md": source, "B.md": "# Other document" });
  await openFile(page, "A.md");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const scroll = await page.locator("#modal").evaluate((el) => {
    el.scrollTop = 120;
    return el.scrollTop;
  });
  expect(scroll).toBeGreaterThan(0);
  await openFile(page, "B.md");
  await expect(backTo(page, "A.md")).toBeVisible({ timeout: 1000 });
  await backTo(page, "A.md").click();
  await expect(page.locator("#sourceBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#modalContent")).toBeFocused();
  expect(await page.locator("#modalContent").textContent()).toBe(source);
  expect(await page.locator("#modal").evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copiedSource: string }).copiedSource = text;
        },
      },
    });
  });
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  expect(await page.evaluate("window.copiedSource")).toBe(source);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("A.md");
  expect(await readFile((await download.path())!, "utf8")).toBe(source);
});

test("failed destinations allow Back and retries do not duplicate history", async ({ page }) => {
  let attempts = 0;
  await addFiles(page, ["A.md", "B.md"]);
  await page.route("**/files/**", (route) => {
    if (route.request().url().includes("B.md") && ++attempts < 3)
      return route.fulfill({ status: 503 });
    const content = route.request().url().includes("B.md")
      ? "# Recovered B"
      : "# First guide\n\n[Next](./B.md)";
    return route.fulfill({ json: { content, html: markdownToHtml(content) } });
  });
  await openFile(page, "A.md");
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await expect(page.locator("#retryPreviewBtn")).toBeVisible();
  await expect(backTo(page, "A.md")).toBeVisible({ timeout: 1000 });
  await expect(page.locator("#copyBtn")).toBeDisabled();
  await expect(page.locator("#downloadBtn")).toBeDisabled();
  await backTo(page, "A.md").click();
  await expect(page.getByRole("link", { name: "Next", exact: true })).toBeFocused();
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await expect(page.locator("#retryPreviewBtn")).toBeVisible();
  await page.getByRole("button", { name: "Retry preview", exact: true }).click();
  await expect(page.locator("#renderedContent h1")).toHaveText("Recovered B");
  await backTo(page, "A.md").click();
  await expect(page.locator("#renderedContent h1")).toHaveText("First guide");
  await expect(page.locator("#previewBackBtn")).toBeHidden();
  expect(attempts).toBe(3);
});

for (const lateResponse of ["success", "failure"] as const) {
  test(`Back cancels a delayed preview and ignores its late ${lateResponse}`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested!: () => void;
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    await addFiles(page, ["A.md", "B.md"]);
    await page.route("**/files/**", async (route) => {
      if (route.request().url().includes("B.md")) {
        requested();
        await gate;
        await route
          .fulfill(
            lateResponse === "failure"
              ? { status: 503 }
              : { json: { content: "Stale B", html: "<h1>Stale B</h1>" } }
          )
          .catch(() => {});
      } else await route.fulfill({ json: { content: "Original A", html: "<h1>Original A</h1>" } });
    });
    await openFile(page, "A.md");
    await page.evaluate(`
      const originalFetch = window.fetch;
      window.fetch = (url, options) => {
        if (String(url).includes('B.md')) {
          options.signal.addEventListener('abort', () => { window.previewAborted = true; });
          return originalFetch(url, { ...options, signal: undefined });
        }
        return originalFetch(url, options);
      };
      window.delayedPreview = viewFile('B.md');
      void 0;
    `);
    await started;
    await expect(page.locator("#copyBtn")).toBeDisabled();
    await expect(backTo(page, "A.md")).toBeVisible({ timeout: 1000 });
    await backTo(page, "A.md").click();
    await expect(page.locator("#renderedContent h1")).toHaveText("Original A");
    release();
    await page.evaluate("window.delayedPreview");
    expect(await page.evaluate("window.previewAborted")).toBe(true);
    await expect(page.locator("#modalTitle")).toHaveText("A.md");
    await expect(page.locator("#renderedContent h1")).toHaveText("Original A");
    await expect(page.locator("#retryPreviewBtn")).toBeHidden();
    await expect(page.locator("#copyBtn")).toBeEnabled();
    expect(await page.evaluate("currentFile.content")).toBe("Original A");
  });
}

test("retrying a failed Back request preserves its source reading context", async ({ page }) => {
  let firstRequests = 0;
  const source = `# First guide\n\n${paragraphs(60)}`;
  await addFiles(page, ["A.md", "B.md"]);
  await page.route("**/files/**", (route) => {
    const first = route.request().url().includes("A.md");
    if (first && ++firstRequests === 2) return route.fulfill({ status: 503 });
    const content = first ? source : "# Second guide";
    return route.fulfill({ json: { content, html: markdownToHtml(content) } });
  });
  await openFile(page, "A.md");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const scroll = await page.locator("#modal").evaluate((el) => {
    el.scrollTop = 150;
    return el.scrollTop;
  });
  expect(scroll).toBeGreaterThan(0);
  await openFile(page, "B.md");
  await expect(backTo(page, "A.md")).toBeVisible({ timeout: 1000 });
  await backTo(page, "A.md").click();
  await expect(page.locator("#retryPreviewBtn")).toBeVisible();
  await expect(page.locator("#copyBtn")).toBeDisabled();
  await page.getByRole("button", { name: "Retry preview", exact: true }).click();
  await expect(page.locator("#sourceBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#modalContent")).toBeFocused();
  expect(await page.locator("#modal").evaluate((el) => el.scrollTop)).toBe(scroll);
  await expect(page.locator("#previewBackBtn")).toBeHidden();
  expect(firstRequests).toBe(3);
});

test("preview history is bounded and resets on close or a new analysis", async ({ page }) => {
  const names = Array.from({ length: 23 }, (_, i) => `FILE-${i}.md`);
  await mockDocuments(page, Object.fromEntries(names.map((name) => [name, `# ${name}`])));
  for (const name of names) await openFile(page, name);
  await expect(backTo(page, "FILE-21.md")).toBeVisible({ timeout: 1000 });
  for (let i = 21; i >= 2; i--) {
    await backTo(page, `FILE-${i}.md`).click();
    await expect(page.locator("#renderedContent h1")).toHaveText(`FILE-${i}.md`);
  }
  await expect(page.locator("#previewBackBtn")).toBeHidden();
  await page.keyboard.press("Escape");
  await openFile(page, "FILE-0.md");
  await expect(page.locator("#previewBackBtn")).toBeHidden();
  await openFile(page, "FILE-1.md");
  await expect(backTo(page, "FILE-0.md")).toBeVisible();
  await page.evaluate("beginRun(); currentJobId = 'new-analysis'");
  await expect(page.locator("#modal")).toBeHidden();
  await openFile(page, "FILE-2.md");
  await expect(page.locator("#previewBackBtn")).toBeHidden();
});
