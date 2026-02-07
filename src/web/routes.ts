import type { Application, Request, Response } from "express";
import { EventEmitter } from "events";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";

import { parseGitHubUrl, cloneRepo, scanRepo, mergeFrameworksFromDeps } from "../ingest.js";
import { analyzeRepo, type AnalysisStats } from "../agent.js";
import { readCache, writeCache } from "../cache.js";
import { extractDependencies, generateDependencyDocs } from "../deps.js";
import { analyzeSecurityPatterns, generateSecurityDocs, getSecurityGrade } from "../security.js";
import { generateTechRadar, generateRadarDocs } from "../radar.js";
import { applyOutputFormat, type OutputFormat } from "../formatter.js";
import {
  generateBootcamp,
  generateOnboarding,
  generateArchitecture,
  generateCodemap,
  generateFirstTasks,
  generateRunbook,
  generateDiagrams,
} from "../generator.js";
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

// Prune completed/errored jobs older than TTL
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}, JOB_TTL_MS).unref();

/**
 * Generate unique job ID
 */
function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Run analysis in background
 */
async function runAnalysis(job: AnalysisJob, options: Partial<BootcampOptions>): Promise<void> {
  const emit = (event: ProgressEvent) => {
    job.progress.push(event);
    job.emitter.emit("progress", event);
  };

  try {
    job.status = "running";
    const outputFormat = (options.format || "markdown") as OutputFormat;
    if (!["markdown", "html", "pdf"].includes(outputFormat)) {
      throw new Error(`Invalid format: ${options.format}. Use: markdown, html, pdf`);
    }

    // Parse URL
    emit({ type: "phase", phase: "parse", message: "Parsing repository URL..." });
    const repoInfo = parseGitHubUrl(job.repoUrl);
    emit({ type: "progress", message: `Repository: ${repoInfo.fullName}` });

    // Clone
    emit({ type: "phase", phase: "clone", message: `Cloning ${repoInfo.fullName}...` });
    const repoPath = await cloneRepo(repoInfo, process.cwd(), options.branch, false);
    emit({ type: "progress", message: `Cloned (branch: ${repoInfo.branch})` });

    // Scan
    emit({ type: "phase", phase: "scan", message: "Scanning files..." });
    const scanResult = await scanRepo(repoPath, options.maxFiles || 200);
    emit({ type: "progress", message: `Scanned ${scanResult.files.length} files` });
    emit({ type: "progress", message: `Stack: ${scanResult.stack.languages.join(", ")}` });

    // Analyze with Copilot
    emit({ type: "phase", phase: "analyze", message: "Analyzing with AI..." });
    const fullOptions: BootcampOptions = {
      branch: options.branch || "",
      focus: options.focus || "all",
      audience: options.audience || "oss-contributor",
      output: "",
      maxFiles: options.maxFiles || 200,
      noClone: false,
      verbose: false,
      ...options,
      format: outputFormat,
    };

    const analysisStart = Date.now();
    const useCache = !fullOptions.noCache && !!repoInfo.commitSha;
    let cacheHit = false;
    let facts!: RepoFacts;
    let analysisStats!: AnalysisStats;

    if (useCache) {
      const cached = await readCache(repoInfo.fullName, repoInfo.commitSha!);
      if (cached) {
        facts = cached;
        cacheHit = true;
        analysisStats = {
          model: "cached",
          toolCalls: [],
          totalEvents: 0,
          responseLength: 0,
          startTime: analysisStart,
          endTime: Date.now(),
        };
        emit({
          type: "progress",
          message: `Analysis loaded from cache (${repoInfo.commitSha!.substring(0, 7)})`,
        });
      }
    }

    if (!cacheHit) {
      let toolCallCount = 0;
      const result = await analyzeRepo(repoPath, repoInfo, scanResult, fullOptions, (msg) => {
        if (msg.startsWith("Tool:")) {
          toolCallCount++;
          emit({ type: "progress", message: `Tool call ${toolCallCount}: ${msg}` });
        }
      });
      facts = result.facts;
      analysisStats = result.stats;
      emit({
        type: "progress",
        message: `Analysis complete (${analysisStats.toolCalls.length} tool calls)`,
      });

      if (useCache) {
        try {
          await writeCache(repoInfo.fullName, repoInfo.commitSha!, facts);
        } catch {
          // Cache write failure is non-fatal
        }
      }
    }

    // Generate docs
    emit({ type: "phase", phase: "generate", message: "Generating documentation..." });
    
    const outputDir = join(process.cwd(), `.bootcamp-output`, repoInfo.repo);
    await mkdir(outputDir, { recursive: true });

    const depsPromise = extractDependencies(repoPath).then((deps) => {
      if (deps) {
        const allDepNames = [
          ...deps.runtime.map(d => d.name),
          ...deps.dev.map(d => d.name),
        ];
        mergeFrameworksFromDeps(scanResult.stack, allDepNames);
      }
      return deps;
    });

    const packageJsonPromise: Promise<Record<string, unknown> | undefined> = readFile(
      join(repoPath, "package.json"),
      "utf-8"
    )
      .then((pkgContent) => JSON.parse(pkgContent) as Record<string, unknown>)
      .catch(() => undefined);

    const securityPromise = packageJsonPromise.then((packageJson) =>
      analyzeSecurityPatterns(repoPath, scanResult.files, packageJson)
    );

    const radarPromise = Promise.all([depsPromise, securityPromise]).then(([deps, security]) =>
      generateTechRadar(
        scanResult.stack,
        scanResult.files,
        deps,
        security,
        !!scanResult.readme,
        !!scanResult.contributing
      )
    );

    const analysisPromise = Promise.all([
      depsPromise,
      securityPromise,
      radarPromise,
    ]);
    const [deps, security, radar] = await analysisPromise;

    // Generate all docs
    const documents = [
      { name: "BOOTCAMP.md", content: generateBootcamp(facts, fullOptions) },
      { name: "ONBOARDING.md", content: generateOnboarding(facts) },
      { name: "ARCHITECTURE.md", content: generateArchitecture(facts) },
      { name: "CODEMAP.md", content: generateCodemap(facts) },
      { name: "FIRST_TASKS.md", content: generateFirstTasks(facts) },
      { name: "RUNBOOK.md", content: generateRunbook(facts) },
      { name: "diagrams.mmd", content: generateDiagrams(facts) },
      { name: "repo_facts.json", content: JSON.stringify(facts, null, 2) },
      { name: "SECURITY.md", content: generateSecurityDocs(security, repoInfo.repo) },
      { name: "RADAR.md", content: generateRadarDocs(radar, repoInfo.repo) },
    ];

    if (deps) {
      documents.push({
        name: "DEPENDENCIES.md",
        content: generateDependencyDocs(deps, repoInfo.repo),
      });
    }

    const formattedDocuments = applyOutputFormat(documents, outputFormat);

    for (const doc of formattedDocuments) {
      await writeFile(join(outputDir, doc.name), doc.content, "utf-8");
    }

    emit({ type: "progress", message: `Generated ${formattedDocuments.length} files` });

    // Cleanup
    emit({ type: "phase", phase: "cleanup", message: "Cleaning up..." });
    await rm(repoPath, { recursive: true, force: true });

    // Complete
    job.status = "complete";
    job.completedAt = Date.now();
    job.result = {
      outputDir,
      files: formattedDocuments.map(d => d.name),
      stats: {
        toolCalls: analysisStats.toolCalls.length,
        model: analysisStats.model,
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
  }
}

export function registerRoutes(app: Application): void {
  // Start analysis
  app.post("/api/analyze", async (req: Request, res: Response): Promise<void> => {
    const { repoUrl, options = {} } = req.body;

    if (!repoUrl) {
      res.status(400).json({ error: "repoUrl is required" });
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
      const content = await readFile(join(job.result.outputDir, filename), "utf-8");
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
