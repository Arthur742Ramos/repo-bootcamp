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

    function addStatCard(statsContainer, value, label) {
      const stat = document.createElement('div');
      stat.className = 'stat';

      const statValue = document.createElement('div');
      statValue.className = 'stat-value';
      statValue.textContent = String(value);

      const statLabel = document.createElement('div');
      statLabel.className = 'stat-label';
      statLabel.textContent = label;

      stat.appendChild(statValue);
      stat.appendChild(statLabel);
      statsContainer.appendChild(stat);
    }

    function addGeneratedFile(filesContainer, filename) {
      const file = document.createElement('div');
      file.className = 'file';
      file.dataset.file = filename;
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
      addStatCard(stats, data.stats.securityScore, 'Security Score (' + data.stats.securityGrade + ')');
      addStatCard(stats, data.stats.riskScore, 'Onboarding Risk (' + data.stats.riskGrade + ')');
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
