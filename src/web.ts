/**
 * Local Demo Server
 * Express-based web interface for Repo Bootcamp
 */

import express, { Request, Response } from "express";
import chalk from "chalk";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { EventEmitter } from "events";

import { parseGitHubUrl, cloneRepo, scanRepo } from "./ingest.js";
import { analyzeRepo } from "./agent.js";
import { extractDependencies, generateDependencyDocs } from "./deps.js";
import { analyzeSecurityPatterns, generateSecurityDocs, getSecurityGrade } from "./security.js";
import { generateTechRadar, generateRadarDocs, getRiskEmoji } from "./radar.js";
import {
  generateBootcamp,
  generateOnboarding,
  generateArchitecture,
  generateCodemap,
  generateFirstTasks,
  generateRunbook,
  generateDiagrams,
} from "./generator.js";
import type { BootcampOptions, RepoFacts, ScanResult, RepoInfo } from "./types.js";

const DEFAULT_PORT = 3000;

/**
 * Progress event for SSE
 */
interface ProgressEvent {
  type: "phase" | "progress" | "complete" | "error";
  phase?: string;
  message: string;
  data?: any;
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
    stats: any;
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
    };

    let toolCallCount = 0;
    const result = await analyzeRepo(repoPath, repoInfo, scanResult, fullOptions, (msg) => {
      if (msg.startsWith("Tool:")) {
        toolCallCount++;
        emit({ type: "progress", message: `Tool call ${toolCallCount}: ${msg}` });
      }
    });
    const facts = result.facts;
    emit({ type: "progress", message: `Analysis complete (${result.stats.toolCalls.length} tool calls)` });

    // Generate docs
    emit({ type: "phase", phase: "generate", message: "Generating documentation..." });
    
    const outputDir = join(process.cwd(), `.bootcamp-output`, repoInfo.repo);
    await mkdir(outputDir, { recursive: true });

    // Dependencies
    const deps = await extractDependencies(repoPath);
    
    // Security
    let packageJson: Record<string, unknown> | undefined;
    try {
      const pkgContent = await readFile(join(repoPath, "package.json"), "utf-8");
      packageJson = JSON.parse(pkgContent);
    } catch {
      // No package.json
    }
    const security = await analyzeSecurityPatterns(repoPath, scanResult.files, packageJson);

    // Tech Radar
    const radar = generateTechRadar(
      scanResult.stack,
      scanResult.files,
      deps,
      security,
      !!scanResult.readme,
      !!scanResult.contributing
    );

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

    for (const doc of documents) {
      await writeFile(join(outputDir, doc.name), doc.content, "utf-8");
    }

    emit({ type: "progress", message: `Generated ${documents.length} files` });

    // Cleanup
    emit({ type: "phase", phase: "cleanup", message: "Cleaning up..." });
    await rm(repoPath, { recursive: true, force: true });

    // Complete
    job.status = "complete";
    job.completedAt = Date.now();
    job.result = {
      outputDir,
      files: documents.map(d => d.name),
      stats: {
        toolCalls: result.stats.toolCalls.length,
        model: result.stats.model,
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
      res.setHeader("Content-Type", filename.endsWith(".json") ? "application/json" : "text/markdown");
      res.send(content);
    } catch (error: unknown) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return app;
}

/**
 * Start the server
 */
export function startServer(port: number = DEFAULT_PORT): void {
  const app = createApp();

  app.listen(port, () => {
    console.log(chalk.bold.cyan("\n=== Repo Bootcamp Web Demo ===\n"));
    console.log(chalk.white(`Server running at: ${chalk.underline(`http://localhost:${port}`)}`));
    console.log(chalk.gray("\nOpen your browser to analyze a repository.\n"));
    console.log(chalk.gray("Press Ctrl+C to stop the server.\n"));
  });
}

/**
 * Inline HTML for the demo page
 */
function getIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Repo Bootcamp</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e0e0e0;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { 
      font-size: 2.5rem; 
      margin-bottom: 0.5rem;
      background: linear-gradient(90deg, #00d9ff, #00ff88);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle { color: #888; margin-bottom: 2rem; }
    .input-group { display: flex; gap: 1rem; margin-bottom: 2rem; }
    input { 
      flex: 1; 
      padding: 1rem; 
      border: 2px solid #333; 
      border-radius: 8px; 
      background: #0d1117; 
      color: #fff;
      font-size: 1rem;
    }
    input:focus { outline: none; border-color: #00d9ff; }
    button { 
      padding: 1rem 2rem; 
      border: none; 
      border-radius: 8px; 
      background: linear-gradient(90deg, #00d9ff, #00ff88);
      color: #1a1a2e;
      font-weight: bold;
      cursor: pointer;
      transition: transform 0.2s;
    }
    button:hover { transform: scale(1.05); }
    button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .progress { 
      background: #0d1117; 
      border-radius: 8px; 
      padding: 1.5rem; 
      margin-bottom: 2rem;
      max-height: 300px;
      overflow-y: auto;
    }
    .progress-item { 
      padding: 0.5rem 0; 
      border-bottom: 1px solid #222;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .progress-item:last-child { border-bottom: none; }
    .phase { color: #00d9ff; font-weight: bold; }
    .success { color: #00ff88; }
    .error { color: #ff4757; }
    .results { display: none; }
    .results.show { display: block; }
    .stats { 
      display: grid; 
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); 
      gap: 1rem; 
      margin-bottom: 2rem;
    }
    .stat { 
      background: #0d1117; 
      padding: 1rem; 
      border-radius: 8px; 
      text-align: center;
    }
    .stat-value { font-size: 2rem; font-weight: bold; color: #00d9ff; }
    .stat-label { color: #888; font-size: 0.875rem; }
    .files { 
      display: grid; 
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
      gap: 1rem;
    }
    .file { 
      background: #0d1117; 
      padding: 1rem; 
      border-radius: 8px; 
      cursor: pointer;
      transition: background 0.2s;
    }
    .file:hover { background: #161b22; }
    .file-name { font-weight: bold; margin-bottom: 0.25rem; }
    .file-desc { color: #888; font-size: 0.875rem; }
    .modal { 
      display: none; 
      position: fixed; 
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.9);
      z-index: 1000;
      padding: 2rem;
      overflow-y: auto;
    }
    .modal.show { display: block; }
    .modal-content { 
      max-width: 900px; 
      margin: 0 auto; 
      background: #0d1117;
      border-radius: 8px;
      padding: 2rem;
    }
    .modal-header { 
      display: flex; 
      justify-content: space-between; 
      align-items: center;
      margin-bottom: 1rem;
    }
    .close { 
      background: none; 
      border: none; 
      color: #888; 
      font-size: 2rem; 
      cursor: pointer;
    }
    .close:hover { color: #fff; }
    pre { 
      background: #161b22; 
      padding: 1rem; 
      border-radius: 8px; 
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-size: 0.875rem;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Repo Bootcamp</h1>
    <p class="subtitle">Generate onboarding documentation for any GitHub repository</p>
    
    <div class="input-group">
      <input type="text" id="repoUrl" placeholder="https://github.com/owner/repo" />
      <button id="analyzeBtn" onclick="analyze()">Analyze</button>
    </div>

    <div class="progress" id="progress" style="display: none;"></div>

    <div class="results" id="results">
      <div class="stats" id="stats"></div>
      <h2 style="margin-bottom: 1rem;">Generated Files</h2>
      <div class="files" id="files"></div>
    </div>
  </div>

  <div class="modal" id="modal" onclick="if(event.target===this)closeModal()">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modalTitle"></h2>
        <button class="close" onclick="closeModal()">&times;</button>
      </div>
      <pre id="modalContent"></pre>
    </div>
  </div>

  <script>
    let currentJobId = null;

    const fileDescriptions = {
      'BOOTCAMP.md': 'One-page overview',
      'ONBOARDING.md': 'Setup guide',
      'ARCHITECTURE.md': 'System design',
      'CODEMAP.md': 'Directory tour',
      'FIRST_TASKS.md': 'Starter issues',
      'RUNBOOK.md': 'Operations guide',
      'DEPENDENCIES.md': 'Dependency graph',
      'SECURITY.md': 'Security analysis',
      'RADAR.md': 'Tech radar',
      'diagrams.mmd': 'Mermaid diagrams',
      'repo_facts.json': 'Structured data',
    };

    async function analyze() {
      const repoUrl = document.getElementById('repoUrl').value.trim();
      if (!repoUrl) return alert('Please enter a repository URL');

      const btn = document.getElementById('analyzeBtn');
      btn.disabled = true;
      btn.textContent = 'Analyzing...';

      const progress = document.getElementById('progress');
      progress.style.display = 'block';
      progress.innerHTML = '';

      document.getElementById('results').classList.remove('show');

      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoUrl }),
        });

        const { jobId, error } = await res.json();
        if (error) throw new Error(error);

        currentJobId = jobId;
        streamProgress(jobId);
      } catch (err) {
        addProgressItem(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Analyze';
      }
    }

    function streamProgress(jobId) {
      const evtSource = new EventSource('/api/jobs/' + jobId + '/stream');
      
      evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'phase') {
          addProgressItem(data.message, 'phase');
        } else if (data.type === 'progress') {
          addProgressItem(data.message);
        } else if (data.type === 'complete') {
          addProgressItem(data.message, 'success');
          showResults(data.data);
          evtSource.close();
          resetButton();
        } else if (data.type === 'error') {
          addProgressItem(data.message, 'error');
          evtSource.close();
          resetButton();
        }
      };

      evtSource.onerror = () => {
        evtSource.close();
        resetButton();
      };
    }

    function addProgressItem(message, type = '') {
      const progress = document.getElementById('progress');
      const item = document.createElement('div');
      item.className = 'progress-item ' + type;
      item.innerHTML = (type === 'phase' ? '▶ ' : type === 'success' ? '✓ ' : type === 'error' ? '✗ ' : '  ') + message;
      progress.appendChild(item);
      progress.scrollTop = progress.scrollHeight;
    }

    function showResults(data) {
      const stats = document.getElementById('stats');
      stats.innerHTML = \`
        <div class="stat"><div class="stat-value">\${data.stats.securityScore}</div><div class="stat-label">Security Score (\${data.stats.securityGrade})</div></div>
        <div class="stat"><div class="stat-value">\${data.stats.riskScore}</div><div class="stat-label">Onboarding Risk (\${data.stats.riskGrade})</div></div>
        <div class="stat"><div class="stat-value">\${data.stats.dependencies}</div><div class="stat-label">Dependencies</div></div>
        <div class="stat"><div class="stat-value">\${data.stats.toolCalls}</div><div class="stat-label">Tool Calls</div></div>
      \`;

      const files = document.getElementById('files');
      files.innerHTML = data.files.map(f => \`
        <div class="file" onclick="viewFile('\${f}')">
          <div class="file-name">\${f}</div>
          <div class="file-desc">\${fileDescriptions[f] || ''}</div>
        </div>
      \`).join('');

      document.getElementById('results').classList.add('show');
    }

    async function viewFile(filename) {
      const content = await fetch('/api/jobs/' + currentJobId + '/files/' + filename).then(r => r.text());
      document.getElementById('modalTitle').textContent = filename;
      document.getElementById('modalContent').textContent = content;
      document.getElementById('modal').classList.add('show');
    }

    function closeModal() {
      document.getElementById('modal').classList.remove('show');
    }

    function resetButton() {
      const btn = document.getElementById('analyzeBtn');
      btn.disabled = false;
      btn.textContent = 'Analyze';
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  </script>
</body>
</html>`;
}
