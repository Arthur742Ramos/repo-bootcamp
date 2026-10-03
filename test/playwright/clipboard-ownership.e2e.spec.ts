import { once } from "node:events";
import { createServer } from "node:http";

import { expect, test as base, type Page } from "@playwright/test";

import { getIndexHtml } from "../../src/web/templates.js";

const docs: Record<string, string> = {
  "BOOTCAMP.md": "# Overview\n\nThe overview source.\n",
  "ONBOARDING.md": "# Setup\n\nThe setup source.\n",
};

const test = base.extend<{ app: string }>({
  app: async ({ page }, use) => {
    let jobs = 0;
    const server = createServer(async (req, res) => {
      const path = new URL(req.url!, "http://fixture.test").pathname;
      const json = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (path === "/") {
        const nonce = "owned-clipboard-fixture";
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Content-Security-Policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; script-src-attr 'none'; style-src 'self' 'nonce-${nonce}'; style-src-attr 'none'; connect-src 'self'`,
        });
        res.end(getIndexHtml(nonce));
      } else if (path === "/api/analyze") {
        for await (const _chunk of req) {
          /* consume the owned request */
        }
        json({ jobId: "job-" + ++jobs });
      } else if (path.endsWith("/stream")) {
        const jobId = path.split("/").at(-2)!;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          "data: " +
            JSON.stringify({
              type: "complete",
              message: "Owned analysis complete",
              data: {
                files: Object.keys(docs),
                stats: {
                  securityScore: 85,
                  securityGrade: "B",
                  riskScore: 18,
                  riskGrade: "A",
                  dependencies: 3,
                },
                manifest: { repository: { fullName: "audit/" + jobId, branch: "main" } },
                quickstartCommands: [{ name: "test", command: "npm test " + jobId }],
              },
            }) +
            "\n\n"
        );
      } else if (path.includes("/files/")) {
        const name = decodeURIComponent(path.split("/").at(-1)!);
        json({ content: docs[name], html: "<h1>" + name + "</h1>" });
      } else {
        res.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No fixture port");
    await page.addInitScript(() => {
      const state = window as any;
      state.ownedCopies = [];
      state.ownedFallbacks = [];
      state.ownedFallbackSuccess = false;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText(text: string) {
            return new Promise((resolve, reject) =>
              state.ownedCopies.push({ text, resolve, reject })
            );
          },
        },
      });
      document.execCommand = () => {
        state.ownedFallbacks.push(document.querySelector("textarea")?.value);
        return state.ownedFallbackSuccess;
      };
    });
    const url = "http://127.0.0.1:" + address.port;
    try {
      await page.goto(url);
      await page.clock.install();
      await page.clock.pauseAt(new Date());
      await use(url);
    } finally {
      await page.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
});

async function analyze(page: Page, id: number) {
  await page.locator("#repoUrl").fill("https://github.com/audit/job-" + id);
  await page.locator("#analyzeBtn").click();
  await expect(page.locator("#resultMeta")).toContainText("audit/job-" + id);
}
async function settle(page: Page, index: number, rejected = false) {
  await page.evaluate(
    ({ index, rejected }) => {
      const call = (window as any).ownedCopies[index];
      if (rejected) call.reject(new Error("Owned clipboard rejection"));
      else call.resolve();
    },
    { index, rejected }
  );
}
async function file(page: Page, name: string) {
  await page.locator(`#files [data-file="${name}"]`).click();
  await expect(page.locator("#copyBtn")).toBeEnabled();
}
async function fallbackCount(page: Page) {
  return page.evaluate(() => (window as any).ownedFallbacks.length);
}

test("copies the displayed result despite an edited draft and retries current failures", async ({
  page,
  app: _app,
}) => {
  await analyze(page, 1);
  const displayed = await page.locator("#cliCommand").textContent();
  await page.locator("#repoUrl").fill("https://github.com/audit/future-draft");
  await page.locator("#copyCommandBtn").click();
  expect(await page.evaluate(() => (window as any).ownedCopies[0].text)).toBe(displayed);
  await settle(page, 0, true);
  await expect(page.locator("#copyCommandBtn")).toHaveText("Copy failed");
  expect(await fallbackCount(page)).toBe(1);
  await page.clock.runFor(1500);
  await expect(page.locator("#copyCommandBtn")).toBeEnabled();
  await page.locator("#copyCommandBtn").click();
  await settle(page, 1);
  await expect(page.locator("#copyCommandBtn")).toHaveText("Copied!");
});

for (const rejected of [false, true]) {
  test(`new results own CLI copy after old ${rejected ? "rejection" : "success"}`, async ({
    page,
    app: _app,
  }) => {
    await analyze(page, 1);
    await page.locator("#copyCommandBtn").click();
    await analyze(page, 2);
    await expect(page.locator("#copyCommandBtn")).toHaveText("Copy");
    await expect(page.locator("#copyCommandBtn")).toBeEnabled();
    await page.locator("#copyCommandBtn").click();
    await settle(page, 0, rejected);
    await expect(page.locator("#copyCommandBtn")).toHaveText("Copying…");
    await expect(page.locator("#copyCommandBtn")).toBeDisabled();
    expect(await fallbackCount(page)).toBe(0);
    expect(await page.evaluate(() => (window as any).ownedCopies[1].text)).toContain("audit/job-2");
    await settle(page, 1);
    await expect(page.locator("#copyCommandBtn")).toHaveText("Copied!");
    await page.clock.runFor(1500);
    await expect(page.locator("#copyCommandBtn")).toHaveText("Copy");
    await expect(page.locator("#copyCommandBtn")).toBeEnabled();
  });
  test(`new files own Copy after old ${rejected ? "rejection" : "success"}`, async ({
    page,
    app: _app,
  }) => {
    await analyze(page, 1);
    await file(page, "BOOTCAMP.md");
    await page.locator("#copyBtn").click();
    await page.locator("#closeBtn").click();
    await file(page, "ONBOARDING.md");
    await page.locator("#copyBtn").click();
    await settle(page, 0, rejected);
    await expect(page.locator("#copyBtn")).toHaveText("Copying…");
    await expect(page.locator("#copyBtn")).toBeDisabled();
    expect(await fallbackCount(page)).toBe(0);
    expect(await page.evaluate(() => (window as any).ownedCopies[1].text)).toBe(
      docs["ONBOARDING.md"]
    );
    await settle(page, 1);
    await expect(page.locator("#copyBtn")).toHaveText("Copied!");
  });
}

for (const button of ["copyCommandBtn", "copyBtn"]) {
  test(`${button} old reset cannot enable a newer pending copy`, async ({ page, app: _app }) => {
    await analyze(page, 1);
    if (button === "copyBtn") await file(page, "BOOTCAMP.md");
    await page.locator("#" + button).click();
    await settle(page, 0);
    await expect(page.locator("#" + button)).toHaveText("Copied!");
    await page.clock.runFor(1000);
    if (button === "copyBtn") {
      await page.locator("#closeBtn").click();
      await file(page, "BOOTCAMP.md"); // same filename still has a new reading context
    } else await analyze(page, 2);
    await page.locator("#" + button).click();
    await page.clock.runFor(500);
    await expect(page.locator("#" + button)).toHaveText("Copying…");
    await expect(page.locator("#" + button)).toBeDisabled();
    await settle(page, 1, true);
    await expect(page.locator("#" + button)).toHaveText("Copy failed");
    await page.clock.runFor(1500);
    await expect(page.locator("#" + button)).toBeEnabled();
  });
}

test("closing or replacing a run prevents obsolete clipboard timeout fallbacks", async ({
  page,
  app: _app,
}) => {
  await analyze(page, 1);
  await file(page, "BOOTCAMP.md");
  await page.locator("#copyBtn").click();
  await page.keyboard.press("Escape");
  await page.clock.runFor(1000);
  expect(await fallbackCount(page)).toBe(0);
  await expect(page.locator("#copyBtn")).toBeDisabled();
  await page.locator("#copyCommandBtn").click();
  await analyze(page, 2);
  await page.clock.runFor(1000);
  expect(await fallbackCount(page)).toBe(0);
  await expect(page.locator("#copyCommandBtn")).toHaveText("Copy");
  await expect(page.locator("#copyCommandBtn")).toBeEnabled();
});

test("First commands keep per-row feedback and suppress detached fallback", async ({
  page,
  app: _app,
}) => {
  await analyze(page, 1);
  await page.locator("#quickstartCommands button").click();
  await analyze(page, 2);
  await settle(page, 0, true);
  expect(await fallbackCount(page)).toBe(0);
  await expect(page.locator("#quickstartCommands button")).toHaveText("Copy");
  await expect(page.locator("#quickstartCommands button")).toBeEnabled();
  await page.locator("#quickstartCommands button").click();
  await page.evaluate(() => {
    (window as any).ownedFallbackSuccess = true;
  });
  await page.clock.runFor(1000);
  await expect(page.locator("#quickstartCommands button")).toHaveText("Copied!");
  expect(await page.evaluate(() => (window as any).ownedFallbacks)).toEqual(["npm test job-2"]);
  await page.clock.runFor(1500);
  await expect(page.locator("#quickstartCommands button")).toBeEnabled();
});

test("unavailable native clipboard preserves same-file legacy copying", async ({
  page,
  app: _app,
}) => {
  await analyze(page, 1);
  await file(page, "ONBOARDING.md");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    (window as any).ownedFallbackSuccess = true;
  });
  await page.locator("#copyBtn").click();
  await expect(page.locator("#copyBtn")).toHaveText("Copied!");
  expect(await page.evaluate(() => (window as any).ownedFallbacks)).toEqual([
    docs["ONBOARDING.md"],
  ]);
  await page.clock.runFor(1500);
  await expect(page.locator("#copyBtn")).toHaveText("Copy");
  await expect(page.locator("#copyBtn")).toBeEnabled();
});
