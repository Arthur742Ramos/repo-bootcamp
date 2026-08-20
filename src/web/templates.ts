/**
 * Inline HTML for the demo page
 */
function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function getIndexHtml(nonce?: string): string {
  const nonceAttribute = nonce ? ` nonce="${escapeHtmlAttribute(nonce)}"` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Repo Bootcamp</title>
  <style${nonceAttribute}>
    :root {
      --canvas: #0d1117;
      --surface: #161b22;
      --surface-raised: #21262d;
      --border: #30363d;
      --ink: #e6edf3;
      --ink-muted: #8b949e;
      --ink-subtle: #6e7681;
      --accent: #00d9ff;
      --accent-hover: #2bb8d9;
      --accent-press: #1f9fbf;
      --success: #3fb950;
      --danger: #f85149;
      --warning: #d29922;
      --scrim: rgba(0, 0, 0, 0.8);
      --r-sm: 6px;
      --r-md: 8px;
      --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
      --ease: cubic-bezier(0.165, 0.84, 0.44, 1);
      --dur-fast: 150ms;
      --dur-base: 200ms;
      --z-backdrop: 1000;
      --z-modal: 1100;
      --z-toast: 1200;
      --z-tooltip: 1300;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      background: var(--canvas);
      color: var(--ink);
      min-height: 100vh;
      padding: 2rem;
      -webkit-font-smoothing: antialiased;
    }
    body.modal-open { overflow: hidden; }
    .container { max-width: 900px; margin: 0 auto; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      line-height: 1.1;
      color: var(--ink);
      text-wrap: balance;
      margin-bottom: 0.25rem;
    }
    .subtitle { color: var(--ink-muted); max-width: 70ch; text-wrap: pretty; }
    .analyze-form { margin: 2rem 0; }
    .field-label { display: block; margin-bottom: 0.5rem; color: var(--ink); font-size: 0.8125rem; font-weight: 600; }
    .input-group { display: flex; gap: 0.75rem; }
    .field-hint { color: var(--ink-muted); font-size: 0.8125rem; margin-top: 0.5rem; }
    .field-error { color: var(--danger); font-size: 0.8125rem; margin-top: 0.5rem; }
    .field-error[hidden] { display: none; }
    .form-actions { display: flex; gap: 0.75rem; align-items: center; margin-top: 0.75rem; }
    .secondary-btn {
      padding: 0.7rem 1rem;
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      background: var(--surface);
      color: var(--ink);
      font-size: 0.8125rem;
      font-weight: 600;
      transition: background var(--dur-base) var(--ease), border-color var(--dur-base) var(--ease);
    }
    .secondary-btn:hover { background: var(--surface-raised); border-color: var(--accent); }
    .secondary-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--canvas), 0 0 0 4px var(--accent); }
    .secondary-btn:disabled { color: var(--ink-subtle); cursor: not-allowed; }
    .secondary-btn.danger:hover { border-color: var(--danger); color: var(--danger); }
    .advanced-options { margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 0.75rem; }
    .advanced-options summary { color: var(--ink-muted); cursor: pointer; font-size: 0.8125rem; font-weight: 600; }
    .advanced-options summary:focus-visible { outline: none; color: var(--ink); box-shadow: 0 0 0 2px var(--accent); }
    .options-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.75rem; margin-top: 0.75rem; }
    .option-field { display: flex; flex-direction: column; gap: 0.35rem; }
    .option-field label { color: var(--ink-muted); font-size: 0.75rem; font-weight: 600; }
    .option-field input, .option-field select { width: 100%; min-width: 0; padding: 0.6rem 0.7rem; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--canvas); color: var(--ink); font: 0.8125rem var(--font-mono); }
    .option-field input:focus-visible, .option-field select:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0, 217, 255, 0.25); }
    .empty-state {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      padding: 1.5rem;
    }
    .empty-state h2 { margin-bottom: 0.5rem; }
    .empty-state > p { color: var(--ink-muted); max-width: 70ch; text-wrap: pretty; }
    .empty-details {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: 0.6rem 1rem;
      margin-top: 1.25rem;
    }
    .empty-details dt { color: var(--ink); font-family: var(--font-mono); font-size: 0.8125rem; font-weight: 600; }
    .empty-details dd { color: var(--ink-muted); font-size: 0.8125rem; }
    input {
      flex: 1;
      min-width: 0;
      padding: 0.8rem 1rem;
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      background: var(--canvas);
      color: var(--ink);
      font-family: var(--font-mono);
      font-size: 0.9rem;
      transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
    }
    input::placeholder { color: var(--ink-muted); }
    input:focus-visible {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(0, 217, 255, 0.25);
    }
    button { font-family: var(--font-sans); cursor: pointer; }
    #analyzeBtn {
      padding: 0.8rem 1.75rem;
      border: none;
      border-radius: var(--r-sm);
      background: var(--accent);
      color: var(--canvas);
      font-weight: 600;
      font-size: 0.875rem;
      white-space: nowrap;
      transition: background var(--dur-base) var(--ease);
    }
    #analyzeBtn:hover { background: var(--accent-hover); }
    #analyzeBtn:active { background: var(--accent-press); }
    #analyzeBtn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--canvas), 0 0 0 4px var(--accent); }
    #analyzeBtn:disabled { background: var(--surface-raised); color: var(--ink-subtle); cursor: not-allowed; }
    .progress {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      padding: 1.5rem;
      margin-bottom: 2rem;
      max-height: 300px;
      overflow-y: auto;
      font-family: var(--font-mono);
      font-size: 0.875rem;
    }
    .progress[hidden] { display: none; }
    .progress-header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 0.5rem; }
    .progress-title { color: var(--ink); font-size: 0.8125rem; font-weight: 600; }
    .progress-meta { color: var(--ink-muted); font: 0.75rem var(--font-mono); }
    .progress-item { padding: 0.35rem 0; display: flex; align-items: center; gap: 0.5rem; color: var(--ink-muted); }
    .progress-item.phase { color: var(--accent); font-weight: 600; }
    .progress-item.success { color: var(--success); }
    .progress-item.warning { color: var(--warning); }
    .progress-item.error { color: var(--danger); }
    .results { display: none; }
    .results.show { display: block; }
    #resultsHeading { border-radius: var(--r-sm); margin-bottom: 0.5rem; }
    #resultsHeading:focus { outline: none; }
    #resultsHeading:focus-visible { box-shadow: 0 0 0 2px var(--canvas), 0 0 0 4px var(--accent); }
    .score-guide { color: var(--ink-muted); font-size: 0.8125rem; margin-bottom: 1rem; max-width: 70ch; text-wrap: pretty; }
    .result-summary { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(260px, 0.8fr); gap: 1rem; margin: 1.25rem 0 1.5rem; }
    .summary-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); padding: 1.25rem; }
    .summary-panel h3 { font-size: 1rem; margin-bottom: 0.5rem; }
    .summary-panel p { color: var(--ink-muted); font-size: 0.875rem; line-height: 1.5; }
    .result-meta { color: var(--ink-muted); font: 0.75rem var(--font-mono); margin-top: 0.75rem; overflow-wrap: anywhere; }
    .next-steps { list-style: none; display: grid; gap: 0.65rem; margin-top: 0.75rem; }
    .next-step { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.65rem; align-items: start; }
    .next-step-marker { color: var(--accent); font: 700 0.875rem var(--font-mono); }
    .next-step-title { color: var(--ink); font-size: 0.8125rem; font-weight: 600; }
    .next-step-detail { color: var(--ink-muted); font-size: 0.75rem; margin-top: 0.15rem; }
    .result-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin: 1rem 0; }
    .result-toolbar-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .summary-actions { margin-top: 0.9rem; }
    .ask-panel { margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 0.9rem; }
    .ask-panel summary { color: var(--ink); cursor: pointer; font-size: 0.8125rem; font-weight: 600; }
    .ask-panel summary:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--accent); }
    .ask-form { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
    .ask-form input { padding: 0.65rem 0.75rem; font-size: 0.8125rem; }
    .ask-form button { white-space: nowrap; }
    .ask-answer { color: var(--ink); font-size: 0.8125rem; line-height: 1.55; margin-top: 0.75rem; white-space: pre-wrap; }
    .ask-answer.error { color: var(--danger); }
    .ask-answer[hidden] { display: none; }
    #fileSearch { flex: 1; max-width: 340px; padding: 0.65rem 0.75rem; }
    #filesHeading { margin-bottom: 1rem; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .stat { background: var(--surface); border: 1px solid var(--border); padding: 1.25rem 1rem; border-radius: var(--r-md); text-align: center; }
    .stat-value { font-family: var(--font-mono); font-size: 2rem; font-weight: 700; color: var(--ink); line-height: 1; }
    .stat-value.success { color: var(--success); }
    .stat-value.warning { color: var(--warning); }
    .stat-value.danger { color: var(--danger); }
    .stat-label { color: var(--ink-muted); font-size: 0.8125rem; margin-top: 0.4rem; }
    h2 { font-size: 1.25rem; font-weight: 600; }
    .files { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .file {
      display: block;
      width: 100%;
      text-align: left;
      background: var(--surface);
      border: 1px solid var(--border);
      padding: 1rem;
      border-radius: var(--r-md);
      transition: background var(--dur-base) var(--ease), border-color var(--dur-base) var(--ease);
    }
    .file:hover { background: var(--surface-raised); }
    .file[hidden] { display: none; }
    .file:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0, 217, 255, 0.25); }
    .file-name { font-family: var(--font-mono); font-weight: 600; font-size: 0.9rem; color: var(--ink); margin-bottom: 0.25rem; word-break: break-all; }
    .file-desc { color: var(--ink-muted); font-size: 0.8125rem; }
    .modal { display: none; position: fixed; inset: 0; background: var(--scrim); z-index: var(--z-modal); padding: 2rem; overflow-y: auto; }
    .modal.show { display: block; }
    #modalContent.load-error { color: var(--danger); }
    .modal-content { max-width: 900px; margin: 0 auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); padding: 1.5rem; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; gap: 1rem; }
    .modal-header h2 { font-family: var(--font-mono); font-size: 1rem; font-weight: 600; word-break: break-all; }
    .modal-actions { display: flex; gap: 0.5rem; align-items: center; }
    .icon-btn {
      padding: 0.45rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      background: var(--surface-raised);
      color: var(--ink);
      font-size: 0.8125rem;
      font-weight: 600;
      transition: border-color var(--dur-fast) var(--ease);
    }
    .icon-btn:not(:disabled):hover { border-color: var(--accent); }
    .icon-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent); }
    .icon-btn:disabled { border-color: var(--border); color: var(--ink-subtle); cursor: not-allowed; }
    .icon-btn.copied { border-color: var(--success); color: var(--success); }
    .close {
      background: none;
      border: none;
      color: var(--ink-muted);
      font-size: 1.75rem;
      line-height: 1;
      padding: 0 0.35rem;
      border-radius: var(--r-sm);
    }
    .close:hover { color: var(--ink); }
    .close:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent); }
    pre {
      background: var(--canvas);
      border: 1px solid var(--border);
      padding: 1rem;
      border-radius: var(--r-sm);
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: var(--font-mono);
      font-size: 0.875rem;
      line-height: 1.5;
      color: var(--ink);
    }
    .clipboard-fallback { position: fixed; opacity: 0; pointer-events: none; }
    .empty-filter { color: var(--ink-muted); font-size: 0.8125rem; padding: 0.75rem 0; }
    .empty-filter[hidden] { display: none; }
    @media (max-width: 640px) {
      body { padding: 1.25rem; }
      .input-group { flex-direction: column; }
      #analyzeBtn { width: 100%; }
      .modal { padding: 0.75rem; }
      .modal-content { padding: 1rem; }
      .modal-header { align-items: flex-start; flex-direction: column; }
      .modal-actions { width: 100%; }
      .icon-btn { flex: 1; }
      .close { margin-left: auto; }
      .empty-details { grid-template-columns: 1fr; gap: 0.25rem; }
      .empty-details dd { margin-bottom: 0.5rem; }
      .options-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .result-summary { grid-template-columns: 1fr; }
      .result-toolbar { align-items: stretch; flex-direction: column; }
      #fileSearch { max-width: none; }
      .ask-form { flex-direction: column; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Repo Bootcamp</h1>
    <p class="subtitle">Turn a public GitHub, GitLab, or Bitbucket repository into a Day-1 onboarding kit.</p>

    <form class="analyze-form" id="analyzeForm">
      <label class="field-label" for="repoUrl">Repository URL</label>
      <div class="input-group">
        <input
          type="text"
          id="repoUrl"
          placeholder="https://github.com/owner/repo"
          inputmode="url"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          aria-describedby="repoUrlHint repoUrlError"
        />
        <button type="submit" id="analyzeBtn">Analyze</button>
      </div>
      <div class="form-actions">
        <button class="secondary-btn danger" type="button" id="cancelBtn" hidden>Cancel analysis</button>
        <button class="secondary-btn" type="button" id="retryBtn" hidden>Retry analysis</button>
      </div>
      <p id="repoUrlHint" class="field-hint">HTTPS, SSH, scheme-less URLs, and owner/repo shorthand are supported.</p>
      <p id="repoUrlError" class="field-error" role="alert" hidden></p>
      <details class="advanced-options" id="advancedOptions">
        <summary>Run options</summary>
        <div class="options-grid">
          <div class="option-field">
            <label for="branch">Branch (optional)</label>
            <input id="branch" type="text" placeholder="main" autocomplete="off" spellcheck="false" />
          </div>
          <div class="option-field">
            <label for="focus">Focus</label>
            <select id="focus">
              <option value="all">All areas</option>
              <option value="onboarding">Onboarding</option>
              <option value="architecture">Architecture</option>
              <option value="contributing">Contributing</option>
            </select>
          </div>
          <div class="option-field">
            <label for="audience">Audience</label>
            <select id="audience">
              <option value="all">Everyone</option>
              <option value="backend">Backend</option>
              <option value="frontend">Frontend</option>
              <option value="sre">SRE / operations</option>
            </select>
          </div>
          <div class="option-field">
            <label for="maxFiles">Scan limit</label>
            <input id="maxFiles" type="number" min="1" max="1000" step="1" value="200" inputmode="numeric" />
          </div>
        </div>
      </details>
    </form>

    <div class="progress" id="progress" hidden role="log" aria-live="polite">
      <div class="progress-header">
        <span class="progress-title">Analysis progress</span>
        <span class="progress-meta" id="progressMeta"></span>
      </div>
      <div id="progressItems"></div>
    </div>
    <div id="statusMsg" role="status" class="sr-only"></div>

    <section class="empty-state" id="emptyState" aria-labelledby="emptyStateTitle">
      <h2 id="emptyStateTitle">From repository to first task</h2>
      <p>Repo Bootcamp investigates the codebase, streams each phase, and returns an interconnected onboarding kit you can inspect before downloading.</p>
      <dl class="empty-details">
        <dt>Input</dt>
        <dd>A public repository; the web demo always uses a shallow clone.</dd>
        <dt>Output</dt>
        <dd>Setup, architecture, codemap, starter tasks, security, health, metrics, and diagrams.</dd>
        <dt>Typical run</dt>
        <dd>Under 60 seconds, with progress visible throughout.</dd>
      </dl>
    </section>

    <section class="results" id="results" aria-labelledby="resultsHeading">
      <h2 id="resultsHeading" tabindex="-1">Analysis Readout</h2>
      <p class="score-guide" id="scoreGuide">Higher security scores are better; lower onboarding risk scores are better. Grades run from A (strongest) to F (weakest).</p>
      <div class="stats" id="stats" aria-describedby="scoreGuide"></div>
      <div class="result-summary">
        <section class="summary-panel" aria-labelledby="summaryHeading">
          <h3 id="summaryHeading">Start here</h3>
          <p id="summaryDescription">The analysis is complete. Begin with the recommended task and the setup commands below.</p>
          <p class="result-meta" id="resultMeta"></p>
          <div class="result-toolbar-actions summary-actions">
            <button class="secondary-btn" type="button" id="copyCommandBtn">Copy CLI command</button>
            <button class="secondary-btn" type="button" id="downloadAllBtn">Download kit</button>
            <button class="secondary-btn" type="button" id="issuesPreviewBtn" hidden>Issue preview</button>
          </div>
          <details class="ask-panel" id="askPanel">
            <summary>Ask a follow-up question</summary>
            <form class="ask-form" id="askForm">
              <input id="askQuestion" type="text" maxlength="1000" placeholder="Where should I start reading?" aria-label="Ask a question about this repository" />
              <button class="secondary-btn" type="submit" id="askBtn">Ask</button>
            </form>
            <p class="ask-answer" id="askAnswer" role="status" hidden></p>
          </details>
        </section>
        <section class="summary-panel" aria-labelledby="nextStepsHeading">
          <h3 id="nextStepsHeading">Recommended next steps</h3>
          <ol class="next-steps" id="nextSteps"></ol>
        </section>
      </div>
      <div class="result-toolbar">
        <h2 id="filesHeading">Generated Files</h2>
        <input id="fileSearch" type="search" placeholder="Filter files…" aria-label="Filter generated files" />
      </div>
      <div class="files" id="files"></div>
      <p class="empty-filter" id="emptyFilter" hidden>No generated files match that filter.</p>
    </section>
  </div>

  <div
    class="modal"
    id="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="modalTitle"
    aria-hidden="true"
  >
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modalTitle"></h2>
        <div class="modal-actions">
          <button class="icon-btn" type="button" id="copyBtn" disabled>Copy</button>
          <button class="icon-btn" type="button" id="downloadBtn" disabled>Download</button>
          <button class="close" type="button" id="closeBtn" aria-label="Close file preview">&times;</button>
        </div>
      </div>
      <pre id="modalContent" tabindex="0"></pre>
    </div>
  </div>

  <script${nonceAttribute}>
    let currentJobId = null;
    let currentFile = null;
    let lastFocused = null;
    let currentEventSource = null;
    let latestResult = null;
    let currentRunOptions = {};
    let progressStartedAt = null;
    let progressTimer = null;
    let activeRunToken = 0;
    let pollTimer = null;

    const fileDescriptions = {
      'BOOTCAMP': 'One-page overview',
      'ONBOARDING': 'Setup guide',
      'ARCHITECTURE': 'System design',
      'CODEMAP': 'Directory tour',
      'FIRST_TASKS': 'Starter issues',
      'RUNBOOK': 'Operations guide',
      'DEPENDENCIES': 'Dependency graph',
      'SECURITY': 'Security analysis',
      'RADAR': 'Tech radar',
      'IMPACT': 'Change impact map',
      'METRICS': 'Codebase metrics',
      'HEALTH': 'Onboarding readiness',
      'DIFF': 'Branch comparison',
      'ISSUES_PREVIEW': 'Issue creation preview',
      'diagrams': 'Mermaid diagrams',
      'repo_facts.json': 'Structured data',
      'ANALYSIS_MANIFEST.json': 'Run metadata and evidence map',
    };

    function getFileKey(filename) {
      if (filename === 'repo_facts.json') return filename;
      if (filename.endsWith('.html')) return filename.slice(0, -'.html'.length);
      if (filename.endsWith('.md')) return filename.slice(0, -'.md'.length);
      if (filename.endsWith('.mmd')) return filename.slice(0, -'.mmd'.length);
      if (filename.endsWith('.pdf')) return filename.slice(0, -'.pdf'.length);
      return filename;
    }

    // Map a letter grade to a semantic tone token used on stat values.
    function gradeTone(grade) {
      const g = String(grade || '').trim().charAt(0).toUpperCase();
      if (g === 'A' || g === 'B') return 'success';
      if (g === 'C') return 'warning';
      if (g === 'D' || g === 'E' || g === 'F') return 'danger';
      return '';
    }

    function setUrlError(message) {
      const input = document.getElementById('repoUrl');
      const err = document.getElementById('repoUrlError');
      if (message) {
        err.textContent = message;
        err.hidden = false;
        input.setAttribute('aria-invalid', 'true');
      } else {
        err.textContent = '';
        err.hidden = true;
        input.removeAttribute('aria-invalid');
      }
    }

    function requestErrorMessage(status) {
      if (status === 429) return 'Too many requests. Wait a moment and try again.';
      if (status === 503) return 'The server is at capacity. Try again shortly.';
      return 'Request failed (' + status + '). Please try again.';
    }

    async function readJsonResponse(response) {
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error(
          response.ok ? 'The server returned an invalid response.' : requestErrorMessage(response.status)
        );
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('The server returned an invalid response.');
      }
      if (!response.ok) {
        throw new Error(
          typeof payload.error === 'string' ? payload.error : requestErrorMessage(response.status)
        );
      }
      return payload;
    }

    function getRunOptions() {
      const maxFiles = Number.parseInt(document.getElementById('maxFiles').value, 10);
      return {
        branch: document.getElementById('branch').value.trim(),
        focus: document.getElementById('focus').value,
        audience: document.getElementById('audience').value,
        maxFiles: Number.isFinite(maxFiles) && maxFiles > 0 ? maxFiles : 200,
        format: 'markdown',
      };
    }

    function rememberJob(jobId) {
      try { localStorage.setItem('repo-bootcamp-job-id', jobId); } catch (error) { /* storage is optional */ }
    }

    function forgetJob() {
      try { localStorage.removeItem('repo-bootcamp-job-id'); } catch (error) { /* storage is optional */ }
    }

    function cancelStatusRecovery() {
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
    }

    function beginRun() {
      activeRunToken += 1;
      cancelStatusRecovery();
      if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
      }
      return activeRunToken;
    }

    function isCurrentRun(jobId, runToken) {
      return runToken === activeRunToken && currentJobId === jobId;
    }

    function startProgressClock(startAt) {
      progressStartedAt = startAt || Date.now();
      clearInterval(progressTimer);
      const update = () => {
        const elapsed = Math.max(0, Date.now() - progressStartedAt);
        document.getElementById('progressMeta').textContent = (elapsed / 1000).toFixed(1) + 's elapsed';
      };
      update();
      progressTimer = setInterval(update, 250);
    }

    function stopProgressClock() {
      clearInterval(progressTimer);
      progressTimer = null;
    }

    function setAnalysisBusy(isBusy) {
      const btn = document.getElementById('analyzeBtn');
      const cancelBtn = document.getElementById('cancelBtn');
      const form = document.getElementById('analyzeForm');
      btn.disabled = isBusy;
      btn.textContent = isBusy ? 'Analyzing...' : 'Analyze';
      cancelBtn.hidden = !isBusy;
      if (isBusy) form.setAttribute('aria-busy', 'true');
      else form.removeAttribute('aria-busy');
    }

    async function analyze() {
      const repoUrl = document.getElementById('repoUrl').value.trim();
      // Loose non-empty check only: parseGitHubUrl accepts owner/repo, SSH, and
      // scheme-less forms server-side, so strict URL validation here would reject
      // inputs the backend supports. Surface the empty case inline (not via a
      // blocking alert) so it reads as normal form validation.
      if (!repoUrl) {
        setUrlError('Please enter a repository URL');
        document.getElementById('repoUrl').focus();
        return;
      }
      setUrlError('');

      const status = document.getElementById('statusMsg');
      const runToken = beginRun();
      currentRunOptions = getRunOptions();
      setAnalysisBusy(true);
      document.getElementById('retryBtn').hidden = true;

      const progress = document.getElementById('progress');
      progress.hidden = false;
      document.getElementById('progressItems').textContent = '';
      startProgressClock(Date.now());
      addProgressItem('Starting analysis...');
      status.textContent = 'Starting repository analysis';

      document.getElementById('emptyState').hidden = true;
      document.getElementById('results').classList.remove('show');

      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoUrl, options: currentRunOptions }),
        });

        const payload = await readJsonResponse(res);
        if (typeof payload.jobId !== 'string' || !payload.jobId) {
          throw new Error('The server did not return a job ID.');
        }

        currentJobId = payload.jobId;
        rememberJob(payload.jobId);
        streamProgress(payload.jobId, runToken);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        addProgressItem(message, 'error');
        status.textContent = 'Analysis could not start: ' + message;
        resetButton();
        document.getElementById('retryBtn').hidden = false;
      }
    }

    function streamProgress(jobId, runToken = activeRunToken) {
      if (!isCurrentRun(jobId, runToken)) return;
      if (currentEventSource) currentEventSource.close();
      const evtSource = new EventSource('/api/jobs/' + jobId + '/stream');
      currentEventSource = evtSource;
      let settled = false;

      evtSource.onmessage = (event) => {
        if (!isCurrentRun(jobId, runToken)) {
          evtSource.close();
          return;
        }
        let data;
        try {
          data = JSON.parse(event.data);
        } catch (error) {
          settled = true;
          evtSource.close();
          currentEventSource = null;
          addProgressItem('The server sent invalid progress data.', 'error');
          document.getElementById('statusMsg').textContent = 'Analysis stopped because progress data was invalid';
          resetButton();
          return;
        }
        if (!data || typeof data.type !== 'string' || typeof data.message !== 'string') {
          settled = true;
          evtSource.close();
          currentEventSource = null;
          addProgressItem('The server sent an invalid progress event.', 'error');
          document.getElementById('statusMsg').textContent = 'Analysis stopped because a progress event was invalid';
          resetButton();
          return;
        }

        if (data.type === 'phase') {
          addProgressItem(data.message, 'phase');
        } else if (data.type === 'progress') {
          addProgressItem(data.message);
        } else if (data.type === 'complete') {
          settled = true;
          addProgressItem(data.message, 'success');
          showResults(data.data);
          evtSource.close();
          currentEventSource = null;
          forgetJob();
          stopProgressClock();
          cancelStatusRecovery();
          resetButton();
        } else if (data.type === 'error') {
          settled = true;
          addProgressItem(data.message, 'error');
          document.getElementById('statusMsg').textContent = 'Analysis failed: ' + data.message;
          evtSource.close();
          currentEventSource = null;
          stopProgressClock();
          cancelStatusRecovery();
          document.getElementById('retryBtn').hidden = false;
          forgetJob();
          resetButton();
        } else if (data.type === 'cancelled') {
          settled = true;
          addProgressItem(data.message, 'warning');
          document.getElementById('statusMsg').textContent = 'Analysis cancelled';
          evtSource.close();
          currentEventSource = null;
          stopProgressClock();
          cancelStatusRecovery();
          document.getElementById('retryBtn').hidden = false;
          forgetJob();
          resetButton();
        }
      };

      evtSource.onerror = () => {
        // A clean end-of-stream after 'complete'/'error' also surfaces as onerror;
        // once we've settled there is nothing to recover.
        if (settled || !isCurrentRun(jobId, runToken)) return;
        // The job keeps running server-side. Close this stream so the browser's
        // built-in auto-reconnect doesn't replay the entire buffered log, show a
        // visible retry notice, then poll the job status until it finishes.
        settled = true;
        evtSource.close();
        currentEventSource = null;
        addProgressItem('Connection lost — retrying…', 'warning');
        document.getElementById('statusMsg').textContent = 'Connection lost. Retrying analysis status.';
        pollJobStatus(jobId, runToken);
      };
    }

    function pollJobStatus(jobId, runToken = activeRunToken) {
      if (!isCurrentRun(jobId, runToken)) return;
      let attempts = 0;
      const maxAttempts = 150; // ~5 minutes at a 2s interval

      const poll = async () => {
        pollTimer = null;
        if (!isCurrentRun(jobId, runToken)) return;
        attempts++;
        try {
          const res = await fetch('/api/jobs/' + jobId);
          const job = await readJsonResponse(res);
          if (!isCurrentRun(jobId, runToken)) return;
          if (job.status === 'complete' && job.result) {
            addProgressItem('Reconnected — analysis complete.', 'success');
            showResults(job.result);
            forgetJob();
            stopProgressClock();
            cancelStatusRecovery();
            resetButton();
            return;
          }
          if (job.status === 'error') {
            const message = typeof job.error === 'string' ? job.error : 'Analysis failed';
            addProgressItem(message, 'error');
            document.getElementById('statusMsg').textContent = 'Analysis failed: ' + message;
            document.getElementById('retryBtn').hidden = false;
            forgetJob();
            stopProgressClock();
            cancelStatusRecovery();
            resetButton();
            return;
          }
          if (job.status === 'cancelled') {
            addProgressItem('Analysis cancelled.', 'warning');
            document.getElementById('statusMsg').textContent = 'Analysis cancelled';
            document.getElementById('retryBtn').hidden = false;
            forgetJob();
            stopProgressClock();
            cancelStatusRecovery();
            resetButton();
            return;
          }
        } catch (err) {
          // Transient failure — keep polling until the attempt ceiling.
        }
        if (attempts >= maxAttempts) {
          addProgressItem('Gave up waiting for the server to respond.', 'error');
          document.getElementById('statusMsg').textContent = 'Analysis status could not be recovered';
          resetButton();
          return;
        }
        pollTimer = setTimeout(poll, 2000);
      };

      pollTimer = setTimeout(poll, 2000);
    }

    function addProgressItem(message, type = '') {
      const progress = document.getElementById('progressItems');
      const item = document.createElement('div');
      item.className = 'progress-item ' + type;
      item.textContent = (
        type === 'phase'
          ? '▶ '
          : type === 'success'
            ? '✓ '
            : type === 'warning'
              ? '! '
              : type === 'error'
                ? '✗ '
                : '  '
      ) + message;
      progress.appendChild(item);
      const scrollContainer = document.getElementById('progress');
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }

    function addStatCard(statsContainer, value, label, tone = '') {
      const stat = document.createElement('div');
      stat.className = 'stat';

      const statValue = document.createElement('div');
      statValue.className = 'stat-value' + (tone ? ' ' + tone : '');
      statValue.textContent = String(value);

      const statLabel = document.createElement('div');
      statLabel.className = 'stat-label';
      statLabel.textContent = label;

      stat.appendChild(statValue);
      stat.appendChild(statLabel);
      statsContainer.appendChild(stat);
    }

    function addGeneratedFile(filesContainer, filename) {
      const file = document.createElement('button');
      file.type = 'button';
      file.className = 'file';
      file.dataset.file = filename;
      file.setAttribute('aria-label', 'Preview ' + filename);
      file.addEventListener('click', () => {
        void viewFile(filename);
      });

      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = filename;

      const desc = document.createElement('div');
      desc.className = 'file-desc';
      desc.textContent = fileDescriptions[getFileKey(filename)] || 'Generated document';

      file.appendChild(name);
      file.appendChild(desc);
      filesContainer.appendChild(file);
    }

    function showResults(data) {
      if (!data || typeof data !== 'object' || !data.stats || !Array.isArray(data.files)) {
        addProgressItem('Analysis finished, but the result payload was invalid.', 'error');
        document.getElementById('statusMsg').textContent = 'Analysis returned invalid results';
        return;
      }
      latestResult = data;
      const issuePreviewButton = document.getElementById('issuesPreviewBtn');
      issuePreviewButton.hidden = !(typeof data.issuePreview === 'string' && data.issuePreview.trim());
      const stats = document.getElementById('stats');
      stats.textContent = '';
      addStatCard(stats, data.stats.securityScore, 'Security Score (' + data.stats.securityGrade + ')', gradeTone(data.stats.securityGrade));
      addStatCard(stats, data.stats.riskScore, 'Onboarding Risk (' + data.stats.riskGrade + ')', gradeTone(data.stats.riskGrade));
      addStatCard(stats, data.stats.dependencies, 'Dependencies');
      // Surface a metric the reader of a repo cares about (documents produced)
      // rather than internal agent telemetry; the tool-call count stays in the
      // progress log for anyone debugging the run.
      addStatCard(stats, data.files.length, 'Files Generated');
      if (data.stats.durationMs !== undefined) {
        addStatCard(stats, (Number(data.stats.durationMs) / 1000).toFixed(1) + 's', 'Run time');
      }
      if (data.stats.filesScanned !== undefined) {
        addStatCard(stats, data.stats.filesScanned, 'Files Scanned');
      }

      const manifest = data.manifest && typeof data.manifest === 'object' ? data.manifest : null;
      if (manifest && manifest.options && typeof manifest.options === 'object') {
        currentRunOptions = { ...currentRunOptions, ...manifest.options };
      }
      const repository = manifest && manifest.repository && typeof manifest.repository === 'object'
        ? manifest.repository : null;
      const resultMeta = document.getElementById('resultMeta');
      const metaParts = [];
      if (repository && repository.fullName) metaParts.push(String(repository.fullName));
      if (repository && repository.branch) metaParts.push('branch ' + String(repository.branch));
      if (repository && repository.commitSha) metaParts.push('commit ' + String(repository.commitSha).slice(0, 8));
      if (data.stats.evidenceSources !== undefined) metaParts.push(String(data.stats.evidenceSources) + ' evidence files');
      resultMeta.textContent = metaParts.join(' · ');

      const nextSteps = document.getElementById('nextSteps');
      nextSteps.textContent = '';
      const recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];
      for (const task of recommendations.slice(0, 3)) {
        const item = document.createElement('li');
        item.className = 'next-step';
        const marker = document.createElement('span');
        marker.className = 'next-step-marker';
        marker.textContent = '→';
        const copy = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'next-step-title';
        title.textContent = task && task.title ? String(task.title) : 'Review a starter task';
        const detail = document.createElement('div');
        detail.className = 'next-step-detail';
        detail.textContent = task && task.files && task.files.length
          ? 'Touches ' + task.files.slice(0, 2).join(', ')
          : (task && task.why ? String(task.why) : 'Open FIRST_TASKS.md for the details.');
        copy.appendChild(title);
        copy.appendChild(detail);
        item.appendChild(marker);
        item.appendChild(copy);
        nextSteps.appendChild(item);
      }
      if (recommendations.length === 0) {
        const item = document.createElement('li');
        item.className = 'next-step-detail';
        item.textContent = 'Open BOOTCAMP.md for the overview, then ONBOARDING.md.';
        nextSteps.appendChild(item);
      }

      const files = document.getElementById('files');
      files.textContent = '';
      for (const filename of data.files) {
        addGeneratedFile(files, filename);
      }
      filterFiles();

      document.getElementById('results').classList.add('show');

      // Announce completion once, concisely, via a dedicated status region, then
      // move focus to the results heading so keyboard and screen-reader users land
      // on the fresh output instead of being stranded at the end of a long log.
      const status = document.getElementById('statusMsg');
      if (status) {
        status.textContent = 'Analysis complete — ' + data.files.length + ' files generated';
      }
      const heading = document.getElementById('resultsHeading');
      if (heading) {
        heading.focus();
        heading.scrollIntoView({ block: 'start' });
      }
    }

    function filterFiles() {
      const query = document.getElementById('fileSearch').value.trim().toLowerCase();
      const fileButtons = document.querySelectorAll('#files .file');
      let visible = 0;
      fileButtons.forEach((file) => {
        const matches = !query || String(file.dataset.file || '').toLowerCase().includes(query);
        file.hidden = !matches;
        if (matches) visible++;
      });
      document.getElementById('emptyFilter').hidden = visible !== 0 || fileButtons.length === 0;
    }

    async function viewFile(filename) {
      // Open the modal immediately with a loading placeholder so the click has an
      // instant, visible response; contents stream in when the fetch resolves.
      // currentFile stays null until a successful load so Copy/Download never act
      // on the placeholder or on an error message.
      currentFile = null;
      const modalContent = document.getElementById('modalContent');
      const copyBtn = document.getElementById('copyBtn');
      const downloadBtn = document.getElementById('downloadBtn');
      document.getElementById('modalTitle').textContent = filename;
      modalContent.classList.remove('load-error');
      modalContent.textContent = 'Loading…';
      copyBtn.textContent = 'Copy';
      copyBtn.classList.remove('copied');
      copyBtn.disabled = true;
      downloadBtn.disabled = true;
      openModal();

      try {
        const res = await fetch('/api/jobs/' + currentJobId + '/files/' + encodeURIComponent(filename));
        if (!res.ok) {
          // Error responses carry a JSON body; render a distinct error state rather
          // than dumping {"error":"..."} into the <pre> as if it were file content.
          modalContent.classList.add('load-error');
          modalContent.textContent = "Couldn't load " + filename + ' (' + res.status + ' ' + res.statusText + ')';
          return;
        }
        const content = await res.text();
        currentFile = { name: filename, content };
        modalContent.textContent = content;
        copyBtn.disabled = false;
        downloadBtn.disabled = false;
      } catch (err) {
        modalContent.classList.add('load-error');
        modalContent.textContent =
          "Couldn't load " + filename + ': ' + (err instanceof Error ? err.message : String(err));
      }
    }

    function legacyCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.className = 'clipboard-fallback';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }

    async function copyFile() {
      if (!currentFile) return;
      const btn = document.getElementById('copyBtn');
      btn.disabled = true;
      btn.textContent = 'Copying…';
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          // The async clipboard API can hang or be denied in some browsers;
          // race it against a short timeout and fall back to execCommand.
          await Promise.race([
            navigator.clipboard.writeText(currentFile.content),
            new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard timeout')), 1000)),
          ]);
          copied = true;
        } else {
          copied = legacyCopy(currentFile.content);
        }
      } catch (err) {
        copied = legacyCopy(currentFile.content);
      }

      btn.textContent = copied ? 'Copied!' : 'Copy failed';
      btn.classList.toggle('copied', copied);
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
        btn.disabled = currentFile === null;
      }, 1500);
    }

    function downloadFile() {
      if (!currentFile) return;
      const blob = new Blob([currentFile.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    async function downloadAll() {
      if (!currentJobId) return;
      const btn = document.getElementById('downloadAllBtn');
      btn.disabled = true;
      btn.textContent = 'Preparing…';
      try {
        const response = await fetch('/api/jobs/' + currentJobId + '/download');
        if (!response.ok) throw new Error('Download failed (' + response.status + ')');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'repo-bootcamp-kit.zip';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        btn.textContent = 'Downloaded!';
      } catch (error) {
        btn.textContent = 'Download failed';
        addProgressItem(error instanceof Error ? error.message : String(error), 'error');
      }
      setTimeout(() => {
        btn.textContent = 'Download kit';
        btn.disabled = false;
      }, 1500);
    }

    async function downloadIssuePreview() {
      if (!currentJobId) return;
      const btn = document.getElementById('issuesPreviewBtn');
      btn.disabled = true;
      btn.textContent = 'Preparing…';
      try {
        const response = await fetch('/api/jobs/' + currentJobId + '/issues-preview');
        if (!response.ok) throw new Error('Issue preview unavailable (' + response.status + ')');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'ISSUES_PREVIEW.md';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        btn.textContent = 'Preview downloaded!';
      } catch (error) {
        btn.textContent = 'Preview failed';
        addProgressItem(error instanceof Error ? error.message : String(error), 'error');
      }
      setTimeout(() => {
        btn.textContent = 'Issue preview';
        btn.disabled = false;
      }, 1500);
    }

    function buildCliCommand() {
      const repoUrl = document.getElementById('repoUrl').value.trim();
      const parts = ['bootcamp', repoUrl];
      if (currentRunOptions.branch) parts.push('--branch', currentRunOptions.branch);
      if (currentRunOptions.focus && currentRunOptions.focus !== 'all') parts.push('--focus', currentRunOptions.focus);
      if (currentRunOptions.audience && currentRunOptions.audience !== 'all') parts.push('--audience', currentRunOptions.audience);
      if (currentRunOptions.maxFiles && currentRunOptions.maxFiles !== 200) parts.push('--max-files', String(currentRunOptions.maxFiles));
      return parts.join(' ');
    }

    async function copyCliCommand() {
      const btn = document.getElementById('copyCommandBtn');
      const command = buildCliCommand();
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(command);
          copied = true;
        } else {
          copied = legacyCopy(command);
        }
      } catch (error) {
        copied = legacyCopy(command);
      }
      btn.textContent = copied ? 'Copied command!' : 'Copy failed';
      setTimeout(() => { btn.textContent = 'Copy CLI command'; }, 1500);
    }

    async function askQuestion() {
      if (!currentJobId) return;
      const input = document.getElementById('askQuestion');
      const btn = document.getElementById('askBtn');
      const answer = document.getElementById('askAnswer');
      const question = input.value.trim();
      if (!question) {
        input.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Thinking…';
      answer.classList.remove('error');
      answer.hidden = false;
      answer.textContent = 'Reading the repository…';
      try {
        const response = await fetch('/api/jobs/' + currentJobId + '/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
        });
        const payload = await readJsonResponse(response);
        answer.textContent = typeof payload.answer === 'string' ? payload.answer : 'No answer was returned.';
      } catch (error) {
        answer.classList.add('error');
        answer.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Ask';
      }
    }

    async function cancelAnalysis() {
      if (!currentJobId) return;
      const btn = document.getElementById('cancelBtn');
      btn.disabled = true;
      btn.textContent = 'Cancelling…';
      try {
        const response = await fetch('/api/jobs/' + currentJobId + '/cancel', { method: 'POST' });
        await readJsonResponse(response);
        addProgressItem('Cancellation requested…', 'warning');
        document.getElementById('statusMsg').textContent = 'Cancellation requested';
      } catch (error) {
        btn.disabled = false;
        btn.textContent = 'Cancel analysis';
        addProgressItem(error instanceof Error ? error.message : String(error), 'error');
      }
    }

    async function restoreJob() {
      let jobId = null;
      try { jobId = localStorage.getItem('repo-bootcamp-job-id'); } catch (error) { return; }
      if (!jobId) return;
      try {
        const response = await fetch('/api/jobs/' + encodeURIComponent(jobId));
        if (!response.ok) { forgetJob(); return; }
        const job = await readJsonResponse(response);
        if (!job || !job.id) { forgetJob(); return; }
        const runToken = beginRun();
        currentJobId = job.id;
        if (job.repoUrl) document.getElementById('repoUrl').value = job.repoUrl;
        document.getElementById('progress').hidden = false;
        document.getElementById('progressItems').textContent = '';
        startProgressClock(job.startedAt || Date.now());
        setAnalysisBusy(job.status === 'pending' || job.status === 'running');
        addProgressItem('Reconnected to the previous analysis.', 'warning');
        streamProgress(job.id, runToken);
      } catch (error) {
        forgetJob();
      }
    }

    // Open the file-preview dialog and isolate the background: the underlying
    // .container is made inert (with an aria-hidden fallback for engines lacking
    // inert support) and body scrolling is locked while the modal is up. .modal is
    // a sibling of .container, so inerting .container never traps the dialog.
    function openModal() {
      lastFocused = document.activeElement;
      const container = document.querySelector('.container');
      if (container) {
        container.inert = true;
        container.setAttribute('aria-hidden', 'true');
      }
      document.body.classList.add('modal-open');
      const modal = document.getElementById('modal');
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
      document.getElementById('closeBtn').focus();
    }

    function closeModal() {
      const modal = document.getElementById('modal');
      if (!modal.classList.contains('show')) return;
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      const container = document.querySelector('.container');
      if (container) {
        // Un-inert before restoring focus, since lastFocused lives inside .container.
        container.inert = false;
        container.removeAttribute('aria-hidden');
      }
      document.body.classList.remove('modal-open');
      if (lastFocused && typeof lastFocused.focus === 'function') {
        lastFocused.focus();
      }
      lastFocused = null;
    }

    function resetButton() {
      setAnalysisBusy(false);
      const cancelBtn = document.getElementById('cancelBtn');
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Cancel analysis';
    }

    document.getElementById('analyzeForm').addEventListener('submit', (event) => {
      event.preventDefault();
      void analyze();
    });

    // Clear the inline validation message as soon as the user edits the field.
    document.getElementById('repoUrl').addEventListener('input', () => setUrlError(''));
    document.getElementById('fileSearch').addEventListener('input', filterFiles);
    document.getElementById('cancelBtn').addEventListener('click', () => { void cancelAnalysis(); });
    document.getElementById('retryBtn').addEventListener('click', () => { void analyze(); });
    document.getElementById('downloadAllBtn').addEventListener('click', () => { void downloadAll(); });
    document.getElementById('issuesPreviewBtn').addEventListener('click', () => { void downloadIssuePreview(); });
    document.getElementById('copyCommandBtn').addEventListener('click', () => { void copyCliCommand(); });
    document.getElementById('askForm').addEventListener('submit', (event) => {
      event.preventDefault();
      void askQuestion();
    });

    // Modal controls are wired here (not via inline onclick) to comply with the
    // server's Content-Security-Policy, which blocks inline event handlers.
    document.getElementById('copyBtn').addEventListener('click', () => { void copyFile(); });
    document.getElementById('downloadBtn').addEventListener('click', downloadFile);
    document.getElementById('closeBtn').addEventListener('click', closeModal);
    document.getElementById('modal').addEventListener('click', (event) => {
      if (event.target === document.getElementById('modal')) closeModal();
    });

    // Keep keyboard focus inside the dialog while it is open. The focusable set is
    // queried from the live DOM at Tab time rather than hard-coded, so the trap
    // stays correct if controls are added, removed, hidden, or reordered.
    document.getElementById('modal').addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const content = document.querySelector('.modal-content');
      if (!content) return;
      const selector = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
      const focusables = Array.prototype.filter.call(
        content.querySelectorAll(selector),
        (el) => !el.disabled && el.offsetParent !== null
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('modal').classList.contains('show')) {
        closeModal();
      }
    });

    void restoreJob();
  </script>
</body>
</html>`;
}
