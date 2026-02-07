/**
 * Tests for web server and templates
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import type { AddressInfo } from "net";

import { createApp, startServer } from "../src/web/server.js";
import { getIndexHtml } from "../src/web/templates.js";

let server: ReturnType<typeof startServer> | undefined;

async function startTestServer(): Promise<string> {
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

describe("getIndexHtml", () => {
  it("returns the demo HTML", () => {
    const html = getIndexHtml();
    expect(html).toContain("<title>Repo Bootcamp</title>");
    expect(html).toContain("function analyze()");
  });
});

describe("createApp", () => {
  it("serves the index page", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("<h1>Repo Bootcamp</h1>");
  });

  it("handles OPTIONS with CORS headers", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/api/analyze`, { method: "OPTIONS" });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects analyze requests without repoUrl", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBe("repoUrl is required");
  });
});

describe("startServer", () => {
  it("listens on the provided port", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    server = startServer(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));

    const address = server.address() as AddressInfo;
    expect(address.port).toBeGreaterThan(0);

    logSpy.mockRestore();
  });
});
