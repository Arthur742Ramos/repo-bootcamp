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

  it("contains required UI elements", () => {
    const html = getIndexHtml();
    expect(html).toContain('id="repoUrl"');
    expect(html).toContain('id="analyzeBtn"');
    expect(html).toContain('id="progress"');
    expect(html).toContain('id="results"');
    expect(html).toContain('id="modal"');
  });

  it("includes CSS styles", () => {
    const html = getIndexHtml();
    expect(html).toContain("<style>");
    expect(html).toContain("</style>");
  });

  it("includes JavaScript functions", () => {
    const html = getIndexHtml();
    expect(html).toContain("function streamProgress");
    expect(html).toContain("function showResults");
    expect(html).toContain("function viewFile");
    expect(html).toContain("function closeModal");
  });

  it("has file description mappings", () => {
    const html = getIndexHtml();
    expect(html).toContain("BOOTCAMP");
    expect(html).toContain("ONBOARDING");
    expect(html).toContain("ARCHITECTURE");
    expect(html).toContain("SECURITY");
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
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  it("sets CORS headers on regular requests from localhost", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/`, {
      headers: { Origin: "http://localhost:3000" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
  });

  it("does not set CORS header for non-localhost origins", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/`, {
      headers: { Origin: "https://evil.com" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("sets security headers", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/`);

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
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
    expect(payload.error).toBe("repoUrl is required and must be a string");
  });

  it("rejects analyze requests with invalid repoUrl", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: "not-a-url" }),
    });

    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBeTruthy();
  });

  it("returns 404 for unknown job status", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/api/jobs/nonexistent`);

    const payload = await response.json();
    expect(response.status).toBe(404);
    expect(payload.error).toBe("Job not found");
  });

  it("returns 404 for unknown job stream", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/api/jobs/nonexistent/stream`);

    expect(response.status).toBe(404);
  });

  it("returns 404 for unknown job file", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/api/jobs/nonexistent/files/test.md`);

    const payload = await response.json();
    expect(response.status).toBe(404);
    expect(payload.error).toContain("not found");
  });

  it("registers API routes on the app", async () => {
    const baseUrl = await startTestServer();
    // Verify that POST to /api/analyze exists (returns 400 not 404 without body)
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // 400 means the route exists but input is invalid
    expect(response.status).toBe(400);
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

  it("creates a working Express app", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    server = startServer(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));

    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    expect(response.status).toBe(200);

    logSpy.mockRestore();
  });
});
