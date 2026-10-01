import { expect, test, type Page } from "@playwright/test";

import { getIndexHtml } from "../../src/web/templates.js";

const savedId = "saved-ky";
const newId = "new-express";
const kyUrl = "https://github.com/sindresorhus/ky";
const expressUrl = "https://github.com/expressjs/express";

function result(repository: string) {
  return {
    files: ["OVERVIEW.md"],
    stats: {
      securityScore: 85,
      securityGrade: "B",
      riskScore: 18,
      riskGrade: "A",
      dependencies: 3,
      filesScanned: 12,
      durationMs: 1000,
    },
    manifest: { repository: { fullName: repository, branch: "main", provider: "github" } },
  };
}

async function fixture(
  page: Page,
  { mode = "fetch", failure = "", running = false, saved = true, restoredRunning = false } = {}
) {
  // Buffer only the saved-job lookup; all streams use native EventSource.
  // The mock deliberately completes obsolete work so guards, not abort alone,
  // must preserve the new page state and saved job.
  await page.addInitScript({
    content: `
      if (${saved}) localStorage.setItem('repo-bootcamp-job-id', '${savedId}');
      window.__restoreReady = false;
      window.__restoreSettled = false;
      const nativeFetch = window.fetch.bind(window);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      window.__releaseRestore = release;
      window.fetch = async (...args) => {
        if (String(args[0]) !== '/api/jobs/${savedId}') return nativeFetch(...args);
        if (${JSON.stringify(mode)} === 'fetch') {
          let response, error;
          try { response = await nativeFetch(...args); } catch (caught) { error = caught; }
          window.__restoreReady = true;
          await gate;
          setTimeout(() => { window.__restoreSettled = true; }, 0);
          if (error) throw error;
          return response;
        }
        const response = await nativeFetch(...args);
        const nativeJson = response.json.bind(response);
        response.json = async () => {
          const payload = await nativeJson();
          window.__restoreReady = true;
          await gate;
          setTimeout(() => { window.__restoreSettled = true; }, 0);
          if (${JSON.stringify(mode)} === 'json-error') throw new Error('Buffered JSON failure');
          return payload;
        };
        return response;
      };
    `,
  });
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: getIndexHtml() })
  );
  const submissions: unknown[] = [];
  const streams: string[] = [];
  await page.route("**/api/analyze", (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { jobId: newId } });
  });
  await page.route("**/api/jobs/" + savedId, (route) => {
    if (failure === "network") return route.abort("failed");
    if (failure === "http") return route.fulfill({ status: 404, json: { error: "Expired job" } });
    if (failure === "invalid") return route.fulfill({ json: {} });
    return route.fulfill({
      json: {
        id: savedId,
        repoUrl: kyUrl,
        status: restoredRunning ? "running" : "complete",
        startedAt: Date.now() - 1000,
      },
    });
  });
  await page.route("**/api/jobs/" + newId, (route) =>
    route.fulfill({ json: { id: newId, repoUrl: expressUrl, status: "running", progress: [] } })
  );
  await page.route("**/stream", (route) => {
    const jobId = route.request().url().split("/").at(-2)!;
    streams.push(jobId);
    const event =
      (running && jobId === newId) || (restoredRunning && jobId === savedId)
        ? {
            type: "phase",
            phase: "clone",
            message: jobId === savedId ? "Saved analysis running" : "Express analysis is running",
          }
        : {
            type: "complete",
            message: "Native stream complete",
            data: result(jobId === savedId ? "sindresorhus/ky" : "expressjs/express"),
          };
    return route.fulfill({
      contentType: "text/event-stream",
      body: "data: " + JSON.stringify(event) + "\n\n",
    });
  });
  await page.goto("http://bootcamp.test/");
  if (saved) await page.waitForFunction(() => (window as any).__restoreReady);
  return { submissions, streams };
}

async function releaseRestore(page: Page) {
  await page.evaluate(() => (window as any).__releaseRestore());
  await page.waitForFunction(() => (window as any).__restoreSettled);
}

async function startExpress(page: Page, running = false) {
  await page.getByRole("textbox", { name: "Repository URL", exact: true }).fill(expressUrl);
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  if (running) {
    await expect(page.locator("#progressItems")).toContainText("Express analysis is running");
    await expect(page.locator("#statusMsg")).toHaveText(
      "Connection lost. Retrying analysis status."
    );
  } else {
    await expect(page.locator("#resultMeta")).toContainText("expressjs/express");
    await expect(page.locator("#results")).toHaveClass("results show");
  }
}

async function capture(page: Page, name: string) {
  await page.screenshot({
    path: `test-results/restore-${name}-${test.info().project.name}.png`,
    fullPage: true,
  });
}

for (const mode of ["fetch", "json"] as const) {
  for (const running of [false, true]) {
    test(`late restore ${mode} cannot replace a newer ${running ? "running" : "completed"} analysis`, async ({
      page,
    }) => {
      const { streams } = await fixture(page, { mode, running });
      await startExpress(page, running);
      const status = await page.locator("#statusMsg").textContent();
      await releaseRestore(page);
      await capture(page, `${mode}-${running ? "running" : "complete"}`);
      await expect(page.locator("#repoUrl")).toHaveValue(expressUrl);
      expect(streams).toEqual([newId]);
      await expect(page.locator("#statusMsg")).toHaveText(status!);
      if (running) {
        await expect(page.locator("#analyzeBtn")).toBeDisabled();
        await expect(page.locator("#cancelBtn")).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem("repo-bootcamp-job-id"))).toBe(newId);
      } else {
        await expect(page.locator("#results")).toHaveClass("results show");
        await expect(page.locator("#resultMeta")).toContainText("expressjs/express");
        await expect(page.locator("#analyzeBtn")).toBeEnabled();
      }
    });
  }
}

for (const failure of ["http", "invalid", "network", "json-error"]) {
  test(`obsolete restore ${failure} failure cannot forget the newer running job`, async ({
    page,
  }) => {
    const { streams } = await fixture(page, {
      failure,
      mode: failure === "json-error" ? "json-error" : "fetch",
      running: true,
    });
    await startExpress(page, true);
    await releaseRestore(page);
    expect(await page.evaluate(() => localStorage.getItem("repo-bootcamp-job-id"))).toBe(newId);
    await expect(page.locator("#repoUrl")).toHaveValue(expressUrl);
    await expect(page.locator("#analyzeBtn")).toBeDisabled();
    expect(streams).toEqual([newId]);
  });
}

const edits = [
  { id: "repoUrl", value: expressUrl },
  { id: "branch", value: "feature/recovery" },
  { id: "focus", value: "architecture", select: true },
  { id: "audience", value: "backend", select: true },
  { id: "maxFiles", value: "42" },
];
for (const edit of edits) {
  test(`editing ${edit.id} preserves the draft instead of restoring the saved job`, async ({
    page,
  }) => {
    const { streams } = await fixture(page);
    if (edit.id !== "repoUrl") await page.getByText("Run options", { exact: true }).click();
    if (edit.select) await page.locator("#" + edit.id).selectOption(edit.value);
    else await page.locator("#" + edit.id).fill(edit.value);
    await releaseRestore(page);
    await capture(page, "draft-" + edit.id);
    await expect(page.locator("#" + edit.id)).toHaveValue(edit.value);
    await expect(page.locator("#repoUrl")).toHaveValue(edit.id === "repoUrl" ? expressUrl : "");
    await expect(page.locator("#emptyState")).toBeVisible();
    await expect(page.locator("#progress")).toBeHidden();
    await expect(page.locator("#analyzeBtn")).toBeEnabled();
    expect(streams).toEqual([]);
  });
}

test("editing and reverting a draft still supersedes pending restoration", async ({ page }) => {
  const { streams } = await fixture(page, { mode: "json" });
  await page.locator("#repoUrl").fill(expressUrl);
  await page.locator("#repoUrl").fill("");
  await releaseRestore(page);
  await expect(page.locator("#repoUrl")).toHaveValue("");
  await expect(page.locator("#emptyState")).toBeVisible();
  expect(streams).toEqual([]);
});

test("a newer empty submission keeps its validation instead of restoring", async ({ page }) => {
  const { submissions, streams } = await fixture(page);
  await page.evaluate(() =>
    (document.querySelector("#analyzeForm") as HTMLFormElement).requestSubmit()
  );
  await expect(page.locator("#repoUrlError")).toHaveText("Please enter a repository URL");
  await releaseRestore(page);
  await expect(page.locator("#repoUrl")).toHaveValue("");
  await expect(page.locator("#repoUrlError")).toBeVisible();
  await expect(page.locator("#repoUrl")).toBeFocused();
  expect(submissions).toEqual([]);
  expect(streams).toEqual([]);
});

test("an untouched page restores a completed saved job with native EventSource", async ({
  page,
}) => {
  const { streams } = await fixture(page);
  await releaseRestore(page);
  await expect(page.locator("#resultMeta")).toContainText("sindresorhus/ky");
  await expect(page.locator("#results")).toHaveClass("results show");
  await expect(page.locator("#repoUrl")).toHaveValue(kyUrl);
  await expect(page.locator("#analyzeBtn")).toBeEnabled();
  expect(streams).toEqual([savedId]);
  expect(await page.evaluate(() => localStorage.getItem("repo-bootcamp-job-id"))).toBeNull();
  expect(await page.evaluate(() => window.EventSource.toString())).toContain("[native code]");
  await capture(page, "healthy-complete");
});

test("an untouched page restores a running job and can request cancellation", async ({ page }) => {
  await fixture(page, { restoredRunning: true });
  let cancellations = 0;
  await page.route("**/api/jobs/" + savedId + "/cancel", (route) => {
    cancellations++;
    return route.fulfill({ json: { status: "cancelling" } });
  });
  await releaseRestore(page);
  await expect(page.locator("#progressItems")).toContainText("Saved analysis running");
  await expect(page.locator("#repoUrl")).toHaveValue(kyUrl);
  await expect(page.locator("#analyzeBtn")).toBeDisabled();
  await expect(page.locator("#cancelBtn")).toBeEnabled();
  await page.getByRole("button", { name: "Cancel analysis", exact: true }).click();
  await expect(page.locator("#progressItems")).toContainText("Cancellation requested");
  expect(cancellations).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("repo-bootcamp-job-id"))).toBe(savedId);
});

for (const failure of ["http", "invalid", "network", "json-error"]) {
  test(`an untouched ${failure} restoration failure cleans its own saved ID`, async ({ page }) => {
    const { streams } = await fixture(page, {
      failure,
      mode: failure === "json-error" ? "json-error" : "fetch",
    });
    await releaseRestore(page);
    expect(await page.evaluate(() => localStorage.getItem("repo-bootcamp-job-id"))).toBeNull();
    await expect(page.locator("#emptyState")).toBeVisible();
    await expect(page.locator("#analyzeBtn")).toBeEnabled();
    expect(streams).toEqual([]);
  });
}

test("failed restoration only removes the saved ID that it looked up", async ({ page }) => {
  await fixture(page, { failure: "http" });
  await page.evaluate(() => localStorage.setItem("repo-bootcamp-job-id", "another-tab-job"));
  await releaseRestore(page);
  expect(await page.evaluate(() => localStorage.getItem("repo-bootcamp-job-id"))).toBe(
    "another-tab-job"
  );
});

test("a fresh page without a saved job remains ready for input", async ({ page }) => {
  const { streams } = await fixture(page, { saved: false });
  await expect(page.locator("#emptyState")).toBeVisible();
  await expect(page.locator("#repoUrl")).toHaveValue("");
  await expect(page.locator("#analyzeBtn")).toBeEnabled();
  expect(streams).toEqual([]);
});
