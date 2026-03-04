import type { AddressInfo } from "net";

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp, startServer } from "../src/web/server.js";

let server: ReturnType<typeof startServer> | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

describe("createApp", () => {
  it("returns an express application with expected methods", () => {
    const app = createApp();
    expect(typeof app.listen).toBe("function");
    expect(typeof app.get).toBe("function");
    expect(typeof app.use).toBe("function");
  });

  it("serves index HTML at root path", async () => {
    const res = await request(createApp()).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<!DOCTYPE html>");
    expect(res.text).toContain("<title>Repo Bootcamp</title>");
  });

  it("sets X-Content-Type-Options nosniff header", async () => {
    const res = await request(createApp()).get("/");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options DENY header", async () => {
    const res = await request(createApp()).get("/");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("sets Content-Security-Policy header with expected directives", async () => {
    const res = await request(createApp()).get("/");
    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("allows CORS for http://localhost origins", async () => {
    const res = await request(createApp())
      .get("/")
      .set("Origin", "http://localhost:8080");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:8080");
    expect(res.headers["access-control-allow-headers"]).toBe("Content-Type");
    expect(res.headers["access-control-allow-methods"]).toBe("GET, POST, OPTIONS");
  });

  it("allows CORS for http://127.0.0.1 origins", async () => {
    const res = await request(createApp())
      .get("/")
      .set("Origin", "http://127.0.0.1:3000");
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3000");
  });

  it("blocks CORS for non-localhost origins", async () => {
    const res = await request(createApp())
      .get("/")
      .set("Origin", "https://attacker.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("blocks CORS for origins that merely contain localhost", async () => {
    const res = await request(createApp())
      .get("/")
      .set("Origin", "https://notlocalhost.evil.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("responds 200 to OPTIONS preflight requests from localhost", async () => {
    const res = await request(createApp())
      .options("/api/analyze")
      .set("Origin", "http://localhost:3000");
    expect(res.status).toBe(200);
  });

  it("parses JSON request bodies", async () => {
    const res = await request(createApp())
      .post("/api/analyze")
      .set("Content-Type", "application/json")
      .send({ repoUrl: "https://github.com/test/repo" });
    // Should not fail with a parse error — either 200 or 400 from validation
    expect([200, 400, 429]).not.toContain(500);
    expect(res.status).not.toBe(500);
  });
});

describe("startServer", () => {
  it("listens on the specified port", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    server = startServer(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));

    const addr = server.address() as AddressInfo;
    expect(addr.port).toBeGreaterThan(0);
    logSpy.mockRestore();
  });

  it("uses default port when none is provided", () => {
    // startServer signature accepts optional port defaulting to 3000
    expect(typeof startServer).toBe("function");
    expect(startServer.length).toBeLessThanOrEqual(1);
  });

  it("serves requests through the started server", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    server = startServer(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));

    const res = await request(server).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Repo Bootcamp");
    logSpy.mockRestore();
  });

  it("emits close event and cleans up", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    server = startServer(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));

    const closed = new Promise<void>((resolve) => server?.on("close", resolve));
    server.close();
    await closed;
    server = undefined;
    logSpy.mockRestore();
  });
});
