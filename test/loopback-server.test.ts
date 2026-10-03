import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { closeLoopbackServers, listenLoopback } from "./helpers/loopback-server.js";

afterEach(closeLoopbackServers);

describe("owned loopback HTTP fixtures", () => {
  it("awaits explicit IPv4 readiness and reuses the same application listener", async () => {
    let calls = 0;
    const app: RequestListener = (_req, res) => res.end(String(++calls));
    const server = await listenLoopback(app);
    expect(server.listening).toBe(true);
    expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
    expect(await listenLoopback(app)).toBe(server);
    expect((await request(server).get("/")).text).toBe("1");
    expect((await request(server).get("/")).text).toBe("2");
  });

  it("settles pending listeners before teardown and creates fresh fixtures afterward", async () => {
    const app: RequestListener = (_req, res) => res.end("ok");
    const pending = listenLoopback(app);
    await closeLoopbackServers();
    const closed = await pending;
    expect(closed.listening).toBe(false);
    expect(closed.address()).toBeNull();
    const fresh = await listenLoopback(app);
    expect(fresh).not.toBe(closed);
    expect((await request(fresh).get("/")).text).toBe("ok");
  });

  it("closes independent fixtures and preserves an externally owned server", async () => {
    const first = await listenLoopback((_req, res) => res.end("first"));
    const second = await listenLoopback((_req, res) => res.end("second"));
    expect(first).not.toBe(second);
    const external = createServer((_req, res) => res.end("external"));
    const listening = once(external, "listening");
    external.listen(0, "127.0.0.1");
    await listening;
    try {
      await closeLoopbackServers();
      expect(first.listening).toBe(false);
      expect(second.listening).toBe(false);
      expect((await request(external).get("/")).text).toBe("external");
      await closeLoopbackServers();
    } finally {
      await new Promise<void>((resolve, reject) =>
        external.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
