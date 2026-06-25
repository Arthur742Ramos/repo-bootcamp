/**
 * Inline HTML for the demo page
 */
export function getIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Repo Bootcamp</title>
  <style>
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
    .subtitle { color: var(--ink-muted); margin-bottom: 2rem; max-width: 70ch; }
    .input-group { display: flex; gap: 0.75rem; margin-bottom: 2rem; }
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
    .progress-item { padding: 0.35rem 0; display: flex; align-items: center; gap: 0.5rem; color: var(--ink-muted); }
    .progress-item.phase { color: var(--accent); font-weight: 600; }
    .progress-item.success { color: var(--success); }
    .progress-item.error { color: var(--danger); }
    .results { display: none; }
    .results.show { display: block; }
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
    .icon-btn:hover { border-color: var(--accent); }
    .icon-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent); }
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
    @media (max-width: 640px) {
      body { padding: 1.25rem; }
      .input-group { flex-direction: column; }
      #analyzeBtn { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Repo Bootcamp</h1>
    <p class="subtitle">Generate onboarding documentation for any GitHub repository</p>

    <form class="input-group" id="analyzeForm">
      <label class="sr-only" for="repoUrl">Repository URL</label>
      <input type="text" id="repoUrl" placeholder="https://github.com/owner/repo" />
      <button type="submit" id="analyzeBtn">Analyze</button>
    </form>

    <div class="progress" id="progress" style="display: none;" aria-live="polite"></div>

    <div class="results" id="results" aria-live="polite">
      <div class="stats" id="stats"></div>
      <h2 style="margin-bottom: 1rem;">Generated Files</h2>
      <div class="files" id="files"></div>
    </div>
  </div>

  <div
    class="modal"
    id="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="modalTitle"
  >
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modalTitle"></h2>
        <div class="modal-actions">
          <button class="icon-btn" type="button" id="copyBtn">Copy</button>
          <button class="icon-btn" type="button" id="downloadBtn">Download</button>
          <button class="close" type="button" id="closeBtn" aria-label="Close file preview">&times;</button>
        </div>
      </div>
      <pre id="modalContent"></pre>
    </div>
  </div>

  <script>
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
      'diagrams': 'Mermaid diagrams',
      'repo_facts.json': 'Structured data',
    };

    function getFileKey(filename) {
      if (filename === 'repo_facts.json') return filename;
      if (filename.endsWith('.html')) return filename.slice(0, -'.html'.length);
      if (filename.endsWith('.md')) return filename.slice(0, -'.md'.length);
      if (filename.endsWith('.mmd')) return filename.slice(0, -'.mmd'.length);
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

    async function analyze() {
      const repoUrl = document.getElementById('repoUrl').value.trim();
      if (!repoUrl) return alert('Please enter a repository URL');

      const btn = document.getElementById('analyzeBtn');
      btn.disabled = true;
      btn.textContent = 'Analyzing...';

      const progress = document.getElementById('progress');
      progress.style.display = 'block';
      progress.textContent = '';

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
        addProgressItem(err instanceof Error ? err.message : String(err), 'error');
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
      item.textContent = (type === 'phase' ? '▶ ' : type === 'success' ? '✓ ' : type === 'error' ? '✗ ' : '  ') + message;
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
      desc.textContent = fileDescriptions[getFileKey(filename)] || '';

      file.appendChild(name);
      file.appendChild(desc);
      filesContainer.appendChild(file);
    }

    function showResults(data) {
      const stats = document.getElementById('stats');
      stats.textContent = '';
      addStatCard(stats, data.stats.securityScore, 'Security Score (' + data.stats.securityGrade + ')', gradeTone(data.stats.securityGrade));
      addStatCard(stats, data.stats.riskScore, 'Onboarding Risk (' + data.stats.riskGrade + ')', gradeTone(data.stats.riskGrade));
      addStatCard(stats, data.stats.dependencies, 'Dependencies');
      addStatCard(stats, data.stats.toolCalls, 'Tool Calls');

      const files = document.getElementById('files');
      files.textContent = '';
      for (const filename of data.files) {
        addGeneratedFile(files, filename);
      }

      document.getElementById('results').classList.add('show');
    }

    async function viewFile(filename) {
      const content = await fetch('/api/jobs/' + currentJobId + '/files/' + encodeURIComponent(filename)).then(r => r.text());
      currentFile = { name: filename, content };
      document.getElementById('modalTitle').textContent = filename;
      document.getElementById('modalContent').textContent = content;
      const copyBtn = document.getElementById('copyBtn');
      copyBtn.textContent = 'Copy';
      copyBtn.classList.remove('copied');
      lastFocused = document.activeElement;
      document.getElementById('modal').classList.add('show');
      document.getElementById('closeBtn').focus();
    }

    function legacyCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
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

    function closeModal() {
      document.getElementById('modal').classList.remove('show');
      if (lastFocused && typeof lastFocused.focus === 'function') {
        lastFocused.focus();
      }
      lastFocused = null;
    }

    function resetButton() {
      const btn = document.getElementById('analyzeBtn');
      btn.disabled = false;
      btn.textContent = 'Analyze';
    }

    document.getElementById('analyzeForm').addEventListener('submit', (event) => {
      event.preventDefault();
      void analyze();
    });

    // Modal controls are wired here (not via inline onclick) to comply with the
    // server's Content-Security-Policy, which blocks inline event handlers.
    document.getElementById('copyBtn').addEventListener('click', () => { void copyFile(); });
    document.getElementById('downloadBtn').addEventListener('click', downloadFile);
    document.getElementById('closeBtn').addEventListener('click', closeModal);
    document.getElementById('modal').addEventListener('click', (event) => {
      if (event.target === document.getElementById('modal')) closeModal();
    });

    // Keep keyboard focus inside the dialog while it is open.
    document.getElementById('modal').addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusables = [
        document.getElementById('copyBtn'),
        document.getElementById('downloadBtn'),
        document.getElementById('closeBtn'),
      ];
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
      if (e.key === 'Escape') closeModal();
    });
  </script>
</body>
</html>`;
}
