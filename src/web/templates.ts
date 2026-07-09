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
    .progress-item { padding: 0.35rem 0; display: flex; align-items: center; gap: 0.5rem; color: var(--ink-muted); }
    .progress-item.phase { color: var(--accent); font-weight: 600; }
    .progress-item.success { color: var(--success); }
    .progress-item.warning { color: var(--warning); }
    .progress-item.error { color: var(--danger); }
    .results { display: none; }
    .results.show { display: block; }
    #filesHeading { border-radius: var(--r-sm); margin-bottom: 1rem; }
    #filesHeading:focus { outline: none; }
    #filesHeading:focus-visible { box-shadow: 0 0 0 2px var(--canvas), 0 0 0 4px var(--accent); }
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
      <p id="repoUrlHint" class="field-hint">HTTPS, SSH, scheme-less URLs, and owner/repo shorthand are supported.</p>
      <p id="repoUrlError" class="field-error" role="alert" hidden></p>
    </form>

    <div class="progress" id="progress" hidden role="log" aria-live="polite"></div>
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

    <div class="results" id="results">
      <div class="stats" id="stats"></div>
      <h2 id="filesHeading" tabindex="-1">Generated Files</h2>
      <div class="files" id="files"></div>
    </div>
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

      const btn = document.getElementById('analyzeBtn');
      const form = document.getElementById('analyzeForm');
      const status = document.getElementById('statusMsg');
      form.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      btn.textContent = 'Analyzing...';

      const progress = document.getElementById('progress');
      progress.hidden = false;
      progress.textContent = '';
      addProgressItem('Starting analysis...');
      status.textContent = 'Starting repository analysis';

      document.getElementById('emptyState').hidden = true;
      document.getElementById('results').classList.remove('show');

      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoUrl }),
        });

        const payload = await readJsonResponse(res);
        if (typeof payload.jobId !== 'string' || !payload.jobId) {
          throw new Error('The server did not return a job ID.');
        }

        currentJobId = payload.jobId;
        streamProgress(payload.jobId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        addProgressItem(message, 'error');
        status.textContent = 'Analysis could not start: ' + message;
        resetButton();
      }
    }

    function streamProgress(jobId) {
      const evtSource = new EventSource('/api/jobs/' + jobId + '/stream');
      let settled = false;

      evtSource.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch (error) {
          settled = true;
          evtSource.close();
          addProgressItem('The server sent invalid progress data.', 'error');
          document.getElementById('statusMsg').textContent = 'Analysis stopped because progress data was invalid';
          resetButton();
          return;
        }
        if (!data || typeof data.type !== 'string' || typeof data.message !== 'string') {
          settled = true;
          evtSource.close();
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
          resetButton();
        } else if (data.type === 'error') {
          settled = true;
          addProgressItem(data.message, 'error');
          document.getElementById('statusMsg').textContent = 'Analysis failed: ' + data.message;
          evtSource.close();
          resetButton();
        }
      };

      evtSource.onerror = () => {
        // A clean end-of-stream after 'complete'/'error' also surfaces as onerror;
        // once we've settled there is nothing to recover.
        if (settled) return;
        // The job keeps running server-side. Close this stream so the browser's
        // built-in auto-reconnect doesn't replay the entire buffered log, show a
        // visible retry notice, then poll the job status until it finishes.
        settled = true;
        evtSource.close();
        addProgressItem('Connection lost — retrying…', 'warning');
        document.getElementById('statusMsg').textContent = 'Connection lost. Retrying analysis status.';
        pollJobStatus(jobId);
      };
    }

    function pollJobStatus(jobId) {
      let attempts = 0;
      const maxAttempts = 150; // ~5 minutes at a 2s interval

      const poll = async () => {
        attempts++;
        try {
          const res = await fetch('/api/jobs/' + jobId);
          const job = await readJsonResponse(res);
          if (job.status === 'complete' && job.result) {
            addProgressItem('Reconnected — analysis complete.', 'success');
            showResults(job.result);
            resetButton();
            return;
          }
          if (job.status === 'error') {
            const message = typeof job.error === 'string' ? job.error : 'Analysis failed';
            addProgressItem(message, 'error');
            document.getElementById('statusMsg').textContent = 'Analysis failed: ' + message;
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
        setTimeout(poll, 2000);
      };

      setTimeout(poll, 2000);
    }

    function addProgressItem(message, type = '') {
      const progress = document.getElementById('progress');
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
      progress.scrollTop = progress.scrollHeight;
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
      const stats = document.getElementById('stats');
      stats.textContent = '';
      addStatCard(stats, data.stats.securityScore, 'Security Score (' + data.stats.securityGrade + ')', gradeTone(data.stats.securityGrade));
      addStatCard(stats, data.stats.riskScore, 'Onboarding Risk (' + data.stats.riskGrade + ')', gradeTone(data.stats.riskGrade));
      addStatCard(stats, data.stats.dependencies, 'Dependencies');
      // Surface a metric the reader of a repo cares about (documents produced)
      // rather than internal agent telemetry; the tool-call count stays in the
      // progress log for anyone debugging the run.
      addStatCard(stats, data.files.length, 'Files Generated');

      const files = document.getElementById('files');
      files.textContent = '';
      for (const filename of data.files) {
        addGeneratedFile(files, filename);
      }

      document.getElementById('results').classList.add('show');

      // Announce completion once, concisely, via a dedicated status region, then
      // move focus to the results heading so keyboard and screen-reader users land
      // on the fresh output instead of being stranded at the end of a long log.
      const status = document.getElementById('statusMsg');
      if (status) {
        status.textContent = 'Analysis complete — ' + data.files.length + ' files generated';
      }
      const heading = document.getElementById('filesHeading');
      if (heading) {
        heading.focus();
        heading.scrollIntoView({ block: 'start' });
      }
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
      const btn = document.getElementById('analyzeBtn');
      btn.disabled = false;
      btn.textContent = 'Analyze';
      document.getElementById('analyzeForm').removeAttribute('aria-busy');
    }

    document.getElementById('analyzeForm').addEventListener('submit', (event) => {
      event.preventDefault();
      void analyze();
    });

    // Clear the inline validation message as soon as the user edits the field.
    document.getElementById('repoUrl').addEventListener('input', () => setUrlError(''));

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
  </script>
</body>
</html>`;
}
