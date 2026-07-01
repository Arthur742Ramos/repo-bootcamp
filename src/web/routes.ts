import type { Application, Request, Response } from "express";
import { EventEmitter } from "events";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { mkdir, readFile } from "fs/promises";
import { join, resolve } from "path";

import { applyOutputFormat, type OutputFormat } from "../formatter.js";
import { parseGitHubUrl } from "../ingest.js";
import { ProgressTracker } from "../progress.js";
import { getSecurityGrade } from "../security.js";
import { orchestrateAnalysis, prepareOutputDocuments } from "../services/analysis-orchestration.js";
import {
  cloneRepository,
  scanRepositoryFiles,
  cleanupRepository,
} from "../services/clone-service.js";
import { resolveRunConfiguration } from "../services/config-resolution.js";
import { writeGeneratedOutputs } from "../services/output-writer.js";
import type { BootcampOptions, RepoFacts } from "../types.js";
import { isPathInsideDir } from "../utils.js";

/**
 * Progress event for SSE
 */
interface ProgressEvent {
  type: "phase" | "progress" | "complete" | "error";
  phase?: string;
  message: string;
  data?: unknown;
}

/**
 * Analysis job
 */
interface AnalysisJob {
  id: string;
  repoUrl: string;
  status: "pending" | "running" | "complete" | "error";
  progress: ProgressEvent[];
  result?: {
    outputDir: string;
    files: string[];
    stats: unknown;
  };
  error?: string;
  completedAt?: number;
  emitter: EventEmitter;
}

// In-memory job storage
const jobs = new Map<string, AnalysisJob>();

const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_JOBS = 100; // Prevent unbounded memory growth

let pruneTimer: NodeJS.Timeout | null = null;

function pruneExpiredJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

export function startJobPruner(): void {
  if (pruneTimer) {
    return;
  }
  pruneTimer = setInterval(pruneExpiredJobs, JOB_TTL_MS);
  pruneTimer.unref();
}

export function stopJobPruner(): void {
  if (!pruneTimer) {
    return;
  }
  clearInterval(pruneTimer);
  pruneTimer = null;
}

/**
 * Generate unique job ID
 */
function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

// Client-supplied analysis options are validated/allowlisted here rather than
// spread verbatim: only known fields are read, enums are checked against their
// allowlists, maxFiles is clamped to a sane range, and resource-amplifying
// levers (fullClone) are forced off. Unknown keys (e.g. model) are dropped.
const WEB_DEFAULT_MAX_FILES = 200;
const WEB_MIN_MAX_FILES = 1;
const WEB_MAX_MAX_FILES = 1000;

const VALID_WEB_FOCUS: readonly BootcampOptions["focus"][] = [
  "onboarding",
  "architecture",
  "contributing",
  "all",
];
const VALID_WEB_AUDIENCE: readonly BootcampOptions["audience"][] = [
  "all",
  "backend",
  "frontend",
  "sre",
];
const VALID_WEB_FORMAT: readonly OutputFormat[] = ["markdown", "html", "pdf"];

function pickAllowedValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function clampMaxFiles(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return WEB_DEFAULT_MAX_FILES;
  }
  return Math.min(Math.max(Math.floor(parsed), WEB_MIN_MAX_FILES), WEB_MAX_MAX_FILES);
}

function buildWebOptions(options: Record<string, unknown>): BootcampOptions {
  return {
    branch: typeof options.branch === "string" ? options.branch : "",
    focus: pickAllowedValue(options.focus, VALID_WEB_FOCUS, "all"),
    audience: pickAllowedValue(options.audience, VALID_WEB_AUDIENCE, "all"),
    output: "",
    maxFiles: clampMaxFiles(options.maxFiles),
    noClone: false,
    verbose: options.verbose === true,
    jsonOnly: options.jsonOnly === true,
    // Never let the web client trigger a full-history clone (disk/CPU/time
    // amplification); the demo always does a shallow clone.
    fullClone: false,
    format: pickAllowedValue(options.format, VALID_WEB_FORMAT, "markdown"),
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function buildRateLimitKey(prefix: string, scope: string, req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || "127.0.0.1";
  return `${prefix}:${scope}:${ipKeyGenerator(ip)}`;
}

/**
 * Run analysis in background
 */
async function runAnalysis(job: AnalysisJob, options: Record<string, unknown>): Promise<void> {
  const emit = (event: ProgressEvent) => {
    job.progress.push(event);
    job.emitter.emit("progress", event);
  };
  const progress = new ProgressTracker(false);
  let repoPath: string | null = null;

  try {
    job.status = "running";
    const fullOptions = buildWebOptions(options);
    const { config, styleConfig, outputFormat } = await resolveRunConfiguration(fullOptions);

    // Parse URL
    emit({ type: "phase", phase: "parse", message: "Parsing repository URL..." });
    const repoInfo = parseGitHubUrl(job.repoUrl);
    emit({ type: "progress", message: `Repository: ${repoInfo.fullName}` });

    // Clone
    emit({ type: "phase", phase: "clone", message: `Cloning ${repoInfo.fullName}...` });
    repoPath = await cloneRepository(
      repoInfo,
      fullOptions.branch || undefined,
      fullOptions.fullClone
    );
    emit({ type: "progress", message: `Cloned (branch: ${repoInfo.branch})` });

    // Scan
    emit({ type: "phase", phase: "scan", message: "Scanning files..." });
    const scanResult = await scanRepositoryFiles(repoPath, fullOptions.maxFiles);
    emit({ type: "progress", message: `Scanned ${scanResult.files.length} files` });
    emit({ type: "progress", message: `Stack: ${scanResult.stack.languages.join(", ")}` });

    // Analyze with Copilot
    emit({ type: "phase", phase: "analyze", message: "Analyzing with AI..." });
    progress.startPhase("analyze");
    const analysisStart = Date.now();
    const analysis = await orchestrateAnalysis({
      repoPath,
      repoInfo,
      scanResult,
      options: fullOptions,
      styleConfig,
      progress,
      analysisStart,
    });
    progress.stop();

    const facts: RepoFacts = {
      ...analysis.facts,
      firstTasks: analysis.facts.firstTasks.slice(0, styleConfig.firstTasksCount),
    };
    if (!facts.stack.packageManager && scanResult.stack.packageManager) {
      facts.stack.packageManager = scanResult.stack.packageManager;
    }
    emit({
      type: "progress",
      message: `Analysis complete (${analysis.toolCalls} tool calls)`,
    });

    // Generate docs
    emit({ type: "phase", phase: "generate", message: "Generating documentation..." });
    progress.startPhase("generate");
    const outputDir = join(process.cwd(), `.bootcamp-output`, job.id, repoInfo.repo);
    await mkdir(outputDir, { recursive: true });

    const {
      documents,
      facts: preparedFacts,
      security,
      radar,
      deps,
      outputTargets,
    } = await prepareOutputDocuments({
      repoPath,
      repoInfo,
      scanResult,
      facts,
      options: fullOptions,
      config,
      styleConfig,
      progress,
    });

    const outputOptions: BootcampOptions = {
      ...fullOptions,
      createIssues: false,
      renderDiagrams: false,
    };
    const { documentCount } = await writeGeneratedOutputs({
      documents,
      repoInfo,
      facts: preparedFacts,
      options: outputOptions,
      outputDir,
      outputFormat,
      progress,
      allowIssueCreation: false,
      outputTargets,
    });
    progress.stop();

    const files = outputOptions.jsonOnly
      ? ["repo_facts.json"]
      : applyOutputFormat(documents, outputFormat).map((doc) => doc.name);
    emit({ type: "progress", message: `Generated ${documentCount} files` });

    // Cleanup
    emit({ type: "phase", phase: "cleanup", message: "Cleaning up..." });
    await cleanupRepository(repoPath);
    repoPath = null;

    // Complete
    job.status = "complete";
    job.completedAt = Date.now();
    job.result = {
      outputDir,
      files,
      stats: {
        toolCalls: analysis.toolCalls,
        model: analysis.model,
        securityScore: security.score,
        securityGrade: getSecurityGrade(security.score, security.sourceFilesScanned),
        riskScore: radar.onboardingRisk.score,
        riskGrade: radar.onboardingRisk.grade,
        dependencies: deps?.totalCount || 0,
      },
    };

    emit({
      type: "complete",
      message: "Bootcamp generated successfully!",
      data: job.result,
    });
  } catch (error: unknown) {
    job.status = "error";
    job.completedAt = Date.now();
    // Log the detailed cause server-side; never expose git stderr / FS paths
    // (which clone/scan errors embed) to the anonymous web client.
    console.error(`[web] Analysis job ${job.id} failed:`, error);
    const message = "Analysis failed. Please check the repository URL and try again.";
    job.error = message;
    emit({ type: "error", message });
  } finally {
    progress.stop();
    if (repoPath) {
      try {
        await cleanupRepository(repoPath);
      } catch (cleanupError: unknown) {
        const message = getErrorMessage(cleanupError, "Unknown cleanup error");
        console.error(`[web] Failed to clean up temporary repository: ${message}`);
      }
    }
  }
}

export function registerRoutes(app: Application): void {
  const limiterKeyPrefix = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const analysisEndpointRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => buildRateLimitKey(limiterKeyPrefix, "analyze", req),
  });
  const defaultApiRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => buildRateLimitKey(limiterKeyPrefix, "api", req),
  });

  // Start analysis
  app.post(
    "/api/analyze",
    analysisEndpointRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        if (!isObjectRecord(req.body)) {
          res.status(400).json({ error: "Request body must be a JSON object" });
          return;
        }

        const repoUrl = req.body.repoUrl;
        const requestOptions = req.body.options;

        if (!repoUrl || typeof repoUrl !== "string") {
          res.status(400).json({ error: "repoUrl is required and must be a string" });
          return;
        }
        if (requestOptions !== undefined && !isObjectRecord(requestOptions)) {
          res.status(400).json({ error: "options must be an object when provided" });
          return;
        }

        // Limit URL length to prevent abuse
        if (repoUrl.length > 500) {
          res.status(400).json({ error: "repoUrl too long" });
          return;
        }

        try {
          parseGitHubUrl(repoUrl); // Validate URL
        } catch (error: unknown) {
          res.status(400).json({ error: getErrorMessage(error, "Invalid repository URL") });
          return;
        }

        const job: AnalysisJob = {
          id: generateJobId(),
          repoUrl,
          status: "pending",
          progress: [],
          emitter: new EventEmitter(),
        };

        // Enforce max jobs cap — evict oldest completed jobs first
        if (jobs.size >= MAX_JOBS) {
          let oldestCompletedId: string | null = null;
          let oldestTime = Infinity;
          for (const [id, j] of jobs) {
            if (j.completedAt && j.completedAt < oldestTime) {
              oldestTime = j.completedAt;
              oldestCompletedId = id;
            }
          }
          if (oldestCompletedId) {
            jobs.delete(oldestCompletedId);
          } else {
            // All jobs are still running — reject to prevent OOM
            res.status(503).json({ error: "Server at capacity, try again later" });
            return;
          }
        }

        jobs.set(job.id, job);

        // Start analysis in background
        const options: Record<string, unknown> = isObjectRecord(requestOptions)
          ? requestOptions
          : {};
        void runAnalysis(job, options);

        res.json({ jobId: job.id });
      } catch (error: unknown) {
        console.error("[web] Failed to start analysis:", error);
        res.status(500).json({ error: "Failed to start analysis" });
      }
    }
  );

  // SSE endpoint for progress
  app.get("/api/jobs/:jobId/stream", defaultApiRateLimit, (req: Request, res: Response): void => {
    const jobId = req.params.jobId as string;
    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Send existing progress
    for (const event of job.progress) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    if (job.status === "complete" || job.status === "error") {
      res.end();
      return;
    }

    // Stream new events
    const onProgress = (event: ProgressEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === "complete" || event.type === "error") {
        res.end();
      }
    };

    job.emitter.on("progress", onProgress);

    req.on("close", () => {
      job.emitter.off("progress", onProgress);
    });
  });

  // Get job status
  app.get("/api/jobs/:jobId", defaultApiRateLimit, (req: Request, res: Response): void => {
    const jobId = req.params.jobId as string;
    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    res.json({
      id: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
    });
  });

  // Get generated file content
  app.get(
    "/api/jobs/:jobId/files/:filename",
    defaultApiRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      const jobId = req.params.jobId as string;
      const filename = req.params.filename as string;

      // Sanitize filename first — reject path traversal attempts before any lookups
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        res.status(400).json({ error: "Invalid filename" });
        return;
      }

      const job = jobs.get(jobId);
      if (!job || !job.result) {
        res.status(404).json({ error: "Job or file not found" });
        return;
      }

      if (!job.result.files.includes(filename)) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      try {
        const filePath = resolve(join(job.result.outputDir, filename));
        const outputDirResolved = resolve(job.result.outputDir);
        if (!isPathInsideDir(outputDirResolved, filePath)) {
          res.status(400).json({ error: "Invalid filename" });
          return;
        }
        const content = await readFile(filePath, "utf-8");
        // Serve every generated file as inert text so repo/LLM-derived content
        // (e.g. a generated .html) can never execute in the dashboard origin.
        // The dashboard only ever consumes these via fetch().text(); combined
        // with the global X-Content-Type-Options: nosniff header this removes
        // the stored-XSS sink without changing what the UI displays.
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.send(content);
      } catch (error: unknown) {
        console.error(
          `[web] Failed to read generated file "${filename}" for job ${jobId}:`,
          error
        );
        res.status(500).json({ error: "Failed to read generated file" });
      }
    }
  );
}
