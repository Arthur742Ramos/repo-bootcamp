import { expect, test, type Page } from "@playwright/test";
import { getIndexHtml } from "../../src/web/templates.js";
import { markdownToHtml } from "../../src/formatter.js";

const match = {
  filename: "GUIDE.md",
  line: 3,
  heading: "Setup",
  fragment: "setup",
  snippet: "<img src=x onerror=alert(1)> install npm",
};
async function ready(page: Page) {
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: getIndexHtml() })
  );
  await page.goto("http://bootcamp.test/");
  await page.evaluate(
    "currentJobId = 'fixture'; latestResult = {files: ['GUIDE.md', 'OTHER.md']}; document.getElementById('results').classList.add('show'); for (const name of latestResult.files) { const button = document.createElement('button'); button.dataset.file = name; document.getElementById('files').append(button); }"
  );
  await page.route("**/files/**", (route) =>
    route.fulfill({
      json: {
        content: "# Guide\n## Setup\ninstall npm\n[Other](./OTHER.md)",
        html: markdownToHtml("# Guide\n## Setup\ninstall npm\n[Other](./OTHER.md)"),
      },
    })
  );
}
async function search(page: Page, query = "install") {
  await page.getByRole("searchbox", { name: "Search kit contents" }).fill(query);
  await page.getByRole("button", { name: "Search kit", exact: true }).click();
}
test.beforeEach(async ({ page }) => ready(page));

test("search shows inert snippets, opens the heading, and preserves results through reader Back and Close", async ({
  page,
}) => {
  await page.route("**/search?**", (route) =>
    route.fulfill({
      json: { matches: [match], searchedFiles: 2, skippedFiles: 0, truncated: false },
    })
  );
  await search(page);
  await expect(page.locator("#kitSearchStatus")).toHaveText("1 matching line in 2 searched files.");
  await expect(page.locator("#kitSearchResults img")).toHaveCount(0);
  await expect(page.locator("#kitSearchResults")).toContainText(match.snippet);
  await page.getByRole("button", { name: "GUIDE.md · line 3 · Setup" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-anchor="setup"]')).toBeFocused();
  await page.getByRole("link", { name: "Other", exact: true }).click();
  await page.getByRole("button", { name: "Back to GUIDE.md", exact: true }).click();
  await expect(page.locator("#modalTitle")).toHaveText("GUIDE.md");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "GUIDE.md · line 3 · Setup" })).toBeFocused();
  await expect(page.locator("#kitSearchResults li")).toHaveCount(1);
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  await page.screenshot({
    path: `test-results/kit-search-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("reports incomplete coverage, empty results, failure and retry", async ({ page }) => {
  let calls = 0;
  await page.route("**/search?**", (route) => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 500, json: { error: "Search unavailable" } });
    return route.fulfill({
      json: { matches: [], searchedFiles: 1, skippedFiles: 2, truncated: false },
    });
  });
  await search(page);
  await expect(page.locator("#kitSearchStatus")).toHaveText("Search unavailable");
  await page.getByRole("button", { name: "Retry search" }).click();
  await expect(page.locator("#kitSearchStatus")).toHaveText(
    "No matches in 1 searched file. 2 files skipped (unsupported, unavailable, or search limits)."
  );
  await expect(page.getByRole("button", { name: "Retry search" })).toBeHidden();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search kit contents" })).toHaveValue("");
  await expect(page.getByRole("searchbox", { name: "Search kit contents" })).toBeFocused();
});

test("late responses cannot restore old query or old analysis results even when abort is ignored", async ({
  page,
}) => {
  await page.evaluate(
    `window.fetch = () => new Promise(resolve => { window.finishSearch = () => resolve({ok: true, json: async () => ({matches: [${JSON.stringify(match)}], searchedFiles: 1, skippedFiles: 0})}); })`
  );
  await search(page);
  await expect(page.locator("#kitSearchStatus")).toHaveText("Searching kit…");
  await page.getByRole("searchbox", { name: "Search kit contents" }).fill("new query");
  await page.evaluate("window.finishSearch()");
  await expect(page.locator("#kitSearchResults li")).toHaveCount(0);
  await expect(page.locator("#kitSearchStatus")).toHaveText("");
  await search(page);
  await page.evaluate("beginRun(); currentJobId = 'new-job'; window.finishSearch()");
  await expect(page.locator("#kitSearchResults li")).toHaveCount(0);
  await expect(page.locator("#kitSearchStatus")).toHaveText("");
});

test("a newer search owns completion when older JSON parsing finishes later", async ({ page }) => {
  await page.evaluate(
    'let count = 0; window.fetch = async () => { count++; if (count === 1) return {ok: true, json: () => new Promise(resolve => { window.finishJson = () => resolve({matches: [{filename: "GUIDE.md", line: 1, heading: "Old", fragment: "old", snippet: "obsolete"}], searchedFiles: 1, skippedFiles: 0}); })}; return {ok: true, json: async () => ({matches: [], searchedFiles: 2, skippedFiles: 0})}; }'
  );
  await search(page, "old");
  await expect.poll(() => page.evaluate("typeof window.finishJson")).toBe("function");
  await search(page, "new");
  await expect(page.locator("#kitSearchStatus")).toHaveText("No matches in 2 searched files.");
  await page.evaluate("window.finishJson()");
  await expect(page.locator("#kitSearchStatus")).toHaveText("No matches in 2 searched files.");
  await expect(page.locator("#kitSearchResults li")).toHaveCount(0);
});

test("rejects non-inventory result navigation and reports limits", async ({ page }) => {
  let valid = false;
  await page.route("**/search?**", (route) =>
    route.fulfill({
      json: {
        matches: [{ ...match, filename: valid ? "GUIDE.md" : "outside.md" }],
        searchedFiles: 1,
        skippedFiles: 0,
        truncated: true,
      },
    })
  );
  await search(page);
  await expect(page.locator("#kitSearchStatus")).toHaveText(
    "The server returned invalid search results."
  );
  await expect(page.locator("#kitSearchResults li")).toHaveCount(0);
  valid = true;
  await page.getByRole("button", { name: "Retry search" }).click();
  await expect(page.locator("#kitSearchStatus")).toContainText("narrow your search");
});
