/** Static demo styles, kept inline by the HTML renderer for its CSP nonce. */
export const WEB_STYLES = `
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
      --z-reader-controls: 1;
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
    .skip-link {
      position: fixed;
      top: 0.75rem;
      left: 0.75rem;
      z-index: var(--z-toast);
      padding: 0.6rem 0.8rem;
      border: 1px solid var(--accent);
      border-radius: var(--r-sm);
      background: var(--surface);
      color: var(--ink);
      font-size: 0.8125rem;
      font-weight: 600;
      transform: translateY(-180%);
      transition: transform var(--dur-fast) var(--ease);
    }
    .skip-link:focus { transform: translateY(0); }
    .container { max-width: 900px; margin: 0 auto; padding-bottom: 3rem; }
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
    .input-group { display: flex; gap: 0.75rem; align-items: stretch; }
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
    .package-directory { grid-column: 1 / -1; }
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
      min-height: 44px;
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
      font-family: var(--font-mono);
      font-size: 0.875rem;
    }
    .progress[hidden] { display: none; }
    .progress-items { max-height: 180px; overflow-y: auto; overflow-wrap: anywhere; }
    .progress-items:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    .progress-header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 0.5rem; }
    .progress-title { color: var(--ink); font-size: 0.8125rem; font-weight: 600; }
    .progress-meta { color: var(--ink-muted); font: 0.75rem var(--font-mono); }
    .progress-item { padding: 0.35rem 0; display: flex; align-items: center; gap: 0.5rem; color: var(--ink-muted); }
    .progress-item.phase { color: var(--accent); font-weight: 600; }
    .progress-item.success { color: var(--success); }
    .progress-item.warning { color: var(--warning); }
    .progress-item.error { color: var(--danger); }
    .phase-rail {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 0.5rem;
      list-style: none;
      margin: 0.25rem 0 1rem;
    }
    .phase-step {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-width: 0;
      color: var(--ink-subtle);
      font-size: 0.7rem;
      font-weight: 600;
    }
    .phase-dot {
      display: grid;
      flex: 0 0 1.45rem;
      place-items: center;
      width: 1.45rem;
      height: 1.45rem;
      border: 1px solid var(--border);
      border-radius: 50%;
      color: var(--ink-subtle);
      font: 700 0.7rem var(--font-mono);
    }
    .phase-step span:last-child { overflow: hidden; text-overflow: ellipsis; }
    .phase-step.active { color: var(--accent); }
    .phase-step.active .phase-dot { border-color: var(--accent); color: var(--accent); }
    .phase-step.complete { color: var(--success); }
    .phase-step.complete .phase-dot { border-color: var(--success); color: var(--success); }
    .phase-step.error { color: var(--danger); }
    .phase-step.error .phase-dot { border-color: var(--danger); color: var(--danger); }
    .phase-step.cancelled { color: var(--warning); }
    .phase-step.cancelled .phase-dot { border-color: var(--warning); color: var(--warning); }
    .results { display: none; }
    .results.show { display: block; }
    #resultsHeading { border-radius: var(--r-sm); margin-bottom: 0.5rem; }
    #resultsHeading:focus { outline: none; }
    #resultsHeading:focus-visible { box-shadow: 0 0 0 2px var(--canvas), 0 0 0 4px var(--accent); }
    .score-guide { color: var(--ink-muted); font-size: 0.8125rem; margin-bottom: 0.75rem; max-width: 70ch; text-wrap: pretty; }
    .score-explain { margin-bottom: 1.25rem; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem; }
    .score-explain summary { width: fit-content; color: var(--ink); cursor: pointer; font-size: 0.8125rem; font-weight: 600; }
    .score-explain summary:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--accent); }
    .score-explain-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: 0.75rem; }
    .score-explain-grid h3 { font-size: 0.8125rem; margin-bottom: 0.25rem; }
    .score-explain-grid p, .score-factors { color: var(--ink-muted); font-size: 0.75rem; line-height: 1.5; }
    .score-factors { list-style: none; display: grid; gap: 0.25rem; margin-top: 0.4rem; }
    .score-factors li::before { content: '•'; color: var(--warning); margin-right: 0.4rem; }
    .result-summary { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(260px, 0.8fr); align-items: start; gap: 1rem; margin: 1.25rem 0 1.5rem; }
    .summary-panel { align-self: start; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); padding: 1.25rem; }
    .summary-panel h3 { font-size: 1rem; margin-bottom: 0.5rem; }
    .summary-panel p { color: var(--ink-muted); font-size: 0.875rem; line-height: 1.5; }
    .result-meta { color: var(--ink-muted); font: 0.75rem var(--font-mono); margin-top: 0.75rem; overflow-wrap: anywhere; }
    .result-meta a { color: var(--accent); text-decoration-color: transparent; text-underline-offset: 0.15em; }
    .result-meta a:hover { text-decoration-color: currentColor; }
    .next-steps { list-style: none; display: grid; gap: 0.65rem; margin-top: 0.75rem; }
    .next-step { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.65rem; align-items: start; }
    .next-step-marker { color: var(--accent); font: 700 0.875rem var(--font-mono); }
    .next-step-title { color: var(--ink); font-size: 0.8125rem; font-weight: 600; }
    .next-step-detail { color: var(--ink-muted); font-size: 0.75rem; margin-top: 0.15rem; }
    .next-step-action {
      display: inline-block;
      margin-top: 0.35rem;
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--accent);
      font: 600 0.75rem var(--font-sans);
      text-decoration: underline;
      text-decoration-color: transparent;
      text-underline-offset: 0.15em;
    }
    .next-step-action:hover { text-decoration-color: currentColor; }
    .next-step-action:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--accent); }
    .result-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin: 1rem 0; }
    .result-toolbar-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .summary-actions { margin-top: 0.9rem; }
    .command-panel, .quickstart-panel, .setup-guidance { margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 0.9rem; }
    .setup-guidance h4 { font-size: 0.875rem; margin-bottom: 0.5rem; }
    .setup-guidance p { margin-bottom: 0.5rem; overflow-wrap: anywhere; }
    .command-header, .quickstart-header { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }
    .command-header h4, .quickstart-header h4 { color: var(--ink); font-size: 0.8125rem; }
    .command-header span, .quickstart-header span { color: var(--ink-muted); font-size: 0.7rem; }
    .command-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.55rem;
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      background: var(--canvas);
      padding: 0.45rem 0.55rem;
    }
    .command-prefix { color: var(--success); font: 700 0.8rem var(--font-mono); }
    .command-row code { white-space: pre-wrap; min-width: 0; flex: 1; overflow-wrap: anywhere; color: var(--ink); font: 0.78rem var(--font-mono); }
    .command-row .icon-btn, .quickstart-item .icon-btn { flex: 0 0 auto; }
    .quickstart-list { display: grid; gap: 0.5rem; margin-top: 0.65rem; }
    .quickstart-item { display: flex; align-items: center; gap: 0.65rem; min-width: 0; }
    .quickstart-copy { display: flex; align-items: flex-start; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1; }
    .quickstart-name { flex: 0 0 auto; min-width: 0; max-width: 100%; overflow-wrap: anywhere; white-space: pre-wrap; color: var(--ink-muted); font-size: 0.72rem; font-weight: 600; }
    .quickstart-copy code { white-space: pre-wrap; min-width: 0; max-width: 100%; overflow-wrap: anywhere; color: var(--ink); font: 0.78rem var(--font-mono); }
    .quickstart-source { color: var(--ink-subtle); font: 0.68rem var(--font-mono); }
    .command-row .icon-btn, .quickstart-item .icon-btn { padding: 0.35rem 0.6rem; font-size: 0.72rem; }
    .ask-panel { margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 0.9rem; }
    .ask-panel summary { color: var(--ink); cursor: pointer; font-size: 0.8125rem; font-weight: 600; }
    .ask-panel summary:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--accent); }
    .ask-form { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
    .ask-form input { padding: 0.65rem 0.75rem; font-size: 0.8125rem; }
    .ask-form button { white-space: nowrap; }
    .ask-answer { color: var(--ink); font-size: 0.8125rem; line-height: 1.55; margin-top: 0.75rem; white-space: pre-wrap; }
    .ask-answer.error { color: var(--danger); }
    .ask-answer[hidden] { display: none; }
    .ask-answer.markdown-preview { white-space: normal; font-size: 0.8125rem; }
    .files-heading-copy { display: flex; align-items: baseline; gap: 0.65rem; min-width: 0; }
    .file-count { color: var(--ink-muted); font: 0.72rem var(--font-mono); white-space: nowrap; }
    #fileSearch { flex: 1; max-width: 340px; padding: 0.65rem 0.75rem; }
    #filesHeading { margin-bottom: 1rem; }
    .stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .stat { background: var(--surface); border: 1px solid var(--border); padding: 1.25rem 1rem; border-radius: var(--r-md); text-align: center; }
    .stat.primary { background: var(--surface-raised); }
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
    .modal { --reader-inset: 2rem; display: none; position: fixed; inset: 0; background: var(--scrim); z-index: var(--z-modal); padding: var(--reader-inset); overflow-y: auto; scroll-padding-top: calc(var(--reader-toolbar-height, 0px) + 0.75rem); }
    .modal.show { display: block; }
    #modalContent.load-error { color: var(--danger); }
    .modal-content { max-width: 900px; margin: 0 auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); padding: 1.5rem; }
    .preview-toolbar { display: flow-root; position: sticky; top: calc(-1 * var(--reader-inset)); z-index: var(--z-reader-controls); background: var(--surface); margin: -1.5rem -1.5rem 0; padding: 1.5rem 1.5rem 0; border-bottom: 1px solid var(--border); border-radius: var(--r-md) var(--r-md) 0 0; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; gap: 1rem; }
    .modal-header h2 { font-family: var(--font-mono); font-size: 1rem; font-weight: 600; word-break: break-all; }
    .modal-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
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
    [hidden] { display: none !important; }
    .preview-controls { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
    .preview-controls [aria-pressed="true"] { border-color: var(--accent); }
    .preview-outline { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; margin-bottom: 1rem; }
    .preview-outline label { color: var(--ink-muted); font-size: 0.8125rem; font-weight: 600; }
    .preview-outline select { flex: 1 1 180px; min-width: 0; max-width: 100%; padding: 0.65rem 0.75rem; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--canvas); color: var(--ink); font: 0.875rem var(--font-sans); }
    .preview-outline select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    #retryPreviewBtn { margin-top: 1rem; }
    .markdown-preview { line-height: 1.65; overflow-wrap: anywhere; }
    .markdown-preview > * + * { margin-top: 1rem; }
    .markdown-preview h1 { font-size: 1.75rem; }
    .markdown-preview h2 { font-size: 1.4rem; }
    .markdown-preview h3 { font-size: 1.15rem; }
    .markdown-preview p { max-width: 72ch; }
    .markdown-preview ul, .markdown-preview ol { padding-left: 1.5rem; }
    .markdown-preview :not(pre) > code { white-space: pre-wrap; }
    .markdown-preview code { font-family: var(--font-mono); font-size: 0.875em; }
    .markdown-preview a[href] { color: var(--accent); text-decoration: underline; }
    .markdown-preview .table-scroll { max-width: 100%; overflow-x: auto; }
    .markdown-preview table { width: 100%; overflow-wrap: normal; border-collapse: collapse; }
    .markdown-preview th, .markdown-preview td { border: 1px solid var(--border); padding: 0.5rem; }
    .markdown-preview blockquote { padding: 1rem; background: var(--canvas); }
    .markdown-preview summary { cursor: pointer; }
    .markdown-preview :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .clipboard-fallback { position: fixed; opacity: 0; pointer-events: none; }
    .empty-filter { color: var(--ink-muted); font-size: 0.8125rem; padding: 0.75rem 0; }
    .empty-filter[hidden] { display: none; }
    @media (max-width: 640px) {
      body { padding: 1.25rem; }
      .input-group { flex-direction: column; }
      #analyzeBtn { width: 100%; }
      .modal { --reader-inset: 0.75rem; }
      .modal-content { padding: 1rem; }
      .preview-toolbar { margin: -1rem -1rem 0; padding: 1rem 1rem 0; }
      .modal-header { align-items: flex-start; flex-direction: column; }
      .modal-actions { width: 100%; }
      .icon-btn { flex: 1; }
      .close { margin-left: auto; }
      .empty-details { grid-template-columns: 1fr; gap: 0.25rem; }
      .empty-details dd { margin-bottom: 0.5rem; }
      .options-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .phase-rail { grid-template-columns: repeat(3, minmax(0, 1fr)); row-gap: 0.65rem; }
      .phase-step { font-size: 0.68rem; }
      .score-explain-grid { grid-template-columns: 1fr; }
      .command-header, .quickstart-header { align-items: flex-start; flex-direction: column; gap: 0.2rem; }
      .quickstart-copy { align-items: flex-start; flex-direction: column; gap: 0.1rem; }
      .result-summary { grid-template-columns: 1fr; }
      .result-toolbar { align-items: stretch; flex-direction: column; }
      #fileSearch { max-width: none; }
      .ask-form { flex-direction: column; }
      .files-heading-copy { align-items: flex-start; flex-direction: column; gap: 0.2rem; }
    }
    @media (min-width: 641px) and (max-width: 820px) {
      .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-height: 480px) {
      .modal { --reader-inset: 0.5rem; }
      .preview-toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; padding-top: 0.5rem; }
      .modal-header { width: 100%; margin-bottom: 0; gap: 0.5rem; }
      .preview-controls { margin-bottom: 0.5rem; }
      .preview-outline { flex: 1 1 180px; margin-bottom: 0.5rem; }
      .preview-outline label { display: none; }
      .preview-outline select { padding: 0.45rem 0.75rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
    }
  `;
