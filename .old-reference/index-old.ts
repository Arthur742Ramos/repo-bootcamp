#!/usr/bin/env node
/**
 * Repo Bootcamp Generator
 *
 * Turn any public GitHub repository into a "Day 1 onboarding kit"
 * using the GitHub Copilot SDK for intelligent agentic analysis.
 *
 * Usage:
 *   bootcamp https://github.com/owner/repo
 *   bootcamp .                              # analyze current directory
 *   bootcamp /path/to/repo                  # analyze local path
 *   bootcamp ~/projects/myapp               # home-relative path
 *   bootcamp https://github.com/owner/repo --output ./my-bootcamp
 *   bootcamp https://github.com/owner/repo --interactive
 *   bootcamp https://github.com/owner/repo --compare v1.0.0
 *   bootcamp ask https://github.com/owner/repo
 *   bootcamp --web
 */

import { Command } from "commander";
import chalk from "chalk";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join, basename, resolve } from "path";
import { fileURLToPath } from "url";

import { parseGitHubUrl, cloneRepo, scanRepo, mergeFrameworksFromDeps } from "./ingest.js";
import { resolveRepo, isLocalPath, type RepoSource } from "./repo-resolver.js";
import { analyzeRepo, AnalysisStats } from "./agent.js";
import { ProgressTracker } from "./progress.js";
import { extractDependencies, generateDependencyDocs } from "./deps.js";
import { analyzeSecurityPatterns, generateSecurityDocs, getSecurityGrade } from "./security.js";
import { generateTechRadar, generateRadarDocs, getRiskEmoji } from "./radar.js";
import { buildImportGraph, analyzeChangeImpact, generateImpactDocs, getKeyFilesForImpact } from "./impact.js";
import { runInteractiveMode, quickAsk } from "./interactive.js";
import { createIssuesFromTasks, generateIssuePreview } from "./issues.js";
import { analyzeDiff, generateDiffDocs } from "./diff.js";
import { startServer } from "./web.js";
import { loadConfig, getStyleConfig, loadPlugins, runPlugins, STYLE_PACKS, type BootcampConfig } from "./plugins.js";
import { renderOutputDiagrams, isMermaidCliAvailable, DiagramFormat } from "./diagrams.js";
import {
  generateBootcamp,
  generateOnboarding,
  generateArchitecture,
  generateCodemap,
  generateFirstTasks,
  generateRunbook,
  generateDiagrams,
} from "./generator.js";
import type { BootcampOptions, RepoFacts, ScanResult, RepoInfo, StylePack, OutputFormat } from "./types.js";
import { analyzeDocumentation } from "./docs-analyzer.js";
import { fixDocumentation } from "./docs-fixer.js";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;

/**
 * Generate a single-file HTML report with inline CSS
 */
function generateHtmlReport(
  facts: RepoFacts,
  security: { score: number },
  radar: { onboardingRisk: { score: number; grade: string; factors: string[] }; modern: unknown[]; stable: unknown[]; legacy: unknown[]; risky: unknown[] },
  deps: { totalCount: number; runtime: unknown[]; dev: unknown[] } | null,
  repoInfo: RepoInfo,
  documents: { name: string; content: string }[]
): string {
  const securityGrade = getSecurityGrade(security.score);
  const bootcampDoc = documents.find(d => d.name === "BOOTCAMP.md");
  const architectureDoc = documents.find(d => d.name === "ARCHITECTURE.md");
  const onboardingDoc = documents.find(d => d.name === "ONBOARDING.md");
  
  // Simple markdown to HTML conversion
  const mdToHtml = (md: string): string => {
    return md
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[hup])/gm, '<p>')
      .replace(/(?<![>])$/gm, '</p>')
      .replace(/<p><\/p>/g, '')
      .replace(/<p>(<[hul])/g, '$1')
      .replace(/(<\/[hul][^>]*>)<\/p>/g, '$1');
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${facts.repoName} - Bootcamp Report</title>
  <style>
    :root {
      --primary: #0366d6;
      --success: #28a745;
      --warning: #ffc107;
      --danger: #dc3545;
      --bg: #ffffff;
      --bg-alt: #f6f8fa;
      --text: #24292e;
      --text-muted: #586069;
      --border: #e1e4e8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: var(--text);
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      background: var(--bg);
    }
    header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
      margin-bottom: 2rem;
    }
    h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; margin: 2rem 0 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    h3 { font-size: 1.25rem; margin: 1.5rem 0 0.75rem; }
    p { margin: 0.75rem 0; }
    code {
      background: var(--bg-alt);
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.9em;
    }
    pre {
      background: var(--bg-alt);
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
      margin: 1rem 0;
    }
    pre code { background: none; padding: 0; }
    ul, ol { margin: 0.75rem 0; padding-left: 2rem; }
    li { margin: 0.25rem 0; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin: 1.5rem 0;
    }
    .stat-card {
      background: var(--bg-alt);
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
    }
    .stat-value { font-size: 2rem; font-weight: bold; color: var(--primary); }
    .stat-label { color: var(--text-muted); font-size: 0.9rem; }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .badge-success { background: #dcffe4; color: #22863a; }
    .badge-warning { background: #fff5b1; color: #735c0f; }
    .badge-danger { background: #ffeef0; color: #cb2431; }
    .section { margin: 2rem 0; }
    .card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.5rem;
      margin: 1rem 0;
    }
    .task {
      border-left: 4px solid var(--primary);
      padding-left: 1rem;
      margin: 1rem 0;
    }
    .task-title { font-weight: 600; }
    .task-meta { color: var(--text-muted); font-size: 0.9rem; }
    footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 0.85rem;
      text-align: center;
    }
    .content-section { margin: 2rem 0; }
  </style>
</head>
<body>
  <header>
    <h1>📚 ${facts.repoName}</h1>
    <p style="font-size: 1.2rem; color: var(--text-muted);">${facts.purpose}</p>
    <p><a href="${repoInfo.url}" target="_blank">${repoInfo.url}</a></p>
  </header>

  <div class="stats">
    <div class="stat-card">
      <div class="stat-value">${facts.stack.languages.length}</div>
      <div class="stat-label">Languages</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${facts.stack.frameworks.length}</div>
      <div class="stat-label">Frameworks</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${security.score}/100</div>
      <div class="stat-label">Security Score (${securityGrade})</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${radar.onboardingRisk.grade}</div>
      <div class="stat-label">Onboarding Risk</div>
    </div>
    ${deps ? `<div class="stat-card">
      <div class="stat-value">${deps.totalCount}</div>
      <div class="stat-label">Dependencies</div>
    </div>` : ''}
  </div>

  <section class="section">
    <h2>🛠 Tech Stack</h2>
    <div class="card">
      <p><strong>Languages:</strong> ${facts.stack.languages.join(', ') || 'Unknown'}</p>
      <p><strong>Frameworks:</strong> ${facts.stack.frameworks.join(', ') || 'None detected'}</p>
      <p><strong>Build System:</strong> ${facts.stack.buildSystem || 'Unknown'}</p>
      <p><strong>Package Manager:</strong> ${facts.stack.packageManager || 'N/A'}</p>
      <p><strong>Docker:</strong> ${facts.stack.hasDocker ? '✅ Yes' : '❌ No'}</p>
      <p><strong>CI/CD:</strong> ${facts.stack.hasCi ? '✅ Yes' : '❌ No'}</p>
    </div>
  </section>

  <section class="section">
    <h2>🚀 Quick Start</h2>
    <div class="card">
      <h3>Prerequisites</h3>
      <ul>
        ${facts.quickstart.prerequisites.map(p => `<li>${p}</li>`).join('\n        ')}
      </ul>
      <h3>Steps</h3>
      <ol>
        ${facts.quickstart.steps.map(s => `<li>${s}</li>`).join('\n        ')}
      </ol>
    </div>
  </section>

  <section class="section">
    <h2>🏗 Architecture</h2>
    <div class="card">
      <p>${facts.architecture.overview}</p>
      <h3>Components</h3>
      <ul>
        ${facts.architecture.components.map(c => `<li><strong>${c.name}</strong> (${c.directory}): ${c.description}</li>`).join('\n        ')}
      </ul>
    </div>
  </section>

  <section class="section">
    <h2>🎯 First Tasks</h2>
    ${facts.firstTasks.slice(0, 5).map(task => `
    <div class="task">
      <div class="task-title">${task.title}</div>
      <div class="task-meta">
        <span class="badge ${task.difficulty === 'beginner' ? 'badge-success' : task.difficulty === 'intermediate' ? 'badge-warning' : 'badge-danger'}">${task.difficulty}</span>
        <span class="badge">${task.category}</span>
      </div>
      <p>${task.description}</p>
      <p><small>Files: ${task.files.join(', ')}</small></p>
    </div>`).join('\n')}
  </section>

  <footer>
    <p>Generated by <strong>Repo Bootcamp</strong> on ${new Date().toLocaleDateString()}</p>
  </footer>
</body>
</html>`;
}

export interface RunStats {
  cloneTime: number;
  scanTime: number;
  analysisTime: number;
  generateTime: number;
  totalTime: number;
  filesScanned: number;
  toolCalls: number;
  model: string;
}

type ProgressReporter = Pick<
  ProgressTracker,
  "startPhase" | "update" | "recordToolCall" | "succeed" | "fail" | "stop"
>;

export async function resolveSource(
  repoUrl: string,
  progress: ProgressReporter,
  runStats: Partial<RunStats>
): Promise<RepoSource> {
  let repoSource: RepoSource;
  const cloneStart = Date.now();
  
  if (isLocalPath(repoUrl)) {
    progress.startPhase("scan", "local path");
    try {
      repoSource = await resolveRepo(repoUrl, process.cwd());
      runStats.cloneTime = Date.now() - cloneStart;
      progress.succeed(`Using local repo: ${repoSource.repoName}`);
    } catch (error: any) {
      progress.fail(`Failed to resolve local path: ${error.message}`);
      process.exit(1);
    }
  } else {
    progress.startPhase("clone", repoUrl);
    try {
      repoSource = await resolveRepo(repoUrl, process.cwd());
      runStats.cloneTime = Date.now() - cloneStart;
      progress.succeed(`Cloned ${repoSource.repoInfo.fullName} (branch: ${repoSource.repoInfo.branch})`);
    } catch (error: any) {
      progress.fail(`Clone failed: ${error.message}`);
      process.exit(1);
    }
  }
 
  return repoSource;
}

export async function performScan(
  repoPath: string,
  options: BootcampOptions,
  progress: ProgressReporter,
  runStats: Partial<RunStats>
): Promise<ScanResult> {
  const scanStart = Date.now();
  progress.startPhase("scan", `max ${options.maxFiles} files`);
  let scanResult: ScanResult;
  try {
    scanResult = await scanRepo(repoPath, options.maxFiles);
    runStats.scanTime = Date.now() - scanStart;
    runStats.filesScanned = scanResult.files.length;
    progress.succeed(`Scanned ${scanResult.files.length} files (${scanResult.keySourceFiles.size} key files read)`);
  } catch (error: any) {
    progress.fail(`Scan failed: ${error.message}`);
    process.exit(1);
  }
 
  return scanResult;
}

export async function analyzeWithAgent(
  repoPath: string,
  repoInfo: RepoInfo,
  scanResult: ScanResult,
  options: BootcampOptions,
  progress: ProgressReporter,
  runStats: Partial<RunStats>
): Promise<{ facts: RepoFacts; analysisStats: AnalysisStats }> {
  const analysisStart = Date.now();
  progress.startPhase("analyze");
  try {
    const result = await analyzeRepo(repoPath, repoInfo, scanResult, options, (msg) => {
      // Track tool calls
      if (msg.startsWith("Tool:")) {
        const toolName = msg.replace("Tool:", "").trim();
        progress.recordToolCall(toolName);
      }
      progress.update(msg);
    });
    runStats.analysisTime = Date.now() - analysisStart;
    runStats.toolCalls = result.stats.toolCalls.length;
    runStats.model = result.stats.model;
    progress.succeed(`Analysis complete`);
    return { facts: result.facts, analysisStats: result.stats };
  } catch (error: any) {
    progress.fail(`Analysis failed: ${error.message}`);
    console.log(chalk.yellow("\nTip: Make sure you're authenticated with GitHub Copilot"));
    console.log(chalk.gray("Run: gh auth status"));
    process.exit(1);
  }
}

export async function generateOutput(
  repoPath: string,
  repoInfo: RepoInfo,
  scanResult: ScanResult,
  facts: RepoFacts,
  options: BootcampOptions,
  config: BootcampConfig | null,
  progress: ProgressReporter,
  runStats: Partial<RunStats>,
  outputDir: string
): Promise<void> {
  // Create output directory
  try {
    await mkdir(outputDir, { recursive: true });
  } catch (error: any) {
    console.error(chalk.red(`Failed to create output directory: ${error.message}`));
    process.exit(1);
  }
 
  // Generate documents
  const generateStart = Date.now();
  progress.startPhase("generate", options.jsonOnly ? "JSON only" : "12+ files");
  try {
    // Extract dependencies
    const deps = await extractDependencies(repoPath);
    
    // Merge frameworks detected from dependencies into stack info
    if (deps) {
      const allDepNames = [
        ...deps.runtime.map(d => d.name),
        ...deps.dev.map(d => d.name),
      ];
      mergeFrameworksFromDeps(scanResult.stack, allDepNames);
    }
    
    // Analyze security (read package.json for deps check)
    let packageJson: Record<string, unknown> | undefined;
    try {
      const pkgContent = await readFile(join(repoPath, "package.json"), "utf-8");
      packageJson = JSON.parse(pkgContent);
    } catch {
      // No package.json
    }
    const security = await analyzeSecurityPatterns(repoPath, scanResult.files, packageJson);
 
    // Generate Tech Radar
    const radar = generateTechRadar(
      scanResult.stack,
      scanResult.files,
      deps,
      security,
      !!scanResult.readme,
      !!scanResult.contributing
    );
 
    // Generate Change Impact Map
    const keyFiles = getKeyFilesForImpact(scanResult.files);
    const importGraph = await buildImportGraph(repoPath, scanResult.files);
    const impacts = await Promise.all(
      keyFiles.slice(0, 10).map(file => 
        analyzeChangeImpact(repoPath, scanResult.files, file, importGraph)
      )
    );
 
    // Generate Diff if --compare is specified
    let diffSummary = null;
    if (options.compare) {
      try {
        progress.update("Analyzing diff...");
        diffSummary = await analyzeDiff(repoPath, options.compare, "HEAD");
      } catch (error: any) {
        console.log(chalk.yellow(`  Warning: Could not generate diff: ${error.message}`));
      }
    }
 
    // Build document list
    const documents = [
      { name: "BOOTCAMP.md", content: generateBootcamp(facts, options) },
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
 
    // Add dependency docs if we have deps
    if (deps) {
      documents.push({
        name: "DEPENDENCIES.md",
        content: generateDependencyDocs(deps, repoInfo.repo),
      });
    }
 
    // Add impact docs if we have impacts
    if (impacts.length > 0) {
      documents.push({
        name: "IMPACT.md",
        content: generateImpactDocs(impacts, repoInfo.repo),
      });
    }
 
    // Add diff docs if generated
    if (diffSummary) {
      documents.push({
        name: "DIFF.md",
        content: generateDiffDocs(diffSummary, repoInfo.repo),
      });
    }
 
    // Load and run plugins if configured
    if (config?.plugins && config.plugins.length > 0) {
      progress.update("Running plugins...");
      const plugins = await loadPlugins(config.plugins);
      const pluginOutput = await runPlugins(plugins, repoPath, scanResult, facts, options);
      
      // Add plugin docs
      for (const doc of pluginOutput.docs) {
        documents.push(doc);
      }
 
      // Merge extra data into facts JSON
      if (Object.keys(pluginOutput.extraData).length > 0) {
        const factsWithPlugins = {
          ...facts,
          plugins: pluginOutput.extraData,
        };
        const factsDoc = documents.find(d => d.name === "repo_facts.json");
        if (factsDoc) {
          factsDoc.content = JSON.stringify(factsWithPlugins, null, 2);
        }
      }
    }
 
    // Only write if not json-only mode
    if (!options.jsonOnly) {
      // Handle different output formats
      if (options.format === "json") {
        // JSON format: output a condensed summary.json
        const summary = {
          repoName: facts.repoName,
          purpose: facts.purpose,
          description: facts.description,
          stack: facts.stack,
          quickstart: facts.quickstart,
          structure: facts.structure,
          architecture: facts.architecture,
          firstTasks: facts.firstTasks,
          security: { score: security.score, grade: getSecurityGrade(security.score) },
          radar: { 
            onboardingRisk: radar.onboardingRisk,
            modern: radar.modern.length,
            stable: radar.stable.length,
            legacy: radar.legacy.length,
            risky: radar.risky.length,
          },
          dependencies: deps ? { total: deps.totalCount, runtime: deps.runtime.length, dev: deps.dev.length } : null,
          generatedAt: new Date().toISOString(),
        };
        await writeFile(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
        progress.succeed("Generated summary.json");
      } else if (options.format === "html") {
        // HTML format: single-file HTML report with inline CSS
        const htmlContent = generateHtmlReport(facts, security, radar, deps, repoInfo, documents);
        await writeFile(join(outputDir, "report.html"), htmlContent, "utf-8");
        progress.succeed("Generated report.html");
      } else {
        // Default markdown format
        for (const doc of documents) {
          progress.update(doc.name);
          await writeFile(join(outputDir, doc.name), doc.content, "utf-8");
        }
        runStats.generateTime = Date.now() - generateStart;
        progress.succeed(`Generated ${documents.length} files`);
      }
    } else {
      // Just write the JSON
      await writeFile(join(outputDir, "repo_facts.json"), JSON.stringify(facts, null, 2), "utf-8");
    }
 
    if (!runStats.generateTime) {
      runStats.generateTime = Date.now() - generateStart;
    }
 
    // Show security score
    if (!options.jsonOnly) {
      const grade = getSecurityGrade(security.score);
      const scoreColor = security.score >= 80 ? chalk.green : security.score >= 60 ? chalk.yellow : chalk.red;
      console.log(chalk.cyan("\nSecurity Score: ") + scoreColor(`${security.score}/100 (${grade})`));
      
      // Show onboarding risk
      const riskEmoji = getRiskEmoji(radar.onboardingRisk.grade);
      const riskColor = radar.onboardingRisk.score <= 25 ? chalk.green : 
                        radar.onboardingRisk.score <= 50 ? chalk.yellow : chalk.red;
      console.log(chalk.cyan("Onboarding Risk: ") + riskColor(`${radar.onboardingRisk.score}/100 (${radar.onboardingRisk.grade}) ${riskEmoji}`));
 
      if (deps) {
        console.log(chalk.cyan("Dependencies: ") + chalk.white(`${deps.totalCount} total (${deps.runtime.length} runtime, ${deps.dev.length} dev)`));
      }
    }
 
    // Create issues if requested
    if (options.createIssues && facts.firstTasks.length > 0) {
      console.log();
      if (options.dryRun) {
        const preview = generateIssuePreview(facts.firstTasks, repoInfo);
        await writeFile(join(outputDir, "ISSUES_PREVIEW.md"), preview, "utf-8");
        console.log(chalk.yellow("Issue preview saved to ISSUES_PREVIEW.md"));
      }
      await createIssuesFromTasks(facts.firstTasks, repoInfo, {
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
    }
 
    // Render diagrams if requested
    if (options.renderDiagrams && !options.jsonOnly) {
      progress.update("Rendering diagrams...");
      const format = options.diagramFormat || "svg";
      const renderResult = await renderOutputDiagrams(outputDir, format);
      if (renderResult.rendered) {
        console.log(chalk.cyan("\nDiagrams rendered: ") + chalk.white(renderResult.files.map(f => basename(f)).join(", ")));
      } else if (renderResult.error) {
        console.log(chalk.yellow(`\nDiagram rendering skipped: ${renderResult.error}`));
      }
    }
 
  } catch (error: any) {
    progress.fail(`Document generation failed: ${error.message}`);
    process.exit(1);
  }
}

export function printSummary(
  outputDir: string,
  options: BootcampOptions,
  runStats: Partial<RunStats>,
  analysisStats: AnalysisStats,
  progress: ProgressReporter,
  startTime: number
): void {
  progress.stop();
  runStats.totalTime = Date.now() - startTime;
 
  // Print summary with nice box
  console.log();
  console.log(chalk.green("  ╔══════════════════════════════════════════════════════╗"));
  console.log(chalk.green("  ║") + chalk.white.bold("        ✓ Bootcamp Generated Successfully!           ") + chalk.green("║"));
  console.log(chalk.green("  ╚══════════════════════════════════════════════════════╝"));
  console.log();
  console.log(chalk.white(`  📁 Output: ${chalk.cyan.bold(outputDir + "/")}`));
  console.log();
 
  if (!options.jsonOnly) {
    console.log(chalk.dim("  Generated files:"));
    console.log(chalk.white("  ├── ") + chalk.cyan("BOOTCAMP.md") + chalk.dim("      → 1-page overview (start here!)"));
    console.log(chalk.white("  ├── ") + chalk.cyan("ONBOARDING.md") + chalk.dim("    → Full setup guide"));
    console.log(chalk.white("  ├── ") + chalk.cyan("ARCHITECTURE.md") + chalk.dim("  → System design & diagrams"));
    console.log(chalk.white("  ├── ") + chalk.cyan("CODEMAP.md") + chalk.dim("       → Directory tour"));
    console.log(chalk.white("  ├── ") + chalk.cyan("FIRST_TASKS.md") + chalk.dim("   → Starter issues"));
    console.log(chalk.white("  ├── ") + chalk.cyan("RUNBOOK.md") + chalk.dim("       → Operations guide"));
    console.log(chalk.white("  ├── ") + chalk.cyan("DEPENDENCIES.md") + chalk.dim("  → Dependency graph"));
    console.log(chalk.white("  ├── ") + chalk.cyan("SECURITY.md") + chalk.dim("      → Security findings"));
    console.log(chalk.white("  ├── ") + chalk.cyan("RADAR.md") + chalk.dim("         → Tech radar & risk score"));
    console.log(chalk.white("  ├── ") + chalk.cyan("IMPACT.md") + chalk.dim("        → Change impact analysis"));
    if (options.compare) {
      console.log(chalk.white("  ├── ") + chalk.cyan("DIFF.md") + chalk.dim("          → Version comparison"));
    }
    console.log(chalk.white("  ├── ") + chalk.cyan("diagrams.mmd") + chalk.dim("     → Mermaid diagrams"));
    console.log(chalk.white("  └── ") + chalk.cyan("repo_facts.json") + chalk.dim("  → Structured data"));
    console.log();
  }
 
  // Show stats if requested
  if (options.stats) {
    console.log(chalk.dim("  ─────────────────────────────────────────"));
    console.log(chalk.white.bold("  📊 Statistics"));
    console.log(chalk.white(`     Model:         ${chalk.cyan(runStats.model)}`));
    console.log(chalk.white(`     Files scanned: ${chalk.cyan(runStats.filesScanned)}`));
    console.log(chalk.white(`     Tool calls:    ${chalk.cyan(runStats.toolCalls)}`));
    console.log(chalk.white(`     Total time:    ${chalk.cyan((runStats.totalTime! / 1000).toFixed(1) + "s")}`));
    console.log(chalk.dim(`       ├── Clone:    ${(runStats.cloneTime! / 1000).toFixed(1)}s`));
    console.log(chalk.dim(`       ├── Scan:     ${(runStats.scanTime! / 1000).toFixed(1)}s`));
    console.log(chalk.dim(`       ├── Analyze:  ${(runStats.analysisTime! / 1000).toFixed(1)}s`));
    console.log(chalk.dim(`       └── Generate: ${(runStats.generateTime! / 1000).toFixed(1)}s`));
    console.log();
 
    if (analysisStats.toolCalls.length > 0) {
      console.log(chalk.cyan("Tool calls made:"));
      for (const call of analysisStats.toolCalls) {
        console.log(chalk.gray(`  ${call.name}: ${call.args}`));
      }
      console.log();
    }
  }
 
  console.log(chalk.white("  🚀 ") + chalk.white.bold("Next step: ") + chalk.cyan(`open ${outputDir}/BOOTCAMP.md`));
  console.log();
}

async function run(repoUrl: string, options: BootcampOptions): Promise<void> {
  const progress = new ProgressTracker(options.verbose);
  const runStats: Partial<RunStats> = {};
  const startTime = Date.now();

  // Load config file if present
  const config = await loadConfig();
  const styleConfig = getStyleConfig(
    options.style || config?.style,
    config?.customStyle
  );

  // ASCII art banner
  console.log(chalk.cyan(`
  ╦═╗╔═╗╔═╗╔═╗  ╔╗ ╔═╗╔═╗╔╦╗╔═╗╔═╗╔╦╗╔═╗
  ╠╦╝║╣ ╠═╝║ ║  ╠╩╗║ ║║ ║ ║ ║  ╠═╣║║║╠═╝
  ╩╚═╚═╝╩  ╚═╝  ╚═╝╚═╝╚═╝ ╩ ╚═╝╩ ╩╩ ╩╩  
  `));
  console.log(chalk.white.bold("  Turn any repo into a Day 1 onboarding kit\n"));
  
  console.log(chalk.dim("─".repeat(50)));
  console.log(chalk.white(`  Repository:  ${chalk.cyan(repoUrl)}`));
  console.log(chalk.white(`  Branch:      ${chalk.cyan(options.branch || "default")}`));
  console.log(chalk.white(`  Focus:       ${chalk.cyan(options.focus)}`));
  console.log(chalk.white(`  Audience:    ${chalk.cyan(options.audience)}`));
  console.log(chalk.white(`  Style:       ${chalk.cyan(styleConfig.name)}`));
  if (options.model) {
    console.log(chalk.white(`  Model:       ${chalk.cyan(options.model)}`));
  }
  if (options.compare) {
    console.log(chalk.white(`  Compare:     ${chalk.cyan(options.compare)}`));
  }
  console.log(chalk.dim("─".repeat(50)));
  console.log();

  // Show phase overview
  ProgressTracker.printPhaseOverview();

  // Resolve repository source (local path or GitHub URL)
  const repoSource = await resolveSource(repoUrl, progress, runStats);

  const repoPath = repoSource.path;
  const repoInfo = repoSource.repoInfo;

  console.log(chalk.white(`Target: ${chalk.bold(repoInfo.fullName)}`));
  console.log();

  // Determine output directory
  const outputDir = options.output || `./bootcamp-${repoSource.repoName}`;

  // Scan repository
  const scanResult = await performScan(repoPath, options, progress, runStats);

  // Display detected stack
  console.log(chalk.cyan("\nDetected Stack:"));
  console.log(chalk.white(`  Languages: ${scanResult.stack.languages.join(", ") || "Unknown"}`));
  console.log(chalk.white(`  Frameworks: ${scanResult.stack.frameworks.join(", ") || "None"}`));
  console.log(chalk.white(`  Build: ${scanResult.stack.buildSystem || "Unknown"}`));
  console.log(chalk.white(`  CI: ${scanResult.stack.hasCi ? "Yes" : "No"}`));
  console.log(chalk.white(`  Docker: ${scanResult.stack.hasDocker ? "Yes" : "No"}`));
  console.log();

  // Analyze with Copilot SDK
  const { facts, analysisStats } = await analyzeWithAgent(repoPath, repoInfo, scanResult, options, progress, runStats);
  await generateOutput(repoPath, repoInfo, scanResult, facts, options, config, progress, runStats, outputDir);

  // Store repoPath and scanResult for interactive mode before cleanup
  const interactiveRepoPath = repoPath;
  const interactiveScanResult = scanResult;

  // Cleanup temporary clone (unless keeping for interactive mode or local repo)
  if (!repoSource.isLocal && !options.keepTemp && !options.interactive) {
    progress.startPhase("cleanup");
    try {
      await repoSource.cleanup();
      progress.succeed("Cleanup complete");
    } catch {
      progress.warn("Could not clean up temporary files");
    }
  } else if (repoSource.isLocal) {
    // No cleanup needed for local paths
  } else if (options.interactive) {
    console.log(chalk.gray(`Keeping clone for interactive mode: ${repoPath}`));
  } else {
    console.log(chalk.gray(`Temporary clone kept at: ${repoPath}`));
  }

  printSummary(outputDir, options, runStats, analysisStats, progress, startTime);

  // Start interactive mode if requested
  if (options.interactive) {
    await runInteractiveMode(
      interactiveRepoPath,
      repoInfo,
      interactiveScanResult,
      outputDir,
      facts,
      { verbose: options.verbose, saveTranscript: options.transcript, model: options.model }
    );
    
    // Cleanup after interactive mode
    if (!options.keepTemp) {
      try {
        await rm(interactiveRepoPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  } else {
    // Ensure process exits cleanly (SDK may have lingering connections)
    process.exit(0);
  }
}

/**
 * Run ask command - standalone Q&A mode
 */
async function runAsk(repoUrl: string, options: { branch?: string; verbose?: boolean; model?: string }): Promise<void> {
  console.log(chalk.bold.blue("\n=== Repo Bootcamp - Ask Mode ===\n"));

  // Resolve repository source (local path or GitHub URL)
  let repoSource: RepoSource;
  try {
    if (isLocalPath(repoUrl)) {
      console.log(chalk.gray("Using local repository..."));
    } else {
      console.log(chalk.gray("Cloning repository..."));
    }
    repoSource = await resolveRepo(repoUrl, process.cwd());
    console.log(chalk.gray(`Repository: ${repoSource.repoInfo.fullName}`));
  } catch (error: any) {
    console.error(chalk.red(`Failed to resolve repository: ${error.message}`));
    process.exit(1);
  }

  const repoPath = repoSource.path;
  const repoInfo = repoSource.repoInfo;

  // Scan
  console.log(chalk.gray("Scanning files..."));
  let scanResult: ScanResult;
  try {
    scanResult = await scanRepo(repoPath, 200);
  } catch (error: any) {
    console.error(chalk.red(`Scan failed: ${error.message}`));
    process.exit(1);
  }

  // Run interactive mode
  await runInteractiveMode(
    repoPath,
    repoInfo,
    scanResult,
    process.cwd(),
    undefined,
    { verbose: options.verbose, saveTranscript: true, model: options.model }
  );

  // Cleanup (only for cloned repos, not local paths)
  await repoSource.cleanup();
}

// CLI setup
const program = new Command();

program
  .name("bootcamp")
  .description("Turn any public GitHub repository into a Day 1 onboarding kit using GitHub Copilot SDK")
  .version(VERSION);

// Main command
program
  .argument("<repo-url>", "GitHub repository URL or local path (e.g., . or /path/to/repo)")
  .option("-b, --branch <branch>", "Branch to analyze", "")
  .option(
    "-f, --focus <focus>",
    "Focus area: onboarding, architecture, contributing, all",
    "all"
  )
  .option(
    "-a, --audience <audience>",
    "Target audience: new-hire, oss-contributor, internal-dev",
    "oss-contributor"
  )
  .option("-o, --output <dir>", "Output directory")
  .option("-m, --max-files <number>", "Maximum files to scan", "200")
  .option("--model <model>", "Override model selection (e.g., claude-opus-4-5)")
  .option("--no-clone", "Use GitHub API instead of cloning (faster but limited)")
  .option("--keep-temp", "Keep temporary clone directory")
  .option("--json-only", "Only generate repo_facts.json, skip markdown docs")
  .option("--stats", "Show detailed statistics after generation")
  .option("-v, --verbose", "Show detailed progress including tool calls")
  // New feature flags
  .option("-i, --interactive", "Start interactive Q&A mode after generation")
  .option("--transcript", "Save interactive session transcript to TRANSCRIPT.md")
  .option("-c, --compare <ref>", "Compare with another git ref (tag, branch, commit)")
  .option("--create-issues", "Create GitHub issues from FIRST_TASKS.md")
  .option("--dry-run", "Preview issues without creating (use with --create-issues)")
  .option("-s, --style <style>", "Output style: startup, enterprise, oss, devops", "oss")
  .option("--render-diagrams [format]", "Render diagrams.mmd to SVG/PNG (requires mermaid-cli)", "svg")
  .option("--format <format>", "Output format: markdown (default), json, html", "markdown")
  .option("--fast", "Fast mode: inline key files, skip tools, much faster (~15-30s)")
  .action(async (repoUrl: string, opts) => {
    const options: BootcampOptions = {
      branch: opts.branch,
      focus: opts.focus as BootcampOptions["focus"],
      audience: opts.audience as BootcampOptions["audience"],
      output: opts.output,
      maxFiles: parseInt(opts.maxFiles, 10),
      noClone: opts.clone === false,
      verbose: opts.verbose || false,
      model: opts.model,
      keepTemp: opts.keepTemp || false,
      jsonOnly: opts.jsonOnly || false,
      stats: opts.stats || false,
      fast: opts.fast || false,
      format: (opts.format || "markdown") as OutputFormat,
      // New options
      interactive: opts.interactive || false,
      transcript: opts.transcript || false,
      compare: opts.compare,
      createIssues: opts.createIssues || false,
      dryRun: opts.dryRun || false,
      style: opts.style as StylePack,
      renderDiagrams: opts.renderDiagrams !== undefined,
      diagramFormat: (opts.renderDiagrams === true ? "svg" : opts.renderDiagrams) as DiagramFormat,
    };

    if (!["onboarding", "architecture", "contributing", "all"].includes(options.focus)) {
      console.error(chalk.red(`Invalid focus: ${options.focus}`));
      process.exit(1);
    }

    if (!["new-hire", "oss-contributor", "internal-dev"].includes(options.audience)) {
      console.error(chalk.red(`Invalid audience: ${options.audience}`));
      process.exit(1);
    }

    if (options.format && !["markdown", "json", "html"].includes(options.format)) {
      console.error(chalk.red(`Invalid format: ${options.format}. Use: markdown, json, html`));
      process.exit(1);
    }

    if (options.style && !["startup", "enterprise", "oss", "devops"].includes(options.style)) {
      console.error(chalk.red(`Invalid style: ${options.style}. Use: startup, enterprise, oss, devops`));
      process.exit(1);
    }

    await run(repoUrl, options);
  });

// Ask subcommand
program
  .command("ask <repo-url>")
  .description("Start interactive Q&A mode without full generation (supports local paths)")
  .option("-b, --branch <branch>", "Branch to analyze")
  .option("-v, --verbose", "Show detailed output")
  .option("--model <model>", "Override model selection (e.g., claude-opus-4-5)")
  .action(async (repoUrl: string, opts) => {
    await runAsk(repoUrl, opts);
  });

// Web subcommand
program
  .command("web")
  .alias("serve")
  .description("Start local web demo server")
  .option("-p, --port <port>", "Port to listen on", "3000")
  .action((opts) => {
    startServer(parseInt(opts.port, 10));
  });

// Docs subcommand - Analyze and fix documentation
program
  .command("docs <repo-url>")
  .description("Analyze repo documentation for staleness and mismatches (supports local paths)")
  .option("--check", "Exit with code 1 if docs are stale (for CI)")
  .option("--fix", "Auto-fix stale documentation sections")
  .option("-b, --branch <branch>", "Branch to analyze", "")
  .option("-v, --verbose", "Show detailed output")
  .action(async (repoUrl: string, opts) => {
    await runDocsCommand(repoUrl, opts);
  });

/**
 * Run the docs analysis/fix command
 */
async function runDocsCommand(
  repoUrl: string,
  opts: { check?: boolean; fix?: boolean; branch?: string; verbose?: boolean }
) {
  console.log(chalk.bold("\n📚 Docs Analyzer\n"));

  // Resolve repository source (local path or GitHub URL)
  let repoSource: RepoSource;
  try {
    if (isLocalPath(repoUrl)) {
      console.log(chalk.dim("Using local repository..."));
    } else {
      console.log(chalk.dim("Cloning repository..."));
    }
    repoSource = await resolveRepo(repoUrl, process.cwd());
    console.log(chalk.dim(`Analyzing: ${repoSource.repoInfo.fullName}`));
  } catch (error) {
    console.error(chalk.red(`❌ Failed to resolve repository: ${error}`));
    process.exit(1);
  }

  const repoPath = repoSource.path;

  try {
    // Run analysis
    const analysis = await analyzeDocumentation(repoPath);

    // Display results
    console.log(chalk.bold("\n📋 Analysis Results\n"));

    // Version mismatches
    if (analysis.versionMismatches.length > 0) {
      console.log(chalk.yellow("⚠️  Version Mismatches:"));
      for (const m of analysis.versionMismatches) {
        console.log(
          chalk.dim(`   ${m.type}: `) +
            chalk.red(m.documented) +
            chalk.dim(" → ") +
            chalk.green(m.actual) +
            chalk.dim(` (${m.location})`)
        );
      }
      console.log();
    }

    // Framework issues
    if (analysis.frameworkIssues.length > 0) {
      console.log(chalk.yellow("⚠️  Undocumented Frameworks:"));
      for (const f of analysis.frameworkIssues) {
        console.log(
          chalk.dim("   - ") +
            chalk.cyan(f.framework) +
            (f.version ? chalk.dim(` (${f.version})`) : "")
        );
      }
      console.log();
    }

    // CLI drift
    if (analysis.cliDrift.length > 0) {
      console.log(chalk.yellow("⚠️  CLI Documentation Drift:"));
      for (const d of analysis.cliDrift) {
        if (d.type === "missing") {
          console.log(chalk.dim("   - ") + chalk.cyan(d.actual) + chalk.dim(" not documented"));
        } else if (d.type === "extra") {
          console.log(chalk.dim("   - ") + chalk.cyan(d.documented) + chalk.dim(" documented but doesn't exist"));
        }
      }
      console.log();
    }

    // Prerequisite issues
    if (analysis.prerequisiteIssues.length > 0) {
      console.log(chalk.yellow("⚠️  Undocumented Prerequisites:"));
      for (const p of analysis.prerequisiteIssues) {
        const icon = p.type === "env" ? "🔑" : "🔧";
        console.log(chalk.dim(`   ${icon} `) + chalk.cyan(p.name));
      }
      console.log();
    }

    // Badge issues
    if (analysis.badgeIssues.length > 0) {
      console.log(chalk.yellow("⚠️  Badge Issues:"));
      for (const b of analysis.badgeIssues) {
        console.log(
          chalk.dim(`   Line ${b.line}: `) +
            chalk.red(b.status) +
            chalk.dim(` - ${b.url.slice(0, 60)}...`)
        );
      }
      console.log();
    }

    // Summary
    console.log(chalk.bold("Summary:"));
    if (analysis.summary.errors > 0) {
      console.log(chalk.red(`   ❌ ${analysis.summary.errors} error(s)`));
    }
    if (analysis.summary.warnings > 0) {
      console.log(chalk.yellow(`   ⚠️  ${analysis.summary.warnings} warning(s)`));
    }
    if (!analysis.isStale) {
      console.log(chalk.green("   ✅ Documentation is up to date!"));
    }

    // Fix mode
    if (opts.fix && analysis.isStale) {
      console.log(chalk.bold("\n🔧 Applying fixes...\n"));
      const fixResult = await fixDocumentation(repoPath, analysis);

      if (fixResult.changesApplied > 0) {
        for (const r of fixResult.results) {
          console.log(chalk.green(`   ✅ ${r.file}:`));
          for (const change of r.changes) {
            console.log(chalk.dim(`      - ${change}`));
          }
        }
        console.log(
          chalk.green(`\n   Applied ${fixResult.changesApplied} fix(es) to ${fixResult.filesModified} file(s)`)
        );
      } else {
        console.log(chalk.dim("   No automatic fixes available for detected issues."));
      }
    }

    // Exit code for CI
    if (opts.check && analysis.isStale) {
      console.log(chalk.red("\n❌ Documentation is stale. Run with --fix to auto-repair.\n"));
      process.exit(1);
    }

    console.log();
  } finally {
    // Cleanup (only for cloned repos, not local paths)
    await repoSource.cleanup();
  }
}

const shouldRunCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (shouldRunCli) {
  program.parse();
}
