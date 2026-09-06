import { expect, test } from "@playwright/test";
import { getIndexHtml } from "../../src/web/templates.js";
import { markdownToHtml } from "../../src/formatter.js";

test.beforeEach(async ({ page }) => {
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: getIndexHtml() })
  );
  await page.goto("http://bootcamp.test/");
  await page.evaluate("currentJobId = 'fixture'");
});

test("renders Markdown safely and keeps exact source available", async ({ page }) => {
  const source =
    '# Reading guide\n\n**Start here** with `npm test`.\n\n| Task | Command |\n| --- | --- |\n| Test | npm test |\n\n<script>window.pwned = true</script>\n<img src="https://evil.test/pixel" onerror="window.pwned=true">\n<a href="javascript:alert(1)" onclick="alert(1)">Unsafe</a>\n\n[Docs](https://example.com)';
  const outgoing: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("evil.test")) outgoing.push(request.url());
  });
  await page.route("**/files/**", (route) =>
    route.fulfill({ json: { content: source, html: markdownToHtml(source) } })
  );
  await page.evaluate("viewFile('GUIDE.md')");
  await expect(page.locator("#renderedContent h1")).toHaveText("Reading guide");
  await expect(page.locator("#renderedContent table")).toBeVisible();
  await expect(
    page.locator(
      '#renderedContent script, #renderedContent img, #renderedContent [onclick], #renderedContent [href^="javascript:"]'
    )
  ).toHaveCount(0);
  await expect(page.locator('#renderedContent a[href="https://example.com"]')).toHaveAttribute(
    "rel",
    "noopener noreferrer"
  );
  expect(await page.evaluate("window.pwned")).toBeUndefined();
  expect(outgoing).toEqual([]);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator("#modalContent")).toBeVisible();
  expect(await page.locator("#modalContent").textContent()).toBe(source);
  await page.getByRole("button", { name: "Rendered", exact: true }).click();
  await expect(page.locator("#modalContent")).toBeHidden();
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  await page.screenshot({
    path: `test-results/preview-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("closing a delayed preview prevents stale content from replacing the next file", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route("**/files/**", async (route) => {
    if (route.request().url().includes("SLOW.md")) {
      requested();
      await gate;
      await route
        .fulfill({ json: { content: "Old content", html: "<h1>Old content</h1>" } })
        .catch(() => {});
    } else {
      await route.fulfill({ json: { content: "New content", html: "<h1>New content</h1>" } });
    }
  });
  // Simulate a transport that has already buffered its response and cannot
  // honour cancellation. Assert both the abort signal and the stale-result guard.
  await page.evaluate(`
    const originalFetch = window.fetch;
    window.fetch = (url, options) => {
      if (String(url).includes('SLOW.md')) {
        options.signal.addEventListener('abort', () => { window.previewAborted = true; });
        return originalFetch(url, { ...options, signal: undefined });
      }
      return originalFetch(url, options);
    };
    window.slowPreview = viewFile('SLOW.md');
    void 0;
  `);
  await started;
  await expect(page.locator("#copyBtn")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.evaluate("void viewFile('NEW.md')");
  await expect(page.locator("#renderedContent")).toHaveText("New content");
  release();
  await page.evaluate("window.slowPreview");
  expect(await page.evaluate("window.previewAborted")).toBe(true);
  await expect(page.locator("#modalTitle")).toHaveText("NEW.md");
  await expect(page.locator("#renderedContent")).toHaveText("New content");
  expect(await page.evaluate("currentFile.name")).toBe("NEW.md");
});

test("failed loads disable actions and a subsequent preview recovers", async ({ page }) => {
  await page.route("**/files/**", (route) =>
    route.fulfill({ status: 500, json: { error: "unavailable" } })
  );
  await page.evaluate("viewFile('BROKEN.md')");
  await expect(page.locator("#modalContent")).toContainText("Couldn't load BROKEN.md");
  await expect(page.locator("#copyBtn")).toBeDisabled();
  await expect(page.locator("#downloadBtn")).toBeDisabled();
  await expect(page.locator("#previewControls")).toBeHidden();
  await page.keyboard.press("Escape");
  await page.unroute("**/files/**");
  await page.route("**/files/**", (route) =>
    route.fulfill({ json: { content: '{"ok":true}', html: null } })
  );
  await page.evaluate("viewFile('facts.json')");
  await expect(page.locator("#modalContent")).toHaveText('{"ok":true}');
  await expect(page.locator("#copyBtn")).toBeEnabled();
  await expect(page.locator("#previewControls")).toBeHidden();
});

test("links between generated files preserve the original keyboard trigger", async ({ page }) => {
  await page.evaluate(() => {
    const files = document.getElementById("files")!;
    document.getElementById("results")!.classList.add("show");
    for (const name of ["ONE.md", "TWO.md"]) {
      const button = document.createElement("button");
      button.dataset.file = name;
      button.textContent = name;
      button.addEventListener("click", () => {
        void (window as unknown as { viewFile: (name: string) => Promise<void> }).viewFile(name);
      });
      files.append(button);
    }
  });
  await page.route("**/files/**", (route) =>
    route.fulfill({
      json: {
        content: "Guide",
        html: route.request().url().includes("ONE.md")
          ? '<a href="./TWO.md">Next guide</a>'
          : "<h1>Second guide</h1>",
      },
    })
  );
  await page.getByRole("button", { name: "ONE.md", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: "Next guide" }).click();
  await expect(page.locator("#renderedContent h1")).toHaveText("Second guide");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "ONE.md", exact: true })).toBeFocused();
});

test("table of contents links focus headings and diagrams retain readable source", async ({
  page,
}) => {
  const source =
    "# Guide\n\n[Setup](#setup)\n\n## Setup\n\n```mermaid\nflowchart TD\n  A --> B\n```";
  await page.route("**/files/**", (route) =>
    route.fulfill({ json: { content: source, html: markdownToHtml(source) } })
  );
  await page.evaluate("viewFile('GUIDE.md')");
  await page.getByRole("link", { name: "Setup" }).click();
  await expect(page.locator("#renderedContent h2")).toBeFocused();
  await expect(page.locator("#renderedContent pre")).toContainText("flowchart TD\n  A --> B");
});
