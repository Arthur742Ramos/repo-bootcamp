/**
 * Tests for web server and templates
 */

import type { AddressInfo } from "net";

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp, startServer } from "../src/web/server.js";
import { getIndexHtml } from "../src/web/templates.js";

let server: ReturnType<typeof startServer> | undefined;

afterEach(async () => {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
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
    const response = await request(createApp()).get("/");
    expect(response.status).toBe(200);
    expect(response.text).toContain("<h1>Repo Bootcamp</h1>");
  });

  it("handles OPTIONS with CORS headers for localhost origin", async () => {
    const response = await request(createApp())
      .options("/api/analyze")
      .set("Origin", "http://localhost:3000");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("sets CORS headers on regular requests from localhost", async () => {
    const response = await request(createApp()).get("/").set("Origin", "http://localhost:3000");
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-methods"]).toBe("GET, POST, OPTIONS");
  });

  it("sets CORS headers for 127.0.0.1 origin", async () => {
    const response = await request(createApp()).get("/").set("Origin", "http://127.0.0.1:5000");
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5000");
  });

  it("does not set CORS header for non-localhost origins", async () => {
    const response = await request(createApp()).get("/").set("Origin", "https://evil.com");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not set CORS header when no Origin is sent", async () => {
    const response = await request(createApp()).get("/");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sets security headers including CSP", async () => {
    const response = await request(createApp()).get("/");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
  });

  it("rejects analyze requests without repoUrl", async () => {
    const response = await request(createApp())
      .post("/api/analyze")
      .set("Content-Type", "application/json")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("repoUrl is required and must be a string");
  });

  it("rejects analyze requests with invalid repoUrl", async () => {
    const response = await request(createApp())
      .post("/api/analyze")
      .set("Content-Type", "application/json")
      .send({ repoUrl: "not-a-url" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });

  it("rejects non-object analyze request bodies", async () => {
    const response = await request(createApp())
      .post("/api/analyze")
      .set("Content-Type", "application/json")
      .send([]);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Request body must be a JSON object");
  });

  it("rejects non-object options values", async () => {
    const response = await request(createApp())
      .post("/api/analyze")
      .set("Content-Type", "application/json")
      .send({ repoUrl: "https://github.com/owner/repo", options: "bad-options" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("options must be an object when provided");
  });

  it("returns 404 for unknown job status", async () => {
    const response = await request(createApp()).get("/api/jobs/nonexistent");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Job not found");
  });

  it("returns 404 for unknown job stream", async () => {
    const response = await request(createApp()).get("/api/jobs/nonexistent/stream");
    expect(response.status).toBe(404);
  });

  it("returns 404 for unknown job file", async () => {
    const response = await request(createApp()).get("/api/jobs/nonexistent/files/test.md");
    expect(response.status).toBe(404);
    expect(response.body.error).toContain("not found");
  });

  it("rejects overly long repoUrl", async () => {
    const response = await request(createApp())
      .post("/api/analyze")
      .set("Content-Type", "application/json")
      .send({ repoUrl: "https://github.com/o/" + "a".repeat(500) });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("repoUrl too long");
  });

  it("rejects file requests with path traversal (..)", async () => {
    const response = await request(createApp()).get("/api/jobs/test/files/%2e%2e%2fetc%2fpasswd");
    expect([400, 404]).toContain(response.status);
  });

  it("rejects file requests with forward slash in filename", async () => {
    const response = await request(createApp()).get("/api/jobs/test/files/sub/file.md");
    expect(response.status).toBe(404);
  });

  it("rejects file requests with backslash in filename", async () => {
    const response = await request(createApp()).get("/api/jobs/test/files/sub%5Cfile.md");
    expect([400, 404]).toContain(response.status);
  });

  it("enforces API rate limiting", async () => {
    const app = createApp();
    let response = await request(app).get("/api/jobs/nonexistent");
    for (let i = 1; i < 101; i++) {
      response = await request(app).get("/api/jobs/nonexistent");
    }
    expect(response.status).toBe(429);
    expect(response.headers["ratelimit-limit"]).toBeDefined();
  }, 15000);

  it("does not cap non-analysis endpoints at 5 requests", async () => {
    const app = createApp();
    let response = await request(app).get("/api/jobs/nonexistent");
    for (let i = 1; i < 6; i++) {
      response = await request(app).get("/api/jobs/nonexistent");
    }
    expect(response.status).toBe(404);
  });

  it("enforces stricter rate limiting for /api/analyze", async () => {
    const app = createApp();
    let response = await request(app).post("/api/analyze").send({ repoUrl: "not-a-url" });
    for (let i = 1; i < 6; i++) {
      response = await request(app).post("/api/analyze").send({ repoUrl: "not-a-url" });
    }
    expect(response.status).toBe(429);
    expect(response.headers["ratelimit-limit"]).toBeDefined();
  }, 15000);
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

    const response = await request(server).get("/");
    expect(response.status).toBe(200);

    logSpy.mockRestore();
  });
});
