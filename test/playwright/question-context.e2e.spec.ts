import { expect, test, type Page } from "@playwright/test";
import { getIndexHtml } from "../../src/web/templates.js";
import { markdownToHtml } from "../../src/formatter.js";

const kyAnswer = "For sindresorhus/ky, read source/core/Ky.ts before documenting retries.";
const expressAnswer = "For expressjs/express, read lib/application.js before changing routes.";
const taskHeading = "1. Document retries";
const documents: Record<string, string> = {
  "FIRST_TASKS.md":
    "# First tasks\n\n### 1. Document retries\n\nRead [ARCHITECTURE.md](./ARCHITECTURE.md) before documenting retries.",
  "ARCHITECTURE.md": "# Architecture\n\nRead the request lifecycle before changing retry behavior.",
};

test.beforeEach(async ({ page }) => {
  await page.route("http://bootcamp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: getIndexHtml() })
  );
  let jobCount = 0;
  const repositories = new Map<string, string>();
  await page.route("**/api/analyze", async (route) => {
    const input = route.request().postDataJSON();
    const jobId = "question-job-" + ++jobCount;
    repositories.set(
      jobId,
      input.repoUrl.includes("express") ? "expressjs/express" : "sindresorhus/ky"
    );
    await route.fulfill({ json: { jobId } });
  });
  await page.route("**/stream", async (route) => {
    const jobId = route.request().url().split("/").at(-2)!;
    const result = {
      files: Object.keys(documents),
      stats: {
        securityScore: 85,
        securityGrade: "B",
        riskScore: 18,
        riskGrade: "A",
        dependencies: 3,
        filesScanned: 12,
        durationMs: 12000,
      },
      manifest: {
        repository: { fullName: repositories.get(jobId), branch: "main", provider: "github" },
      },
      recommendations: [
        {
          title: "Document retries",
          taskNumber: 1,
          taskHeadingHtml: markdownToHtml("### " + taskHeading),
          files: ["readme.md"],
        },
      ],
    };
    await route.fulfill({
      contentType: "text/event-stream",
      body:
        "data: " +
        JSON.stringify({ type: "complete", message: "Fixture complete", data: result }) +
        "\n\n",
    });
  });
  await page.route("**/files/**", (route) => {
    const filename = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!);
    const content = documents[filename];
    return route.fulfill({ json: { content, html: markdownToHtml(content) } });
  });
  await page.goto("http://bootcamp.test/");
  await analyze(page, "sindresorhus/ky");
});

async function analyze(page: Page, repository: string) {
  await page
    .getByRole("textbox", { name: "Repository URL", exact: true })
    .fill("https://github.com/" + repository);
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator("#resultMeta")).toContainText(repository);
}

async function openQuestions(page: Page) {
  if (!(await page.locator("#askPanel").evaluate((el) => (el as HTMLDetailsElement).open))) {
    await page.getByText("Ask a follow-up question", { exact: true }).click();
  }
}

async function ask(page: Page, question: string) {
  await openQuestions(page);
  await page.getByRole("textbox", { name: "Ask a question about this repository" }).fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

async function capture(page: Page, name: string) {
  await page.screenshot({
    path: `test-results/question-${name}-${test.info().project.name}.png`,
    fullPage: true,
  });
}

test("reading task prerequisites preserves the current repository question and answer", async ({
  page,
}) => {
  await page.route("**/ask", (route) => route.fulfill({ json: { answer: kyAnswer } }));
  await page
    .getByRole("button", { name: "Read instructions for task 1: Document retries" })
    .click();
  await expect(page.getByRole("heading", { name: taskHeading, exact: true })).toBeFocused();
  await capture(page, "01-task");
  await page.keyboard.press("Escape");
  await ask(page, "Where should I read before documenting retries?");
  await expect(page.locator("#askAnswer")).toHaveText(kyAnswer);
  await capture(page, "02-answer");
  await page
    .getByRole("button", { name: "Read instructions for task 1: Document retries" })
    .click();
  await page.getByRole("link", { name: "ARCHITECTURE.md", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Architecture", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to FIRST_TASKS.md", exact: true }).click();
  await expect(page.getByRole("heading", { name: taskHeading, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#askAnswer")).toHaveText(kyAnswer);
  await expect(page.locator("#askQuestion")).toHaveValue(
    "Where should I read before documenting retries?"
  );
  await capture(page, "03-retained");
});

test("a new repository analysis clears the previous question and answer", async ({ page }) => {
  await page.route("**/ask", (route) => route.fulfill({ json: { answer: kyAnswer } }));
  await ask(page, "Where should I read before documenting retries?");
  await expect(page.locator("#askAnswer")).toHaveText(kyAnswer);
  await analyze(page, "expressjs/express");
  await openQuestions(page);
  await capture(page, "04-new-repository");
  await expect(page.locator("#askAnswer")).toBeHidden({ timeout: 1000 });
  await expect(page.locator("#askQuestion")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeEnabled();
});

for (const outcome of ["success", "failure"] as const) {
  test(`a delayed old question ${outcome} cannot appear under the new repository`, async ({
    page,
  }) => {
    await page.evaluate(
      ({ kyAnswer, expressAnswer, outcome }) => {
        const realFetch = window.fetch;
        let calls = 0;
        const state = window as unknown as {
          releaseQuestion: () => void;
          oldQuestionSettled: Promise<void>;
          oldQuestionSignal?: AbortSignal;
        };
        window.fetch = async (input, init) => {
          if (String(input).endsWith("/ask")) {
            if (++calls === 1) {
              state.oldQuestionSignal = init?.signal ?? undefined;
              return new Promise<Response>((resolve, reject) => {
                state.releaseQuestion = () => {
                  if (outcome === "success")
                    resolve(
                      new Response(JSON.stringify({ answer: kyAnswer }), {
                        headers: { "Content-Type": "application/json" },
                      })
                    );
                  else reject(new Error("Old repository question failed"));
                };
              });
            }
            return new Response(JSON.stringify({ answer: expressAnswer }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          return realFetch(input, init);
        };
        const originalAsk = (window as unknown as { askQuestion: () => Promise<void> }).askQuestion;
        (window as unknown as { askQuestion: () => Promise<void> }).askQuestion = () => {
          const request = originalAsk();
          state.oldQuestionSettled ??= request;
          return request;
        };
      },
      { kyAnswer, expressAnswer, outcome }
    );
    await ask(page, "Where should I read before documenting retries?");
    await expect(page.getByRole("button", { name: "Thinking…", exact: true })).toBeDisabled();
    await analyze(page, "expressjs/express");
    await openQuestions(page);
    await capture(page, "05-pending-old-" + outcome);
    // Release a response which was already buffered despite cancellation. A
    // request identity guard must protect the current view after every await.
    await page.evaluate("window.releaseQuestion()");
    await page.evaluate("window.oldQuestionSettled");
    await capture(page, "06-late-old-" + outcome);
    await expect(page.locator("#askAnswer")).toBeHidden({ timeout: 1000 });
    await ask(page, "Where should I read before changing routes?");
    await expect(page.locator("#askAnswer")).toHaveText(expressAnswer);
    expect(await page.evaluate("window.oldQuestionSignal?.aborted")).toBe(true);
  });
}

for (const scenario of [
  { stage: "fetch", outcome: "success" },
  { stage: "json", outcome: "success" },
  { stage: "json", outcome: "failure" },
] as const) {
  test(`an obsolete ${scenario.stage} ${scenario.outcome} cannot finalize a newer pending question`, async ({
    page,
  }) => {
    await page.evaluate(
      ({ scenario, kyAnswer, expressAnswer }) => {
        const realFetch = window.fetch;
        let calls = 0;
        const state = window as unknown as {
          releaseOldQuestion: () => void;
          releaseNewQuestion: () => void;
          oldQuestionSettled: Promise<void>;
          oldJsonStarted: boolean;
          oldQuestionSignal?: AbortSignal;
          questionUrls: string[];
        };
        state.questionUrls = [];
        window.fetch = async (input, init) => {
          if (!String(input).endsWith("/ask")) return realFetch(input, init);
          state.questionUrls.push(String(input));
          if (++calls === 1) {
            state.oldQuestionSignal = init?.signal ?? undefined;
            if (scenario.stage === "json") {
              const response = new Response("{}", {
                headers: { "Content-Type": "application/json" },
              });
              response.json = () => {
                state.oldJsonStarted = true;
                return new Promise((resolve, reject) => {
                  state.releaseOldQuestion = () => {
                    if (scenario.outcome === "success") resolve({ answer: kyAnswer });
                    else reject(new Error("Old JSON parsing failed"));
                  };
                });
              };
              return response;
            }
            return new Promise<Response>((resolve) => {
              state.releaseOldQuestion = () =>
                resolve(
                  new Response(JSON.stringify({ answer: kyAnswer }), {
                    headers: { "Content-Type": "application/json" },
                  })
                );
            });
          }
          return new Promise<Response>((resolve) => {
            state.releaseNewQuestion = () =>
              resolve(
                new Response(JSON.stringify({ answer: expressAnswer }), {
                  headers: { "Content-Type": "application/json" },
                })
              );
          });
        };
        const originalAsk = (window as unknown as { askQuestion: () => Promise<void> }).askQuestion;
        (window as unknown as { askQuestion: () => Promise<void> }).askQuestion = () => {
          const request = originalAsk();
          state.oldQuestionSettled ??= request;
          return request;
        };
      },
      { scenario, kyAnswer, expressAnswer }
    );
    await ask(page, "Where should I read before documenting retries?");
    if (scenario.stage === "json") {
      await expect.poll(() => page.evaluate("window.oldJsonStarted")).toBe(true);
    }
    await analyze(page, "expressjs/express");
    await openQuestions(page);
    await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeEnabled();
    await expect(page.locator("#askAnswer")).toBeHidden();
    await ask(page, "Where should I read before changing routes?");
    await expect.poll(() => page.evaluate("window.questionUrls.length")).toBe(2);
    await page.evaluate("window.releaseOldQuestion()");
    await page.evaluate("window.oldQuestionSettled");
    await expect(page.getByRole("button", { name: "Thinking…", exact: true })).toBeDisabled();
    await expect(page.locator("#askAnswer")).toHaveText("Reading the repository…");
    await expect(page.locator("#askAnswer")).not.toHaveClass(/error/);
    await expect(page.locator("#askQuestion")).toHaveValue(
      "Where should I read before changing routes?"
    );
    expect(await page.evaluate("window.oldQuestionSignal.aborted")).toBe(true);
    expect(await page.evaluate("window.questionUrls")).toEqual([
      "/api/jobs/question-job-1/ask",
      "/api/jobs/question-job-2/ask",
    ]);
    await page.evaluate("window.releaseNewQuestion()");
    await expect(page.locator("#askAnswer")).toHaveText(expressAnswer);
    await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeEnabled();
  });
}

test("a current question failure is retryable and duplicate submissions share the pending request", async ({
  page,
}) => {
  await page.evaluate(() => {
    const realFetch = window.fetch;
    const state = window as unknown as { questionAskCalls: number };
    state.questionAskCalls = 0;
    window.fetch = (input, init) => {
      if (String(input).endsWith("/ask")) state.questionAskCalls++;
      return realFetch(input, init);
    };
  });
  let calls = 0;
  let releaseRetry: (() => Promise<void>) | undefined;
  await page.route("**/ask", async (route) => {
    if (++calls === 1) {
      await route.fulfill({
        status: 500,
        json: { error: "The repository question failed. Try again." },
      });
      return;
    }
    await new Promise<void>((resolve) => {
      releaseRetry = async () => {
        await route.fulfill({ json: { answer: kyAnswer } });
        resolve();
      };
    });
  });
  await ask(page, "Where should I read before documenting retries?");
  await expect(page.locator("#askAnswer")).toHaveText("The repository question failed. Try again.");
  await expect(page.locator("#askAnswer")).toHaveClass(/error/);
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeEnabled();
  await ask(page, "   ");
  await expect(page.locator("#askQuestion")).toBeFocused();
  expect(await page.evaluate("window.questionAskCalls")).toBe(1);
  await ask(page, "Where should I read before documenting retries?");
  await expect.poll(() => typeof releaseRetry).toBe("function");
  await page.evaluate(() =>
    (document.getElementById("askForm") as HTMLFormElement).requestSubmit()
  );
  expect(await page.evaluate("window.questionAskCalls")).toBe(2);
  await expect(page.getByRole("button", { name: "Thinking…", exact: true })).toBeDisabled();
  await releaseRetry!();
  await expect(page.locator("#askAnswer")).toHaveText(kyAnswer);
  await expect(page.locator("#askAnswer")).not.toHaveClass(/error/);
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeEnabled();
});
