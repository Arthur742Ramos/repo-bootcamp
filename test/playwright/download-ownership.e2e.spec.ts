import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";

import { expect, test as base, type Page } from "@playwright/test";

import { getIndexHtml } from "../../src/web/templates.js";
import { createZipArchive } from "../../src/web/zip.js";

const actions = [
  {
    id: "downloadAllBtn",
    route: "download",
    label: "Download kit",
    success: "Downloaded!",
    failure: "Download failed",
  },
  {
    id: "issuesPreviewBtn",
    route: "issues-preview",
    label: "Download issue preview",
    success: "Preview downloaded!",
    failure: "Preview failed",
  },
] as const;
type Action = (typeof actions)[number];

function result(jobId: string) {
  return {
    files: ["BOOTCAMP.md"],
    issuePreview: "# Owned issue preview\n",
    stats: {
      securityScore: 85,
      securityGrade: "B",
      riskScore: 18,
      riskGrade: "A",
      dependencies: 3,
    },
    manifest: { repository: { fullName: "audit/" + jobId, branch: "main", provider: "github" } },
  };
}

function artifactBytes(jobId: string, action: Action) {
  const content = Buffer.from("# Owned " + jobId + "\n");
  return action.route === "download"
    ? createZipArchive([{ name: "BOOTCAMP.md", content }])
    : content;
}

type Fixture = {
  complete: (jobId: string, failed?: boolean) => Promise<void>;
  baseUrl: string;
  requests: string[];
  stall: (phase: "headers" | "body") => void;
  closedTransports: string[];
};

const test = base.extend<{ app: Fixture }>({
  app: async ({ page }, use) => {
    let jobs = 0;
    const streams = new Map<string, ServerResponse>();
    const requests: string[] = [];
    let stalledPhase: "headers" | "body" | null = null;
    const closedTransports: string[] = [];
    const server = createServer(async (req, res) => {
      const path = new URL(req.url!, "http://fixture.test").pathname;
      const json = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (path === "/") {
        const nonce = "owned-download-fixture";
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self' 'nonce-" +
            nonce +
            "'; script-src-attr 'none'; style-src 'self' 'nonce-" +
            nonce +
            "'; style-src-attr 'none'; connect-src 'self'",
        });
        res.end(getIndexHtml(nonce));
      } else if (path === "/favicon.ico") {
        res.writeHead(204).end();
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
      } else if (actions.some((action) => path.endsWith("/" + action.route))) {
        requests.push(path);
        const action = actions.find((entry) => path.endsWith("/" + entry.route))!;
        const jobId = path.split("/").at(-2)!;
        if (stalledPhase !== null) {
          const phase = stalledPhase;
          stalledPhase = null;
          res.on("close", () => closedTransports.push(path));
          if (phase === "body") {
            res.writeHead(200, { "Content-Type": "application/octet-stream" });
            res.write("partial body");
          }
          return;
        }
        res.writeHead(200, {
          "Content-Type": action.route === "download" ? "application/zip" : "text/markdown",
          "Content-Disposition": 'attachment; filename="' + jobId + '-bootcamp.zip"',
        });
        res.end(artifactBytes(jobId, action));
      } else if (path === "/api/jobs/saved-job") {
        json({
          id: "saved-job",
          repoUrl: "https://github.com/audit/saved-job",
          status: "complete",
        });
      } else {
        res.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture port unavailable");
    const baseUrl = "http://127.0.0.1:" + address.port;

    // Buffer real HTTP responses at headers or body consumption. By default
    // ignore cancellation in the transport so late completions exercise run
    // guards independently of AbortController. Separate controls honor abort.
    await page.addInitScript({
      content: `
      window.__artifactStates = [];
      window.__artifactMode = 'headers';
      window.__artifactFailure = false;
      window.__honorArtifactAbort = false;
      window.__artifactTimers = [];
      const nativeTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 1500) window.__artifactTimers.push(callback);
        return nativeTimeout(callback, delay, ...args);
      };
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        if (!/\\/(download|issues-preview)$/.test(String(input))) return nativeFetch(input, init);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const state = { ready: false, settled: false, aborted: false, release, mode: window.__artifactMode, failure: window.__artifactFailure };
        window.__artifactStates.push(state);
        if (init && init.signal) init.signal.addEventListener('abort', () => { state.aborted = true; });
        const transport = { ...init };
        if (!window.__honorArtifactAbort) delete transport.signal;
        try {
          const response = await nativeFetch(input, transport);
          const blob = await response.clone().blob();
          response.blob = async () => {
            if (state.mode === 'body') { state.ready = true; await gate; }
            try {
              if (state.failure) throw new Error('Owned artifact failure');
              return blob;
            } finally { setTimeout(() => { state.settled = true; }, 0); }
          };
          if (state.mode === 'headers') {
            state.ready = true;
            await gate;
            if (state.failure) throw new Error('Owned artifact failure');
            setTimeout(() => { state.settled = true; }, 0);
          }
          return response;
        } catch (error) {
          setTimeout(() => { state.settled = true; }, 0);
          throw error;
        }
      };
    `,
    });
    try {
      await page.goto(baseUrl);
      await use({
        baseUrl,
        requests,
        stall: (phase) => {
          stalledPhase = phase;
        },
        closedTransports,
        complete: async (jobId, failed = false) => {
          await expect.poll(() => streams.has(jobId)).toBe(true);
          streams.get(jobId)!.end(
            "data: " +
              JSON.stringify({
                type: failed ? "error" : "complete",
                message: failed ? "Owned analysis failure" : "Analysis complete",
                data: result(jobId),
              }) +
              "\n\n"
          );
        },
      });
    } finally {
      await page.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
});

async function analyze(page: Page, app: Fixture, jobId: string, failed = false) {
  await page
    .getByRole("textbox", { name: "Repository URL", exact: true })
    .fill("https://github.com/audit/" + jobId);
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await app.complete(jobId, failed);
  if (failed) await expect(page.getByRole("button", { name: "Retry analysis" })).toBeVisible();
  else await expect(page.locator("#resultMeta")).toContainText("audit/" + jobId);
}

async function pending(
  page: Page,
  action: Action,
  index: number,
  mode = "headers",
  failure = false
) {
  await page.evaluate(
    ({ mode, failure }) => {
      (window as any).__artifactMode = mode;
      (window as any).__artifactFailure = failure;
    },
    { mode, failure }
  );
  await page.locator("#" + action.id).click();
  await page.waitForFunction((index) => (window as any).__artifactStates[index]?.ready, index);
  await expect(page.locator("#" + action.id)).toBeDisabled();
  await expect(page.locator("#" + action.id)).toHaveText("Preparing…");
}

async function release(page: Page, index: number) {
  await page.evaluate((index) => (window as any).__artifactStates[index].release(), index);
  await page.waitForFunction((index) => (window as any).__artifactStates[index].settled, index);
}

for (const action of actions) {
  for (const mode of ["headers", "body"]) {
    for (const failure of [false, true]) {
      test(`${action.route} late ${mode} ${failure ? "error" : "success"} cannot affect a new pending download`, async ({
        page,
        app,
      }) => {
        const downloads: string[] = [];
        page.on("download", (download) => downloads.push(download.suggestedFilename()));
        await analyze(page, app, "job-1");
        await pending(page, action, 0, mode, failure);
        await analyze(page, app, "job-2");
        await expect(page.locator("#" + action.id)).toBeEnabled();
        await expect(page.locator("#" + action.id)).toHaveText(action.label);
        await pending(page, action, 1);
        const progress = await page.locator("#progressItems").textContent();
        await release(page, 0);
        await expect(page.locator("#" + action.id)).toHaveText("Preparing…");
        await expect(page.locator("#" + action.id)).toBeDisabled();
        await expect(page.locator("#progressItems")).toHaveText(progress!);
        expect(downloads).toEqual([]);
        expect(await page.evaluate(() => (window as any).__artifactStates[0].aborted)).toBe(true);
        const downloadPromise = page.waitForEvent("download");
        await release(page, 1);
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe(
          action.route === "download" ? "job-2-bootcamp.zip" : "ISSUES_PREVIEW.md"
        );
        const path = await download.path();
        expect(await readFile(path!)).toEqual(artifactBytes("job-2", action));
      });
    }
  }

  test(`${action.route} clears obsolete feedback timers before a newer request`, async ({
    page,
    app,
  }) => {
    await analyze(page, app, "job-1");
    await pending(page, action, 0);
    const downloadPromise = page.waitForEvent("download");
    await release(page, 0);
    await downloadPromise;
    await expect(page.locator("#" + action.id)).toHaveText(action.success);
    await analyze(page, app, "job-2");
    await pending(page, action, 1);
    // An already queued obsolete callback must also honor ownership, even
    // though normal replacement clears the old timeout.
    await page.evaluate(() => (window as any).__artifactTimers[0]());
    // Advance the actual feedback deadline rather than accepting an immediate
    // assertion that could miss an old timer unlocking the newer request.
    await page.waitForTimeout(1800);
    await expect(page.locator("#" + action.id)).toHaveText("Preparing…");
    await expect(page.locator("#" + action.id)).toBeDisabled();
  });

  test(`${action.route} preserves current failure feedback and a real retry download`, async ({
    page,
    app,
  }) => {
    await analyze(page, app, "job-1");
    await pending(page, action, 0, "body", true);
    await release(page, 0);
    await expect(page.locator("#" + action.id)).toHaveText(action.failure);
    await expect(page.locator("#progressItems")).toContainText("Owned artifact failure");
    await expect(page.locator("#" + action.id)).toHaveText(action.label);
    await expect(page.locator("#" + action.id)).toBeEnabled();
    await pending(page, action, 1);
    const downloadPromise = page.waitForEvent("download");
    await release(page, 1);
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      action.route === "download" ? "job-1-bootcamp.zip" : "ISSUES_PREVIEW.md"
    );
    expect(await readFile((await download.path())!)).toEqual(artifactBytes("job-1", action));
  });

  test(`${action.route} same-job recovered result keeps its active request owned`, async ({
    page,
    app,
  }) => {
    await analyze(page, app, "job-1");
    await pending(page, action, 0, "body");
    // Result rendering is shared by stream completion and status recovery;
    // exercise a repeated same-job render without beginning a replacement run.
    await page.evaluate((data) => (window as any).showResults(data), result("job-1"));
    await expect(page.locator("#" + action.id)).toBeDisabled();
    await expect(page.locator("#" + action.id)).toHaveText("Preparing…");
    expect(await page.evaluate(() => (window as any).__artifactStates[0].aborted)).toBe(false);
    const downloadPromise = page.waitForEvent("download");
    await release(page, 0);
    const download = await downloadPromise;
    expect(await readFile((await download.path())!)).toEqual(artifactBytes("job-1", action));
    expect(app.requests).toHaveLength(1);
  });

  for (const phase of ["headers", "body"] as const) {
    test(`${action.route} replacement aborts a real stalled ${phase} transport`, async ({
      page,
      app,
    }) => {
      await analyze(page, app, "job-1");
      await page.evaluate(() => {
        (window as any).__honorArtifactAbort = true;
      });
      app.stall(phase);
      await page.locator("#" + action.id).click();
      await expect.poll(() => app.requests.length).toBe(1);
      await analyze(page, app, "job-2");
      await expect.poll(() => app.closedTransports.length).toBe(1);
      await page.waitForFunction(() => (window as any).__artifactStates[0].settled);
      expect(await page.evaluate(() => (window as any).__artifactStates[0].aborted)).toBe(true);
      await expect(page.locator("#" + action.id)).toBeEnabled();
      await expect(page.locator("#" + action.id)).toHaveText(action.label);
      await expect(page.locator("#progressItems")).not.toContainText("aborted");
    });
  }
}

test("rapid replacement and failed-run keyboard retry reset both artifact actions", async ({
  page,
  app,
}) => {
  await analyze(page, app, "job-1");
  await pending(page, actions[0], 0);
  await pending(page, actions[1], 1, "body");
  await analyze(page, app, "job-2", true);
  await page
    .getByRole("textbox", { name: "Repository URL", exact: true })
    .fill("https://github.com/audit/job-3");
  await page.getByRole("button", { name: "Retry analysis" }).press("Enter");
  await app.complete("job-3");
  await expect(page.locator("#resultMeta")).toContainText("audit/job-3");
  await release(page, 0);
  await release(page, 1);
  for (const action of actions) {
    await expect(page.locator("#" + action.id)).toBeEnabled();
    await expect(page.locator("#" + action.id)).toHaveText(action.label);
  }
  await expect(page.locator("#progressItems")).not.toContainText("Owned artifact failure");
});

test("restoring another job aborts pending artifact requests and resets controls", async ({
  page,
  app,
}) => {
  await analyze(page, app, "job-1");
  await pending(page, actions[0], 0);
  await pending(page, actions[1], 1, "body");
  // The actual restore handler calls beginRun only after its lookup is owned.
  await page.evaluate(() => {
    localStorage.setItem("repo-bootcamp-job-id", "saved-job");
    void (window as any).restoreJob();
  });
  await app.complete("saved-job");
  await expect(page.locator("#resultMeta")).toContainText("audit/saved-job");
  await release(page, 0);
  await release(page, 1);
  for (const action of actions) {
    await expect(page.locator("#" + action.id)).toBeEnabled();
    await expect(page.locator("#" + action.id)).toHaveText(action.label);
  }
});
