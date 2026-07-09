/**
 * Local Demo Server
 * Express-based web interface for Repo Bootcamp
 */

import express, { Request, Response } from "express";
import chalk from "chalk";
import helmet from "helmet";
import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";

import { getIndexHtml } from "./templates.js";
import { registerRoutes, startJobPruner, stopJobPruner } from "./routes.js";

const DEFAULT_PORT = 3000;
// Bind to loopback by default so the demo is not reachable from the LAN/VPN.
// CORS only governs browser cross-origin reads, not who can reach the socket,
// so the localhost-only intent must be enforced at the bind address. A
// `--host` override can be wired through this parameter for opt-in exposure.
const DEFAULT_HOST = "127.0.0.1";

function getNonceDirective(res: ServerResponse): string {
  if (!("locals" in res)) {
    throw new Error("CSP nonce is unavailable");
  }
  const locals = res.locals;
  if (
    typeof locals !== "object" ||
    locals === null ||
    !("cspNonce" in locals) ||
    typeof locals.cspNonce !== "string"
  ) {
    throw new Error("CSP nonce is unavailable");
  }
  return `'nonce-${locals.cspNonce}'`;
}

/**
 * Create Express app
 */
export function createApp(): express.Application {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.cspNonce = randomBytes(32).toString("base64");
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", (_req, res) => getNonceDirective(res)],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", (_req, res) => getNonceDirective(res)],
          styleSrcAttr: ["'none'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(express.json({ limit: "1mb", strict: false }));

  // CORS for local development — restrict to localhost origins only
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
    if (origin && allowedOriginPattern.test(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    // Basic security headers
    res.header("X-Content-Type-Options", "nosniff");
    res.header("X-Frame-Options", "DENY");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Serve static HTML
  app.get("/", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.send(getIndexHtml(res.locals.cspNonce));
  });

  registerRoutes(app);

  return app;
}

/**
 * Start the server
 */
export function startServer(
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST
): ReturnType<express.Application["listen"]> {
  const app = createApp();

  const server = app.listen(port, host, () => {
    startJobPruner();
    console.log(chalk.bold.cyan("\n=== Repo Bootcamp Web Demo ===\n"));
    console.log(chalk.white(`Server running at: ${chalk.underline(`http://localhost:${port}`)}`));
    console.log(chalk.gray("\nOpen your browser to analyze a repository.\n"));
    console.log(chalk.gray("Press Ctrl+C to stop the server.\n"));
  });
  server.on("close", () => {
    stopJobPruner();
  });

  return server;
}
