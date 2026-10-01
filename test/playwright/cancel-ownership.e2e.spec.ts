import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";

import { expect, test as base, type Page } from "@playwright/test";

import { getIndexHtml } from "../../src/web/templates.js";

type Outcome = "success" | "error" | "invalid" | "network";
type Fixture = {
  cancellations: string[];
  emit: (jobId: string, type: string) => Promise<void>;
  release: (index: number, outcome: Outcome) => void;
};

const test = base.extend<{ app: Fixture }>({
  app: async ({ page }, use) => {
    const streams = new Map<string, ServerResponse>();
    const pending: ServerResponse[] = [];
    const cancellations: string[] = [];
    let jobs = 0;
    const server = createServer(async (req, res) => {
      const path = new URL(req.url!, "http://fixture.test").pathname;
      const json = (data: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (path === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(getIndexHtml());
      } else if (path === "/api/analyze") {
        for await (const _chunk of req) {
          /* consume the request */
        }
        json({ jobId: "job-" + ++jobs });
      } else if (path.endsWith("/stream")) {
        const jobId = path.split("/").at(-2)!;
        streams.set(jobId, res);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"type":"phase","phase":"clone","message":"Analysis running"}\n\n');
      } else if (path.endsWith("/cancel")) {
        cancellations.push(path.split("/").at(-2)!);
        pending.push(res);
      } else {
        json({ error: "Unknown fixture route" }, 404);
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture port unavailable");
    await page.addInitScript({
      content: `
        const nativeFetch = window.fetch.bind(window);
        window.__cancelStates = [];
        window.fetch = async (...args) => {
          if (!String(args[0]).endsWith('/cancel')) return nativeFetch(...args);
          const state = { ready: false, settled: false, mode: window.__cancelMode || 'fetch' };
          window.__cancelStates.push(state);
          let release;
          const gate = new Promise(resolve => { release = resolve; });
          state.release = release;
          try {
            const response = await nativeFetch(...args);
            await response.clone().text();
            const nativeJson = response.json.bind(response);
            response.json = async () => {
              if (state.mode === 'json') {
                state.ready = true;
                await gate;
              }
              try { return await nativeJson(); }
              finally { setTimeout(() => { state.settled = true; }, 0); }
            };
            if (state.mode === 'fetch') setTimeout(() => { state.settled = true; }, 0);
            return response;
          } catch (error) {
            setTimeout(() => { state.settled = true; }, 0);
            throw error;
          }
        };
      `,
    });
    try {
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await use({
        cancellations,
        emit: async (jobId, type) => {
          await expect.poll(() => streams.has(jobId)).toBe(true);
          const repository = jobId === "job-1" ? "sindresorhus/ky" : "expressjs/express";
          const data = {
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
          streams.get(jobId)!.end(
            "data: " +
              JSON.stringify({
                type,
                message: type === "error" ? "Analysis failed" : "Analysis " + type,
                data,
              }) +
              "\n\n"
          );
        },
        release: (index, outcome) => {
          const res = pending[index];
          if (!res) throw new Error("Missing cancellation " + index);
          if (outcome === "network") {
            res.destroy();
            return;
          }
          res.writeHead(outcome === "error" ? 500 : 200, { "Content-Type": "application/json" });
          res.end(
            outcome === "invalid"
              ? "invalid JSON"
              : JSON.stringify(
                  outcome === "error"
                    ? { error: "Cancellation request failed" }
                    : { cancelled: true }
                )
          );
        },
      });
    } finally {
      await page.close();
      for (const res of [...streams.values(), ...pending]) res.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    }
  },
});

async function analyze(page: Page, repository: string) {
  await page
    .getByRole("textbox", { name: "Repository URL", exact: true })
    .fill("https://github.com/" + repository);
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator("#progressItems")).toContainText("Analysis running");
  await expect(page.locator("#cancelBtn")).toBeEnabled();
}

async function settled(page: Page, index: number) {
  await page.waitForFunction((index) => (window as any).__cancelStates[index]?.settled, index);
}

async function capture(page: Page, name: string) {
  await page.screenshot({
    path: `test-results/cancel-${name}-${test.info().project.name}.png`,
    fullPage: true,
  });
}

for (const mode of ["fetch", "json"]) {
  for (const outcome of ["success", "error"] as const) {
    test(`late ${mode} cancellation ${outcome} cannot change a newer pending cancellation`, async ({
      page,
      app,
    }) => {
      await page.evaluate((mode) => {
        (window as any).__cancelMode = mode;
      }, mode);
      await analyze(page, "sindresorhus/ky");
      await page.getByRole("button", { name: "Cancel analysis", exact: true }).click();
      await expect.poll(() => app.cancellations.length).toBe(1);
      if (mode === "json") {
        app.release(0, outcome);
        await page.waitForFunction(() => (window as any).__cancelStates[0].ready);
      }
      await app.emit("job-1", "complete");
      await expect(page.locator("#resultMeta")).toContainText("sindresorhus/ky");
      await analyze(page, "expressjs/express");
      await page.getByRole("button", { name: "Cancel analysis", exact: true }).click();
      await expect.poll(() => app.cancellations.length).toBe(2);
      const status = await page.locator("#statusMsg").textContent();
      const progress = await page.locator("#progressItems").textContent();
      if (mode === "fetch") app.release(0, outcome);
      else await page.evaluate(() => (window as any).__cancelStates[0].release());
      await settled(page, 0);
      await capture(page, `pending-${mode}-${outcome}`);
      await expect(page.locator("#statusMsg")).toHaveText(status!);
      await expect(page.locator("#progressItems")).toHaveText(progress!);
      await expect(page.locator("#cancelBtn")).toHaveText("Cancelling…");
      await expect(page.locator("#cancelBtn")).toBeDisabled();
      await expect(page.locator("#analyzeBtn")).toBeDisabled();
      await expect(page.locator("#repoUrl")).toHaveValue("https://github.com/expressjs/express");
      expect(app.cancellations).toEqual(["job-1", "job-2"]);
    });
  }
}

for (const outcome of ["success", "error"] as const) {
  test(`late cancellation ${outcome} cannot change completed newer results`, async ({
    page,
    app,
  }) => {
    await analyze(page, "sindresorhus/ky");
    await page.getByRole("button", { name: "Cancel analysis", exact: true }).click();
    await expect.poll(() => app.cancellations.length).toBe(1);
    await app.emit("job-1", "complete");
    await expect(page.locator("#resultMeta")).toContainText("sindresorhus/ky");
    await analyze(page, "expressjs/express");
    await app.emit("job-2", "complete");
    await expect(page.locator("#resultMeta")).toContainText("expressjs/express");
    const status = await page.locator("#statusMsg").textContent();
    const progress = await page.locator("#progressItems").textContent();
    app.release(0, outcome);
    await settled(page, 0);
    await capture(page, "complete-" + outcome);
    await expect(page.locator("#statusMsg")).toHaveText(status!);
    await expect(page.locator("#progressItems")).toHaveText(progress!);
    await expect(page.locator("#resultMeta")).toContainText("expressjs/express");
    await expect(page.locator("#analyzeBtn")).toBeEnabled();
    await expect(page.locator("#cancelBtn")).toBeHidden();
  });
}

for (const terminal of ["complete", "error", "cancelled"]) {
  test(`same-job ${terminal} remains terminal when a late cancellation succeeds`, async ({
    page,
    app,
  }) => {
    await analyze(page, "sindresorhus/ky");
    await page.getByRole("button", { name: "Cancel analysis", exact: true }).click();
    await expect.poll(() => app.cancellations.length).toBe(1);
    await app.emit("job-1", terminal);
    await expect(page.locator("#cancelBtn")).toBeHidden();
    const status = await page.locator("#statusMsg").textContent();
    const progress = await page.locator("#progressItems").textContent();
    app.release(0, "success");
    await settled(page, 0);
    await expect(page.locator("#statusMsg")).toHaveText(status!);
    await expect(page.locator("#progressItems")).toHaveText(progress!);
    await expect(page.locator("#analyzeBtn")).toBeEnabled();
  });
}

test("healthy current cancellation acknowledges then settles as cancelled", async ({
  page,
  app,
}) => {
  await analyze(page, "sindresorhus/ky");
  await page.getByRole("button", { name: "Cancel analysis", exact: true }).click();
  await expect.poll(() => app.cancellations.length).toBe(1);
  app.release(0, "success");
  await settled(page, 0);
  await expect(page.locator("#statusMsg")).toHaveText("Cancellation requested");
  await expect(page.locator("#cancelBtn")).toBeDisabled();
  await app.emit("job-1", "cancelled");
  await expect(page.locator("#statusMsg")).toHaveText("Analysis cancelled");
  await expect(page.locator("#retryBtn")).toBeVisible();
  await expect(page.locator("#analyzeBtn")).toBeEnabled();
  await expect(page.locator("#repoUrl")).toHaveValue("https://github.com/sindresorhus/ky");
  expect(await page.evaluate(() => window.EventSource.toString())).toContain("[native code]");
  await capture(page, "healthy");
});

for (const outcome of ["error", "invalid", "network"] as const) {
  test(`current cancellation ${outcome} failure remains retryable`, async ({ page, app }) => {
    await analyze(page, "sindresorhus/ky");
    await page.getByRole("button", { name: "Cancel analysis", exact: true }).click();
    await expect.poll(() => app.cancellations.length).toBe(1);
    app.release(0, outcome);
    await settled(page, 0);
    await expect(page.locator("#progressItems .error")).toHaveCount(1);
    await expect(page.locator("#cancelBtn")).toBeEnabled();
    await expect(page.locator("#cancelBtn")).toHaveText("Cancel analysis");
    await page.getByRole("button", { name: "Cancel analysis", exact: true }).click();
    await expect.poll(() => app.cancellations.length).toBe(2);
    app.release(1, "success");
    await settled(page, 1);
    await expect(page.locator("#statusMsg")).toHaveText("Cancellation requested");
    expect(app.cancellations).toEqual(["job-1", "job-1"]);
  });
}
