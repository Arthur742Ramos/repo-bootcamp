import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { expect, test as base, type Page } from "@playwright/test";
import { getIndexHtml } from "../../src/web/templates.js";

type Fixture = {
  failStart: boolean;
  reads: number;
  holdStatus: boolean;
  releaseStatus: () => void;
  send: (payload: string) => void;
  disconnect: () => void;
};

const test = base.extend<{ app: Fixture }>({
  app: async ({ page }, use) => {
    let stream: ServerResponse | undefined;
    let starts = 0;
    const heldStatuses: { response: ServerResponse; release: () => void }[] = [];
    const fixture: Fixture = {
      failStart: false,
      reads: 0,
      holdStatus: false,
      releaseStatus: () => {
        fixture.holdStatus = false;
        for (const held of heldStatuses.splice(0)) held.release();
      },
      send: (payload) => {
        if (!stream) throw new Error("Missing progress stream");
        stream.write(`data: ${payload}\n\n`);
      },
      disconnect: () => stream?.end(),
    };
    const server = createServer(async (req, res) => {
      const path = new URL(req.url!, "http://fixture.test").pathname;
      const json = (body: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (path === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(getIndexHtml());
      } else if (path === "/api/analyze") {
        for await (const _chunk of req) {
          /* consume request */
        }
        if (fixture.failStart && ++starts === 1) json({ error: "Server at capacity" }, 503);
        else json({ jobId: "fixture-job" });
      } else if (path.endsWith("/stream")) {
        stream = res;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        fixture.send(JSON.stringify({ type: "phase", phase: "scan", message: "Scanning files" }));
      } else if (path === "/api/jobs/fixture-job") {
        fixture.reads++;
        if (fixture.holdStatus) {
          // Fetch can receive headers while readJsonResponse still awaits the body.
          res.writeHead(503, { "Content-Type": "application/json" });
          res.write('{"error":');
          heldStatuses.push({
            response: res,
            release: () => res.end('"Status temporarily unavailable"}'),
          });
        } else json({ error: "Status temporarily unavailable" }, 503);
      } else {
        json({ error: "Unknown fixture route" }, 404);
      }
    });
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    const time = new Date("2026-01-01T00:00:00Z");
    await page.clock.install({ time });
    try {
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.clock.pauseAt(new Date(time.getTime() + 1000));
      await use(fixture);
    } finally {
      await page.close();
      stream?.destroy();
      for (const held of heldStatuses.splice(0)) held.response.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  },
});

async function analyze(page: Page) {
  await page
    .getByRole("textbox", { name: "Repository URL", exact: true })
    .fill("https://github.com/expressjs/express");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
}

async function expectSettled(page: Page) {
  await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeEnabled();
  await expect(page.locator("#analyzeForm")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#phaseRail .active, #phaseRail [aria-current]")).toHaveCount(0);
  const elapsed = await page.locator("#progressMeta").innerText();
  await page.clock.runFor(10_000);
  await expect(page.locator("#progressMeta")).toHaveText(elapsed);
}

async function observeRecoverySchedules(page: Page) {
  // Install after navigation and clock.pauseAt: observe the installed clock,
  // without racing its initialization or replacing production fetch/timers.
  await page.evaluate(() => {
    const observed = window as Window & { __recoverySchedules?: number[] };
    // This callback runs in Chromium, despite Node timer types in the test host.
    type BrowserTimeout = (
      this: Window,
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => number;
    const browser = window as unknown as { setTimeout: BrowserTimeout };
    const original = browser.setTimeout;
    observed.__recoverySchedules = [];
    browser.setTimeout = function (handler, delay, ...args) {
      const id = original.call(this, handler, delay, ...args);
      if (delay === 2000) observed.__recoverySchedules!.push(Date.now());
      return id;
    };
  });
  return () =>
    page.evaluate(() => {
      const observed = window as Window & { __recoverySchedules?: number[] };
      return observed.__recoverySchedules!.slice();
    });
}

test("failed start freezes elapsed time and retry starts a fresh running clock", async ({
  page,
  app,
}) => {
  app.failStart = true;
  await analyze(page);
  await expect(page.locator("#statusMsg")).toContainText("Analysis could not start");
  await expect(page.getByRole("button", { name: "Retry analysis", exact: true })).toBeVisible();
  await expectSettled(page);
  await page.getByRole("button", { name: "Retry analysis", exact: true }).click();
  await expect(page.locator("#phaseRail .active")).toContainText("Scan");
  const initial = await page.locator("#progressMeta").innerText();
  await page.clock.runFor(1000);
  await expect(page.locator("#progressMeta")).not.toHaveText(initial);
  app.send(JSON.stringify({ type: "error", message: "Analysis failed" }));
  await expect(page.locator("#statusMsg")).toContainText("Analysis failed");
  await expectSettled(page);
});

for (const [payload, status] of [
  ["{invalid JSON", "progress data was invalid"],
  [JSON.stringify({ type: "phase" }), "progress event was invalid"],
]) {
  test(`malformed stream settles progress: ${status}`, async ({ page, app }) => {
    await analyze(page);
    await expect(page.locator("#phaseRail .active")).toContainText("Scan");
    await page.clock.runFor(1000);
    app.send(payload);
    await expect(page.locator("#statusMsg")).toContainText(status);
    await expect(page.locator("#phaseRail .error")).toContainText("Scan");
    await expectSettled(page);
  });
}

test("recovery keeps counting until the unchanged polling ceiling, then settles", async ({
  page,
  app,
}) => {
  const schedules = await observeRecoverySchedules(page);
  await analyze(page);
  await expect(page.locator("#phaseRail .active")).toContainText("Scan");
  app.disconnect();
  await expect(page.locator("#statusMsg")).toContainText("Retrying analysis status");
  await expect.poll(async () => (await schedules()).length).toBe(1);
  const initial = await page.locator("#progressMeta").innerText();
  for (let attempt = 1; attempt <= 150; attempt++) {
    if (attempt === 75) app.holdStatus = true;
    await page.clock.runFor(2000);
    await expect.poll(() => app.reads).toBe(attempt);
    if (attempt === 75) {
      expect((await schedules()).length).toBe(attempt);
      app.releaseStatus();
    }
    // Request arrival does not imply that fetch/JSON/catch has completed.
    // Advance only after the next production timeout is actually registered.
    if (attempt < 150) {
      await expect.poll(async () => (await schedules()).length).toBe(attempt + 1);
    }
    if (attempt === 1) {
      await expect(page.locator("#progressMeta")).not.toHaveText(initial);
      await expect(page.locator("#analyzeForm")).toHaveAttribute("aria-busy", "true");
      await expect(page.locator("#phaseRail .active")).toContainText("Scan");
    }
  }
  await expect(page.locator("#statusMsg")).toContainText("Analysis status could not be recovered");
  await expect(page.locator("#phaseRail .error")).toContainText("Scan");
  await expectSettled(page);
  expect(app.reads).toBe(150);
  expect((await schedules()).length).toBe(150);
});

test("request arrival precedes recovery scheduling while a status body is held", async ({
  page,
  app,
}) => {
  const schedules = await observeRecoverySchedules(page);
  app.holdStatus = true;
  await analyze(page);
  await expect(page.locator("#phaseRail .active")).toContainText("Scan");
  app.disconnect();
  await expect(page.locator("#statusMsg")).toContainText("Retrying analysis status");
  await expect.poll(async () => (await schedules()).length).toBe(1);
  await page.clock.runFor(2000);
  await expect.poll(() => app.reads).toBe(1);
  expect((await schedules()).length).toBe(1);

  // Deterministic negative control for the former arrival-only clock advance.
  await page.clock.runFor(2000);
  expect(app.reads).toBe(1);
  expect((await schedules()).length).toBe(1);
  await expect(page.locator("#analyzeForm")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#phaseRail .active")).toContainText("Scan");

  app.releaseStatus();
  await expect.poll(async () => (await schedules()).length).toBe(2);
  expect(app.reads).toBe(1);
  const registered = (await schedules())[1];
  expect(await page.evaluate(() => Date.now())).toBe(registered);
  await page.clock.runFor(1999);
  expect(app.reads).toBe(1);
  await page.clock.runFor(1);
  await expect.poll(() => app.reads).toBe(2);
  await expect.poll(async () => (await schedules()).length).toBe(3);
  expect((await schedules())[2] - registered).toBe(2000);
});
