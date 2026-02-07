import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const registerRoutes = vi.hoisted(() => vi.fn());
const getIndexHtml = vi.hoisted(() => vi.fn(() => "<h1>INDEX</h1>"));

vi.mock("../src/web/routes.js", () => ({ registerRoutes }));
vi.mock("../src/web/templates.js", () => ({ getIndexHtml }));

import { createApp, startServer } from "../src/web/server.js";

describe("createApp", () => {
  beforeEach(() => {
    registerRoutes.mockClear();
  });

  it("serves index html with CORS headers", async () => {
    const app = createApp();
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/`);
      const text = await response.text();

      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(text).toContain("INDEX");
      expect(registerRoutes).toHaveBeenCalledWith(app);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("responds to OPTIONS requests", async () => {
    const app = createApp();
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/`, { method: "OPTIONS" });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("startServer", () => {
  it("logs startup information", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const listenSpy = vi
      .spyOn(express.application, "listen")
      .mockImplementation(function (this: express.Application, port: number, cb?: () => void) {
        if (cb) cb();
        return { close: vi.fn() } as any;
      });

    startServer(4321);

    expect(listenSpy).toHaveBeenCalledWith(4321, expect.any(Function));
    const logged = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("Repo Bootcamp Web Demo");
    expect(logged).toContain("http://localhost:4321");

    listenSpy.mockRestore();
    logSpy.mockRestore();
  });
});
