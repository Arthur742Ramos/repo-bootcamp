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

// Bind a single server once and drive the request loop through one keep-alive
// agent. Rate-limit assertions need many sequential requests; without this each
// request(app) would spin up (and leak) a fresh ephemeral server + socket,
// exhausting sockets under full-suite parallelism ("socket hang up" flake).
function listenWithAgent(app: ReturnType<typeof createApp>) {
  const srv = app.listen(0);
  const agent = request.agent(srv);
  const close = () => new Promise<void>((resolve) => srv.close(() => resolve()));
  return { agent, close };
}

describe("getIndexHtml", () => {
  it("returns the demo HTML", () => {
    const html = getIndexHtml();
    expect(html).toContain("<title>Repo Bootcamp</title>");
    expect(html).toContain("function analyze()");
  });

  it("escapes a supplied CSP nonce before placing it in attributes", () => {
    const html = getIndexHtml('nonce" onload="alert(1)');
    expect(html).toContain('nonce="nonce&quot; onload=&quot;alert(1)"');
    expect(html).not.toContain('nonce="nonce" onload="alert(1)"');
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
  it("registers rate limits without validation warnings", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createApp();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

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
    expect(response.headers["content-security-policy"]).not.toContain("'unsafe-inline'");
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
    expect(response.body.error).toBe("Enter a public GitHub, GitLab, or Bitbucket repository.");
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
    const { agent, close } = listenWithAgent(createApp());
    try {
      let response = await agent.get("/api/jobs/nonexistent");
      for (let i = 1; i < 101; i++) {
        response = await agent.get("/api/jobs/nonexistent");
      }
      expect(response.status).toBe(429);
      expect(response.headers["ratelimit-limit"]).toBeDefined();
    } finally {
      await close();
    }
  }, 15000);

  it("does not cap non-analysis endpoints at 5 requests", async () => {
    const { agent, close } = listenWithAgent(createApp());
    try {
      let response = await agent.get("/api/jobs/nonexistent");
      for (let i = 1; i < 6; i++) {
        response = await agent.get("/api/jobs/nonexistent");
      }
      expect(response.status).toBe(404);
    } finally {
      await close();
    }
  });

  it("enforces stricter rate limiting for /api/analyze", async () => {
    const { agent, close } = listenWithAgent(createApp());
    try {
      let response = await agent.post("/api/analyze").send({ repoUrl: "not-a-url" });
      for (let i = 1; i < 6; i++) {
        response = await agent.post("/api/analyze").send({ repoUrl: "not-a-url" });
      }
      expect(response.status).toBe(429);
      expect(response.headers["ratelimit-limit"]).toBeDefined();
    } finally {
      await close();
    }
  }, 15000);
});

describe("startServer", () => {
  it("listens on the provided port", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    server = startServer(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));

    const address = server.address() as AddressInfo;
    expect(address.port).toBeGreaterThan(0);
    // Defaults to loopback only, not 0.0.0.0 / all interfaces.
    expect(address.address).toBe("127.0.0.1");

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
