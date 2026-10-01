import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { generateFirstTasks } from "../../src/generator.js";
import { markdownToHtml } from "../../src/formatter.js";
import { getIndexHtml } from "../../src/web/templates.js";
import type { RepoFacts } from "../../src/types.js";

type RepoTask = RepoFacts["firstTasks"][number];

const facts: RepoFacts = JSON.parse(
  readFileSync(new URL("../../examples/ky/repo_facts.json", import.meta.url), "utf8")
);
const tasks: RepoTask[] = [
  {
    title: "Configure **retry** behavior",
    difficulty: "advanced",
    category: "feature",
    files: ["src/server.ts"],
    description: "Implement retry configuration.",
    why: "Recover interrupted requests.",
  },
  {
    title: "Verify request errors",
    difficulty: "beginner",
    category: "test",
    files: ["test/request.ts"],
    description: "Test request errors.",
    why: "Catch request regressions.",
  },
  {
    title: "Write setup notes",
    difficulty: "beginner",
    category: "docs",
    files: ["README.md"],
    description: "Document setup steps.",
    why: "Help new contributors.",
  },
];
const source = generateFirstTasks({ ...facts, firstTasks: tasks }, { audience: "backend" });
const recommendations = tasks.map((task, index) => ({ ...task, taskNumber: [3, 1, 2][index] }));

async function showRecommendations(
  page: Page,
  picks = recommendations,
  files = ["FIRST_TASKS.md", "ARCHITECTURE.md"]
) {
  await page.evaluate(
    ({ recommendations, files }) => {
      (window as unknown as { showResults: (data: unknown) => void }).showResults({
        recommendations,
        files,
        stats: { securityScore: 85, riskScore: 18, dependencies: 3, durationMs: 12000 },
      });
    },
    { recommendations: picks, files }
  );
}

async function mockDocuments(page: Page, firstTasks = source) {
  await page.route("**/files/**", (route) => {
    const content = route.request().url().includes("FIRST_TASKS.md")
      ? firstTasks
      : "# Architecture\n\nRequest lifecycle.";
    return route.fulfill({ json: { content, html: markdownToHtml(content) } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: getIndexHtml() })
  );
  await page.goto("http://bootcamp.test/");
  await page.evaluate("currentJobId = 'fixture'");
  await showRecommendations(page);
});

test("each recommended task opens its instructions with heading focus and restores its trigger", async ({
  page,
}) => {
  await mockDocuments(page);
  const titles = ["Configure retry behavior", "Verify request errors", "Write setup notes"];
  for (let index = 0; index < titles.length; index++) {
    const action = page.locator("#nextSteps .next-step-action").nth(index);
    await expect(action).toHaveAccessibleName(
      `Read instructions for task ${recommendations[index].taskNumber}: ${tasks[index].title}`
    );
    await action.focus();
    await page.keyboard.press("Enter");
    const heading = page.getByRole("heading", { level: 3, name: new RegExp(`${titles[index]}$`) });
    await expect(heading).toBeFocused({ timeout: 1000 });
    expect(await page.locator("#modal").evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    if (index === 0)
      await page.screenshot({
        path: `test-results/task-navigation-${test.info().project.name}.png`,
        fullPage: true,
      });
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.getElementById("modal")!.contains(document.activeElement))
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(action).toBeFocused();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("numbered sections distinguish repeated titles and survive prerequisite navigation with Back", async ({
  page,
}) => {
  const repeated = tasks
    .slice(1)
    .map((task) => ({ ...task, title: "Fix **request** errors?!", category: "test" as const }));
  await showRecommendations(
    page,
    repeated.map((task, index) => ({ ...task, taskNumber: index + 1 }))
  );
  await mockDocuments(page, generateFirstTasks({ ...facts, firstTasks: repeated }));
  const action = page.locator("#nextSteps .next-step-action").nth(1);
  await action.click();
  await expect(
    page.getByRole("heading", { name: "2. Fix request errors?!", exact: true })
  ).toBeFocused({ timeout: 1000 });
  const prerequisite = page.getByRole("link", { name: "ARCHITECTURE.md", exact: true });
  await prerequisite.focus();
  const scroll = await page.locator("#modal").evaluate((el) => el.scrollTop);
  await prerequisite.click();
  await expect(page.locator("#renderedContent h1")).toHaveText("Architecture");
  await page.getByRole("button", { name: "Back to FIRST_TASKS.md", exact: true }).click();
  await expect(prerequisite).toBeFocused();
  expect(await page.locator("#modal").evaluate((el) => el.scrollTop)).toBeCloseTo(scroll, 0);
  await page.keyboard.press("Escape");
  await expect(action).toBeFocused();
});

test("retry preserves the chosen task and Source retains the entire original document", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/files/**", (route) =>
    ++attempts === 1
      ? route.fulfill({ status: 503 })
      : route.fulfill({ json: { content: source, html: markdownToHtml(source) } })
  );
  await page.locator("#nextSteps .next-step-action").first().click();
  await expect(page.locator("#retryPreviewBtn")).toBeVisible();
  await expect(page.locator("#copyBtn")).toBeDisabled();
  await expect(page.locator("#downloadBtn")).toBeDisabled();
  await page.getByRole("button", { name: "Retry preview", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 3, name: /Configure retry behavior$/ })
  ).toBeFocused({ timeout: 1000 });
  await expect(page.locator("#previewBackBtn")).toBeHidden();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  expect(await page.locator("#modalContent").textContent()).toBe(source);
  await expect(page.locator("#copyBtn")).toBeEnabled();
  await expect(page.locator("#downloadBtn")).toBeEnabled();
});

for (const lateResponse of ["success", "failure"] as const) {
  test(`closing a delayed task preview ignores its late ${lateResponse} after selecting another task`, async ({
    page,
  }) => {
    await mockDocuments(page);
    await page.evaluate(
      ({ source, html, lateResponse }) => {
        const realFetch = window.fetch;
        const previewWindow = window as unknown as {
          viewFile: (...args: unknown[]) => Promise<void>;
          firstTaskPreview: Promise<void>;
        };
        const realViewFile = previewWindow.viewFile;
        previewWindow.viewFile = (...args) => {
          const pending = realViewFile(...args);
          previewWindow.firstTaskPreview ??= pending;
          return pending;
        };
        let held = false;
        window.fetch = (input, init) => {
          if (String(input).includes("/files/FIRST_TASKS.md") && !held) {
            held = true;
            return new Promise((resolve) => {
              (
                window as unknown as { releaseTask: () => void; taskSignal: AbortSignal }
              ).taskSignal = init!.signal!;
              (window as unknown as { releaseTask: () => void }).releaseTask = () =>
                resolve(
                  new Response(JSON.stringify({ content: source, html }), {
                    status: lateResponse === "success" ? 200 : 503,
                  })
                );
            });
          }
          return realFetch(input, init);
        };
      },
      { source, html: markdownToHtml(source), lateResponse }
    );
    await page.locator("#nextSteps .next-step-action").first().click();
    await expect(page.locator("#modalContent")).toHaveText("Loading…");
    await page.keyboard.press("Escape");
    const action = page.locator("#nextSteps .next-step-action").nth(1);
    await action.click();
    const heading = page.getByRole("heading", { level: 3, name: /Verify request errors$/ });
    await expect(heading).toBeFocused({ timeout: 1000 });
    expect(await page.evaluate("window.taskSignal.aborted")).toBe(true);
    await page.evaluate("window.releaseTask()");
    await page.evaluate("window.firstTaskPreview");
    await expect(heading).toBeFocused();
    await expect(page.locator("#retryPreviewBtn")).toBeHidden();
    await expect(page.locator("#copyBtn")).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(action).toBeFocused();
  });
}

test("legacy recommendations and missing sections fall back to the document; JSON-only results have no broken task actions", async ({
  page,
}) => {
  await mockDocuments(page, "# First Tasks\n\nA custom task template without numbered sections.");
  await page.locator("#nextSteps .next-step-action").first().click();
  await expect(page.locator("#renderedContent h1")).toHaveText("First Tasks");
  await expect(page.locator("#closeBtn")).toBeFocused();
  await page.keyboard.press("Escape");
  await showRecommendations(page, [{ ...tasks[0], taskNumber: 0 }]);
  await page.locator("#nextSteps .next-step-action").click();
  await expect(page.locator("#renderedContent h1")).toHaveText("First Tasks");
  await page.keyboard.press("Escape");
  await showRecommendations(page, recommendations, ["repo_facts.json"]);
  await expect(page.locator("#nextSteps .next-step-action")).toHaveCount(0);
});
