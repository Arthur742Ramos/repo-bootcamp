import type { Application, Request, Response } from "express";
import { EventEmitter } from "events";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { basename, dirname, join, resolve } from "path";

import { applyOutputFormat, type OutputFormat } from "../formatter.js";
import { parseGitHubUrl } from "../ingest.js";
import { quickAsk } from "../interactive.js";
import { generateIssuePreview } from "../issues.js";
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
import { createAnalysisManifest } from "../manifest.js";
import { isPathInsideDir } from "../utils.js";
import { createZipArchive } from "./zip.js";

/**
 * Progress event for SSE
 */
interface ProgressEvent {
  type: "phase" | "progress" | "complete" | "error" | "cancelled";
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
  status: "pending" | "running" | "complete" | "error" | "cancelled";
  progress: ProgressEvent[];
  result?: {
    outputDir: string;
    files: string[];
    stats: unknown;
    manifest?: unknown;
    recommendations?: unknown[];
    quickstartCommands?: unknown[];
    scoreDetails?: {
      security: { findings: number; scannedFiles: number };
      onboardingRisk: { factors: string[] };
    };
    issuePreview?: string;
  };
  error?: string;
  cancelRequested?: boolean;
  startedAt?: number;
  completedAt?: number;
  abortController: AbortController;
  emitter: EventEmitter;
}

// In-memory job storage
const jobs = new Map<string, AnalysisJob>();

const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_JOBS = 100; // Prevent unbounded memory growth

let pruneTimer: NodeJS.Timeout | null = null;

async function removeJob(id: string, job: AnalysisJob): Promise<void> {
  jobs.delete(id);

  if (!job.result?.outputDir) {
    return;
  }

  const outputRoot = resolve(process.cwd(), ".bootcamp-output");
  const jobRoot = resolve(dirname(job.result.outputDir));
  if (
    jobRoot === outputRoot ||
    !isPathInsideDir(outputRoot, jobRoot) ||
    basename(jobRoot) !== job.id
  ) {
    console.error(`[web] Refusing to remove unexpected job output path for ${job.id}`);
    return;
  }

  try {
    await rm(jobRoot, { recursive: true, force: true });
  } catch (error: unknown) {
    console.error(
      `[web] Failed to remove output for expired job ${job.id}: ${getErrorMessage(error, "Unknown cleanup error")}`
    );
  }
}

export async function pruneExpiredJobs(now: number = Date.now()): Promise<void> {
  const removals: Promise<void>[] = [];
  for (const [id, job] of jobs) {
    if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
      removals.push(removeJob(id, job));
    }
  }
  await Promise.all(removals);
}

export function startJobPruner(): void {
  if (pruneTimer) {
    return;
  }
  pruneTimer = setInterval(() => {
    void pruneExpiredJobs().catch((error: unknown) => {
      console.error(
        `[web] Failed to prune expired jobs: ${getErrorMessage(error, "Unknown cleanup error")}`
      );
    });
  }, JOB_TTL_MS);
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
  return `job_${randomUUID()}`;
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

class JobCancelledError extends Error {
  constructor() {
    super("Analysis cancelled");
    this.name = "JobCancelledError";
  }
}

function assertJobActive(job: AnalysisJob): void {
  if (job.cancelRequested || job.abortController.signal.aborted) {
    throw new JobCancelledError();
  }
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
  let outputDir: string | null = null;

  try {
    job.status = "running";
    job.startedAt = Date.now();
    const fullOptions = buildWebOptions(options);
    const { config, styleConfig, outputFormat } = await resolveRunConfiguration(fullOptions);
    assertJobActive(job);

    // Parse URL
    emit({ type: "phase", phase: "parse", message: "Parsing repository URL..." });
    const repoInfo = parseGitHubUrl(job.repoUrl);
    assertJobActive(job);
    emit({ type: "progress", message: `Repository: ${repoInfo.fullName}` });

    // Clone
    emit({ type: "phase", phase: "clone", message: `Cloning ${repoInfo.fullName}...` });
    repoPath = await cloneRepository(
      repoInfo,
      fullOptions.branch || undefined,
      fullOptions.fullClone
    );
    assertJobActive(job);
    emit({ type: "progress", message: `Cloned (branch: ${repoInfo.branch})` });

    // Scan
    emit({ type: "phase", phase: "scan", message: "Scanning files..." });
    const scanResult = await scanRepositoryFiles(repoPath, fullOptions.maxFiles);
    assertJobActive(job);
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
    assertJobActive(job);
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
    outputDir = join(process.cwd(), `.bootcamp-output`, job.id, repoInfo.repo);
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
    assertJobActive(job);

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
    assertJobActive(job);
    progress.stop();

    const generatedFiles = outputOptions.jsonOnly
      ? ["repo_facts.json"]
      : applyOutputFormat(documents, outputFormat).map((doc) => doc.name);
    const runDurationMs = Date.now() - (job.startedAt ?? Date.now());
    const manifest = createAnalysisManifest({
      repoInfo,
      scanResult,
      facts: preparedFacts,
      options: fullOptions,
      format: outputFormat,
      durationMs: runDurationMs,
      model: analysis.model,
      toolCalls: analysis.toolCalls,
    });
    await writeFile(
      join(outputDir, "ANALYSIS_MANIFEST.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
    const files = [...generatedFiles, "ANALYSIS_MANIFEST.json"];
    emit({
      type: "progress",
      message: `Generated ${documentCount + 1} files (including manifest)`,
    });

    // Cleanup
    emit({ type: "phase", phase: "cleanup", message: "Cleaning up..." });
    await cleanupRepository(repoPath);
    repoPath = null;
    assertJobActive(job);

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
        durationMs: runDurationMs,
        commitSha: repoInfo.commitSha ?? null,
        branch: repoInfo.branch,
        repository: repoInfo.fullName,
        filesScanned: scanResult.files.length,
        evidenceSources: manifest.analysis.evidenceSources.length,
      },
      manifest,
      recommendations: (preparedFacts.firstTasks ?? []).slice(0, 3),
      quickstartCommands: (preparedFacts.quickstart?.commands ?? []).slice(0, 6),
      scoreDetails: {
        security: {
          findings: security.findings.length,
          scannedFiles: security.sourceFilesScanned ?? 0,
        },
        onboardingRisk: {
          factors: radar.onboardingRisk.factors.slice(0, 4),
        },
      },
      issuePreview: preparedFacts.firstTasks?.length
        ? generateIssuePreview(preparedFacts.firstTasks, repoInfo)
        : undefined,
    };

    emit({
      type: "complete",
      message: "Bootcamp generated successfully!",
      data: job.result,
    });
  } catch (error: unknown) {
    if (error instanceof JobCancelledError || job.cancelRequested) {
      job.status = "cancelled";
      job.completedAt = Date.now();
      job.error = "Analysis cancelled.";
      emit({ type: "cancelled", message: "Analysis cancelled." });
      return;
    }
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
    if (job.status !== "complete" && outputDir) {
      const outputRoot = resolve(process.cwd(), ".bootcamp-output");
      const jobRoot = resolve(dirname(outputDir));
      if (
        jobRoot !== outputRoot &&
        isPathInsideDir(outputRoot, jobRoot) &&
        basename(jobRoot) === job.id
      ) {
        try {
          await rm(jobRoot, { recursive: true, force: true });
        } catch (cleanupError: unknown) {
          console.error(
            `[web] Failed to remove incomplete output for ${job.id}: ${getErrorMessage(cleanupError, "Unknown cleanup error")}`
          );
        }
      }
    }
  }
}

export function registerRoutes(app: Application): void {
  const limiterKeyPrefix = `web-${randomUUID()}`;
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
        } catch {
          res.status(400).json({
            error: "Enter a public GitHub, GitLab, or Bitbucket repository.",
          });
          return;
        }

        const job: AnalysisJob = {
          id: generateJobId(),
          repoUrl,
          status: "pending",
          progress: [],
          abortController: new AbortController(),
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
            const oldestCompletedJob = jobs.get(oldestCompletedId);
            if (oldestCompletedJob) {
              await removeJob(oldestCompletedId, oldestCompletedJob);
            }
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
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send existing progress
    for (const event of job.progress) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    if (job.status === "complete" || job.status === "error" || job.status === "cancelled") {
      res.end();
      return;
    }

    // Stream new events. Remove the listener on every close path so a browser
    // disconnect cannot retain a response or keep receiving writes after the
    // socket has gone away.
    let streamClosed = false;
    const onProgress = (event: ProgressEvent) => {
      if (streamClosed || res.writableEnded) {
        return;
      }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === "complete" || event.type === "error" || event.type === "cancelled") {
        streamClosed = true;
        job.emitter.off("progress", onProgress);
        if (!res.writableEnded) {
          res.end();
        }
      }
    };

    const cleanupStream = () => {
      if (streamClosed) {
        return;
      }
      streamClosed = true;
      job.emitter.off("progress", onProgress);
    };

    job.emitter.on("progress", onProgress);

    req.once("close", cleanupStream);
    res.once("close", cleanupStream);
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
      repoUrl: job.repoUrl,
      status: job.status,
      result: job.result,
      error: job.error,
      progress: job.progress,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });
  });

  // Answer one grounded follow-up question against a fresh shallow checkout.
  // The completed job keeps generated outputs, not a live repository checkout,
  // so the source is re-cloned only when the user explicitly asks a question.
  app.post(
    "/api/jobs/:jobId/ask",
    defaultApiRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      const jobId = req.params.jobId as string;
      const job = jobs.get(jobId);
      if (!job || !job.result) {
        res.status(404).json({ error: "Job or analysis not found" });
        return;
      }
      if (!isObjectRecord(req.body) || typeof req.body.question !== "string") {
        res.status(400).json({ error: "question is required and must be a string" });
        return;
      }
      const question = req.body.question.trim();
      if (!question) {
        res.status(400).json({ error: "Question cannot be empty" });
        return;
      }
      if (question.length > 1000) {
        res.status(400).json({ error: "Question is too long" });
        return;
      }

      let repoPath: string | null = null;
      try {
        const manifest = job.result.manifest as
          { repository?: { branch?: string }; options?: { maxFiles?: number } } | undefined;
        const repoInfo = parseGitHubUrl(job.repoUrl);
        const branch = manifest?.repository?.branch;
        repoPath = await cloneRepository(repoInfo, branch, false);
        const maxFiles = clampMaxFiles(manifest?.options?.maxFiles);
        const scanResult = await scanRepositoryFiles(repoPath, maxFiles);
        const stats = job.result.stats as { model?: unknown };
        const answer = await quickAsk(
          repoPath,
          repoInfo,
          scanResult,
          question,
          false,
          typeof stats.model === "string" && stats.model !== "cache" ? stats.model : undefined
        );
        res.json({ answer });
      } catch (error: unknown) {
        console.error(`[web] Follow-up question failed for job ${jobId}:`, error);
        res.status(500).json({ error: "Could not answer that question. Try again shortly." });
      } finally {
        if (repoPath) {
          await cleanupRepository(repoPath).catch((error: unknown) => {
            console.error(`[web] Failed to clean up question checkout for job ${jobId}:`, error);
          });
        }
      }
    }
  );

  // Request cancellation. The current analysis stack checks this boundary
  // between expensive phases and always cleans up the temporary checkout.
  app.post("/api/jobs/:jobId/cancel", defaultApiRateLimit, (req: Request, res: Response): void => {
    const jobId = req.params.jobId as string;
    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (job.status === "complete" || job.status === "error" || job.status === "cancelled") {
      res.status(409).json({ error: `Job is already ${job.status}`, status: job.status });
      return;
    }

    job.cancelRequested = true;
    job.abortController.abort();
    const cancellationEvent = {
      type: "progress",
      message: "Cancellation requested…",
    } satisfies ProgressEvent;
    job.progress.push(cancellationEvent);
    job.emitter.emit("progress", cancellationEvent);
    res.status(202).json({ id: job.id, status: "cancelling" });
  });

  // Export the starter-task issue payload without granting an anonymous web
  // session permission to create issues in a repository.
  app.get(
    "/api/jobs/:jobId/issues-preview",
    defaultApiRateLimit,
    (req: Request, res: Response): void => {
      const jobId = req.params.jobId as string;
      const job = jobs.get(jobId);
      if (!job || !job.result || !job.result.issuePreview) {
        res.status(404).json({ error: "Issue preview not found" });
        return;
      }
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="ISSUES_PREVIEW.md"');
      res.send(job.result.issuePreview);
    }
  );

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
        console.error(`[web] Failed to read generated file "${filename}" for job ${jobId}:`, error);
        res.status(500).json({ error: "Failed to read generated file" });
      }
    }
  );

  // Download every generated output as one portable archive.
  app.get(
    "/api/jobs/:jobId/download",
    defaultApiRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      const jobId = req.params.jobId as string;
      const job = jobs.get(jobId);
      if (!job || !job.result) {
        res.status(404).json({ error: "Job or files not found" });
        return;
      }

      try {
        if (
          job.result.files.some(
            (filename) =>
              filename.includes("..") || filename.includes("/") || filename.includes("\\")
          )
        ) {
          res.status(500).json({ error: "Generated file list is invalid" });
          return;
        }
        const entries = await Promise.all(
          job.result.files.map(async (filename) => {
            const fileContent: unknown = await readFile(
              resolve(join(job.result!.outputDir, filename))
            );
            return {
              name: filename,
              content: Buffer.isBuffer(fileContent)
                ? fileContent
                : Buffer.from(
                    typeof fileContent === "string" ? fileContent : String(fileContent),
                    "utf8"
                  ),
            };
          })
        );
        const archive = createZipArchive(entries);
        const repoName =
          String((job.result.stats as { repository?: unknown })?.repository ?? "bootcamp")
            .replace(/[^A-Za-z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "") || "bootcamp";
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${repoName}-bootcamp.zip"`);
        res.send(archive);
      } catch (error: unknown) {
        console.error(`[web] Failed to archive generated files for job ${jobId}:`, error);
        res.status(500).json({ error: "Failed to create download archive" });
      }
    }
  );
}
