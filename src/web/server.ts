/**
 * Local Demo Server
 * Express-based web interface for Repo Bootcamp
 */

import express, { Request, Response } from "express";
import chalk from "chalk";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { getIndexHtml } from "./templates.js";
import { registerRoutes, startJobPruner, stopJobPruner } from "./routes.js";

const DEFAULT_PORT = 3000;

/**
 * Create Express app
 */
export function createApp(): express.Application {
  const app = express();
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

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
    res.send(getIndexHtml());
  });

  registerRoutes(app);

  return app;
}

/**
 * Start the server
 */
export function startServer(port: number = DEFAULT_PORT): ReturnType<express.Application["listen"]> {
  const app = createApp();

  const server = app.listen(port, () => {
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
