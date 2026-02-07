/**
 * Local Demo Server
 * Express-based web interface for Repo Bootcamp
 */

import express, { Request, Response } from "express";
import chalk from "chalk";

import { getIndexHtml } from "./templates.js";
import { registerRoutes } from "./routes.js";

const DEFAULT_PORT = 3000;

/**
 * Create Express app
 */
export function createApp(): express.Application {
  const app = express();
  app.use(express.json());

  // CORS for local development
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
    console.log(chalk.bold.cyan("\n=== Repo Bootcamp Web Demo ===\n"));
    console.log(chalk.white(`Server running at: ${chalk.underline(`http://localhost:${port}`)}`));
    console.log(chalk.gray("\nOpen your browser to analyze a repository.\n"));
    console.log(chalk.gray("Press Ctrl+C to stop the server.\n"));
  });

  return server;
}
