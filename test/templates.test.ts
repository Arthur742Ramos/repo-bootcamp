import { describe, expect, it } from "vitest";

import { getIndexHtml } from "../src/web/templates.js";

describe("getIndexHtml", () => {
  it("returns a string", () => {
    expect(typeof getIndexHtml()).toBe("string");
  });

  it("returns valid HTML5 document", () => {
    const html = getIndexHtml();
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("</html>");
  });

  it("includes charset and viewport meta tags", () => {
    const html = getIndexHtml();
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain("viewport");
    expect(html).toContain("width=device-width");
  });

  it("has the correct page title", () => {
    const html = getIndexHtml();
    expect(html).toContain("<title>Repo Bootcamp</title>");
  });

  it("contains the main heading", () => {
    const html = getIndexHtml();
    expect(html).toContain("<h1>Repo Bootcamp</h1>");
  });

  it("contains the subtitle description", () => {
    const html = getIndexHtml();
    expect(html).toContain(
      "Turn a public GitHub, GitLab, or Bitbucket repository into a Day-1 onboarding kit."
    );
  });

  describe("UI elements", () => {
    it("has a repo URL input field", () => {
      const html = getIndexHtml();
      expect(html).toContain('id="repoUrl"');
      expect(html).toContain('placeholder="https://github.com/owner/repo"');
      expect(html).toContain('<label class="field-label" for="repoUrl">Repository URL</label>');
      expect(html).toContain('id="repoUrlHint"');
    });

    it("has an analyze button", () => {
      const html = getIndexHtml();
      expect(html).toContain('id="analyzeForm"');
      expect(html).toContain('id="analyzeBtn"');
      expect(html).toContain('type="submit"');
      expect(html).toContain("document.getElementById('analyzeForm').addEventListener('submit'");
    });

    it("has a progress container", () => {
      const html = getIndexHtml();
      expect(html).toContain('id="progress"');
    });

    it("has a useful initial state that explains the run", () => {
      const html = getIndexHtml();
      expect(html).toContain('id="emptyState"');
      expect(html).toContain("From repository to first task");
      expect(html).toContain("the web demo always uses a shallow clone");
      expect(html).toContain("Under 60 seconds");
      expect(html).toContain("getElementById('emptyState').hidden = true");
    });

    it("has a results container", () => {
      const html = getIndexHtml();
      expect(html).toContain('id="results"');
      expect(html).toContain('aria-labelledby="resultsHeading"');
      expect(html).toContain('id="resultsHeading"');
      expect(html).toContain('id="stats"');
      expect(html).toContain('id="files"');
    });

    it("explains how to interpret the headline scores", () => {
      const html = getIndexHtml();
      expect(html).toContain('id="scoreGuide"');
      expect(html).toContain('aria-describedby="scoreGuide"');
      expect(html).toContain("Higher security scores are better");
      expect(html).toContain("lower onboarding risk scores are better");
      expect(html).toContain("A (strongest) to F (weakest)");
    });

    it("has a modal for viewing files", () => {
      const html = getIndexHtml();
      expect(html).toContain('id="modal"');
      expect(html).toContain('id="modalTitle"');
      expect(html).toContain('id="modalContent"');
    });

    it("has copy and download buttons in the modal", () => {
      const html = getIndexHtml();
      expect(html).toContain('id="copyBtn"');
      expect(html).toContain('id="downloadBtn"');
      expect(html).toContain('id="closeBtn"');
    });

    it("wires modal controls via addEventListener (no inline onclick, for CSP)", () => {
      const html = getIndexHtml();
      // The server sets a CSP that blocks inline event handlers, so the UI must
      // not rely on onclick attributes anywhere.
      expect(html).not.toContain("onclick=");
      expect(html).toContain("getElementById('copyBtn').addEventListener('click'");
      expect(html).toContain("getElementById('downloadBtn').addEventListener('click'");
      expect(html).toContain("getElementById('closeBtn').addEventListener('click'");
    });
  });

  describe("inline CSS", () => {
    it("includes style block", () => {
      const html = getIndexHtml();
      expect(html).toContain("<style>");
      expect(html).toContain("</style>");
    });

    it("styles body with the flat GitHub-dark canvas", () => {
      const html = getIndexHtml();
      expect(html).toContain("--canvas: #0d1117");
      expect(html).toContain("background: var(--canvas)");
    });

    it("has responsive container styles", () => {
      const html = getIndexHtml();
      expect(html).toContain("max-width: 900px");
      expect(html).toContain("margin: 0 auto");
    });

    it("does not rely on inline style attributes", () => {
      const html = getIndexHtml();
      expect(html).not.toMatch(/\sstyle="/);
      expect(html).not.toContain(".style.");
    });

    it("defines modal overlay styles", () => {
      const html = getIndexHtml();
      expect(html).toContain("position: fixed");
      expect(html).toContain("z-index: var(--z-modal)");
    });
  });

  describe("inline JavaScript", () => {
    it("includes script block", () => {
      const html = getIndexHtml();
      expect(html).toContain("<script>");
      expect(html).toContain("</script>");
    });

    it("defines the analyze function", () => {
      const html = getIndexHtml();
      expect(html).toContain("async function analyze()");
    });

    it("defines the streamProgress function", () => {
      const html = getIndexHtml();
      expect(html).toContain("function streamProgress(jobId)");
    });

    it("defines the showResults function", () => {
      const html = getIndexHtml();
      expect(html).toContain("function showResults(data)");
    });

    it("defines the viewFile function", () => {
      const html = getIndexHtml();
      expect(html).toContain("async function viewFile(filename)");
    });

    it("defines the closeModal function", () => {
      const html = getIndexHtml();
      expect(html).toContain("function closeModal()");
    });

    it("defines the copyFile and downloadFile functions", () => {
      const html = getIndexHtml();
      expect(html).toContain("async function copyFile()");
      expect(html).toContain("function downloadFile()");
    });

    it("uses the clipboard API with a fallback for copy", () => {
      const html = getIndexHtml();
      expect(html).toContain("navigator.clipboard");
      expect(html).toContain("function legacyCopy(");
      expect(html).toContain("document.execCommand('copy')");
      expect(html).toContain("ta.className = 'clipboard-fallback'");
    });

    it("races the async clipboard write against a timeout", () => {
      const html = getIndexHtml();
      expect(html).toContain("Promise.race");
      expect(html).toContain("clipboard timeout");
    });

    it("creates a Blob download with the file name", () => {
      const html = getIndexHtml();
      expect(html).toContain("new Blob(");
      expect(html).toContain("a.download = currentFile.name");
      expect(html).toContain("URL.revokeObjectURL");
    });

    it("handles Escape key to close modal", () => {
      const html = getIndexHtml();
      expect(html).toContain("Escape");
      expect(html).toContain("closeModal");
    });

    it("posts to /api/analyze endpoint", () => {
      const html = getIndexHtml();
      expect(html).toContain("'/api/analyze'");
    });

    it("uses EventSource for SSE streaming", () => {
      const html = getIndexHtml();
      expect(html).toContain("EventSource");
      expect(html).toContain("/api/jobs/");
    });
  });

  describe("file description mappings", () => {
    it("maps BOOTCAMP to description", () => {
      const html = getIndexHtml();
      expect(html).toContain("'BOOTCAMP': 'One-page overview'");
    });

    it("maps ONBOARDING to description", () => {
      const html = getIndexHtml();
      expect(html).toContain("'ONBOARDING': 'Setup guide'");
    });

    it("maps ARCHITECTURE to description", () => {
      const html = getIndexHtml();
      expect(html).toContain("'ARCHITECTURE': 'System design'");
    });

    it("maps SECURITY to description", () => {
      const html = getIndexHtml();
      expect(html).toContain("'SECURITY': 'Security analysis'");
    });

    it("maps all expected file types", () => {
      const html = getIndexHtml();
      const expectedKeys = [
        "BOOTCAMP",
        "ONBOARDING",
        "ARCHITECTURE",
        "CODEMAP",
        "FIRST_TASKS",
        "RUNBOOK",
        "DEPENDENCIES",
        "SECURITY",
        "RADAR",
        "IMPACT",
        "METRICS",
        "HEALTH",
        "DIFF",
        "ISSUES_PREVIEW",
        "diagrams",
        "repo_facts.json",
      ];
      for (const key of expectedKeys) {
        expect(html).toContain(`'${key}'`);
      }
    });
  });

  describe("deterministic output", () => {
    it("returns identical HTML on consecutive calls", () => {
      const first = getIndexHtml();
      const second = getIndexHtml();
      expect(first).toBe(second);
    });
  });

  describe("file preview modal (E4b)", () => {
    it("opens the modal immediately with a loading placeholder", () => {
      const html = getIndexHtml();
      expect(html).toContain("modalContent.textContent = 'Loading");
      // The modal is shown from openModal(), invoked before the fetch resolves.
      expect(html).toContain("openModal();");
      expect(html).toContain("function openModal()");
    });

    it("checks response.ok and renders a distinct error state, not the error body", () => {
      const html = getIndexHtml();
      expect(html).toContain("if (!res.ok)");
      expect(html).toContain("Couldn't load ");
      expect(html).toContain("classList.add('load-error')");
      expect(html).toContain("#modalContent.load-error");
    });

    it("keeps currentFile null until a successful load so copy/download can't act on errors", () => {
      const html = getIndexHtml();
      expect(html).toContain("currentFile = null");
    });
  });

  describe("SSE resilience (E4b)", () => {
    it("distinguishes a settled stream from an interruption", () => {
      const html = getIndexHtml();
      expect(html).toContain("let settled = false");
      expect(html).toContain("if (settled) return");
    });

    it("shows a visible retry notice and falls back to polling on interruption", () => {
      const html = getIndexHtml();
      expect(html).toContain("Connection lost");
      expect(html).toContain("function pollJobStatus(jobId)");
      expect(html).toContain("job.status === 'complete'");
      expect(html).toContain("job.status === 'error'");
    });
  });

  describe("modal background isolation and focus trap (E4b)", () => {
    it("makes the container inert with an aria-hidden fallback and locks body scroll", () => {
      const html = getIndexHtml();
      expect(html).toContain("container.inert = true");
      expect(html).toContain("setAttribute('aria-hidden', 'true')");
      expect(html).toContain("document.body.classList.add('modal-open')");
    });

    it("reverses the isolation when the modal closes", () => {
      const html = getIndexHtml();
      expect(html).toContain("container.inert = false");
      expect(html).toContain("removeAttribute('aria-hidden')");
      expect(html).toContain("document.body.classList.remove('modal-open')");
    });

    it("builds the focus trap from a runtime query, not a hard-coded list", () => {
      const html = getIndexHtml();
      expect(html).toContain("content.querySelectorAll(selector)");
      expect(html).toContain("Array.prototype.filter.call");
      // The old hard-coded [copyBtn, downloadBtn, closeBtn] array is gone.
      expect(html).not.toContain("document.getElementById('copyBtn'),");
    });
  });

  describe("URL field validation (E4b)", () => {
    it("adds URL-appropriate input affordances", () => {
      const html = getIndexHtml();
      expect(html).toContain('inputmode="url"');
      expect(html).toContain('autocapitalize="none"');
      expect(html).toContain('spellcheck="false"');
    });

    it("links an inline error region via aria-describedby instead of a blocking alert()", () => {
      const html = getIndexHtml();
      expect(html).toContain('aria-describedby="repoUrlHint repoUrlError"');
      expect(html).toContain('id="repoUrlError"');
      expect(html).toContain("function setUrlError(");
      expect(html).toContain("setUrlError('Please enter a repository URL')");
      expect(html).toContain("setAttribute('aria-invalid', 'true')");
      expect(html).not.toContain("alert(");
    });

    it("does not impose native type=url validation (backend accepts owner/repo and SSH forms)", () => {
      const html = getIndexHtml();
      expect(html).toContain('type="text"');
      expect(html).not.toContain('type="url"');
    });
  });

  describe("completion announcement and focus (E4b)", () => {
    it("no longer wraps the bulk-rendered results in an always-on live region", () => {
      const html = getIndexHtml();
      expect(html).toContain(
        '<section class="results" id="results" aria-labelledby="resultsHeading">'
      );
      expect(html).not.toContain('id="results" aria-live');
    });

    it("gives the progress log role=log and adds a concise status region", () => {
      const html = getIndexHtml();
      expect(html).toContain('role="log"');
      expect(html).toContain('id="statusMsg"');
      expect(html).toContain('role="status"');
    });

    it("moves focus to the results heading and announces completion", () => {
      const html = getIndexHtml();
      expect(html).toContain('id="resultsHeading"');
      expect(html).toContain('tabindex="-1"');
      expect(html).toContain("getElementById('resultsHeading')");
      expect(html).toContain("heading.focus()");
      expect(html).toContain("heading.scrollIntoView(");
      expect(html).toContain("Analysis complete");
    });
  });

  describe("headline stats (E4b)", () => {
    it("replaces internal Tool Calls telemetry with a user-relevant stat", () => {
      const html = getIndexHtml();
      expect(html).not.toContain("'Tool Calls'");
      expect(html).not.toContain("data.stats.toolCalls");
      expect(html).toContain("data.files.length, 'Files Generated'");
    });

    it("keeps the onboarding-relevant headline stats", () => {
      const html = getIndexHtml();
      expect(html).toContain("Security Score (");
      expect(html).toContain("Onboarding Risk (");
      expect(html).toContain("'Dependencies'");
    });

    describe("request and loading resilience", () => {
      it("handles non-JSON failures and common capacity statuses explicitly", () => {
        const html = getIndexHtml();
        expect(html).toContain("async function readJsonResponse(response)");
        expect(html).toContain("status === 429");
        expect(html).toContain("status === 503");
        expect(html).toContain("The server returned an invalid response.");
      });

      it("marks the form busy and shows progress immediately", () => {
        const html = getIndexHtml();
        expect(html).toContain("form.setAttribute('aria-busy', 'true')");
        expect(html).toContain("progress.hidden = false");
        expect(html).toContain("addProgressItem('Starting analysis...')");
        expect(html).toContain("removeAttribute('aria-busy')");
      });

      it("keeps file actions disabled until content loads", () => {
        const html = getIndexHtml();
        expect(html).toContain('id="copyBtn" disabled');
        expect(html).toContain('id="downloadBtn" disabled');
        expect(html).toContain("copyBtn.disabled = false");
        expect(html).toContain("downloadBtn.disabled = false");
      });

      it("falls back to a useful description for plugin documents", () => {
        const html = getIndexHtml();
        expect(html).toContain("|| 'Generated document'");
      });
    });
  });
});
