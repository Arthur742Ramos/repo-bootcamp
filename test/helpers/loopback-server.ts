import { once } from "node:events";
import { createServer, type RequestListener, type Server } from "node:http";

const pending = new Map<RequestListener, Promise<Server>>();

/** Reuse each fixture's server, ready on explicit loopback before any request. */
export function listenLoopback(app: RequestListener): Promise<Server> {
  const existing = pending.get(app);
  if (existing) return existing;
  const ready = (async () => {
    const server = createServer(app);
    try {
      const listening = once(server, "listening");
      server.listen(0, "127.0.0.1");
      await listening;
      return server;
    } catch (error) {
      pending.delete(app);
      throw error;
    }
  })();
  pending.set(app, ready);
  return ready;
}

/** Await teardown of only the servers created by this test fixture helper. */
export async function closeLoopbackServers(): Promise<void> {
  const fixtures = [...pending.values()];
  pending.clear();
  // A fixture may still be starting when a test fails. Settle readiness before
  // closing, and still close successful listeners when another failed to bind.
  const results = await Promise.allSettled(fixtures);
  const servers = results
    .filter((result): result is PromiseFulfilledResult<Server> => result.status === "fulfilled")
    .map((result) => result.value);
  await Promise.all(
    servers.map(async (server) => {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    })
  );
}
