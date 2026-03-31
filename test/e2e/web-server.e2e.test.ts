import { once } from "events";

import { afterEach, describe, expect, it } from "vitest";

import { getAvailablePort, spawnCli, waitForHttpReady } from "./helpers.js";

describe("web server CLI", () => {
  const children: ReturnType<typeof spawnCli>[] = [];

  afterEach(async () => {
    await Promise.all(
      children.map(async ({ child }) => {
        if (child.exitCode === null) {
          child.kill("SIGTERM");
          await once(child, "close");
        }
      })
    );
    children.length = 0;
  });

  it("serves the local demo app through the real CLI process", async () => {
    const port = await getAvailablePort();
    const serverProcess = spawnCli(["web", "--port", String(port)]);
    children.push(serverProcess);

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHttpReady(`${baseUrl}/`);

    const homeResponse = await fetch(`${baseUrl}/`);
    const homeHtml = await homeResponse.text();
    expect(homeResponse.status).toBe(200);
    expect(homeHtml).toContain("Repo Bootcamp");

    const optionsResponse = await fetch(`${baseUrl}/api/analyze`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
      },
    });
    expect(optionsResponse.status).toBe(200);
    expect(optionsResponse.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000"
    );

    const invalidAnalyzeResponse = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(invalidAnalyzeResponse.status).toBe(400);
  }, 90_000);
});
