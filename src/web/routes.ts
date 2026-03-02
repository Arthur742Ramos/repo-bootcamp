import type { Application, Request, Response } from "express";
import { EventEmitter } from "events";
import { mkdir, readFile } from "fs/promises";
import { join, resolve } from "path";

import { applyOutputFormat } from "../formatter.js";
import { parseGitHubUrl } from "../ingest.js";
import { ProgressTracker } from "../progress.js";
import { getSecurityGrade } from "../security.js";
import { orchestrateAnalysis, prepareOutputDocuments } from "../services/analysis-orchestration.js";
import { cloneRepository, scanRepositoryFiles, cleanupRepository } from "../services/clone-service.js";
import { resolveRunConfiguration } from "../services/config-resolution.js";
import { writeGeneratedOutputs } from "../services/output-writer.js";
import type { BootcampOptions, RepoFacts } from "../types.js";

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

function buildWebOptions(options: Partial<BootcampOptions>): BootcampOptions {
  return {
    branch: "",
    focus: "all",
    audience: "all",
    output: "",
    maxFiles: 200,
    noClone: false,
    verbose: false,
    ...options,
  };
}

/**
 * Run analysis in background
 */
async function runAnalysis(job: AnalysisJob, options: Partial<BootcampOptions>): Promise<void> {
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
    repoPath = await cloneRepository(repoInfo, fullOptions.branch || undefined, fullOptions.fullClone);
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

    const { documents, facts: preparedFacts, security, radar, deps } = await prepareOutputDocuments({
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
        securityGrade: getSecurityGrade(security.score),
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
    job.error = (error as Error).message;
    emit({ type: "error", message: (error as Error).message });
  } finally {
    progress.stop();
    if (repoPath) {
      try {
        await cleanupRepository(repoPath);
      } catch (cleanupError: unknown) {
        console.error(`[web] Failed to clean up temporary repository: ${(cleanupError as Error).message}`);
      }
    }
  }
}

export function registerRoutes(app: Application): void {
  // Start analysis
  app.post("/api/analyze", async (req: Request, res: Response): Promise<void> => {
    const { repoUrl, options = {} } = req.body;

    if (!repoUrl || typeof repoUrl !== "string") {
      res.status(400).json({ error: "repoUrl is required and must be a string" });
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
      res.status(400).json({ error: (error as Error).message });
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
    runAnalysis(job, options);

    res.json({ jobId: job.id });
  });

  // SSE endpoint for progress
  app.get("/api/jobs/:jobId/stream", (req: Request, res: Response): void => {
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
  app.get("/api/jobs/:jobId", (req: Request, res: Response): void => {
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
  app.get("/api/jobs/:jobId/files/:filename", async (req: Request, res: Response): Promise<void> => {
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
      if (!filePath.startsWith(outputDirResolved + "/") && filePath !== outputDirResolved) {
        res.status(400).json({ error: "Invalid filename" });
        return;
      }
      const content = await readFile(filePath, "utf-8");
      const contentType = filename.endsWith(".json")
        ? "application/json"
        : filename.endsWith(".html")
          ? "text/html"
          : "text/markdown";
      res.setHeader("Content-Type", contentType);
      res.send(content);
    } catch (error: unknown) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
}
