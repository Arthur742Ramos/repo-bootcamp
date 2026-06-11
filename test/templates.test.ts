import { describe, expect, it } from "vitest";

import { getIndexHtml } from "../src/web/templates.js";

describe("getIndexHtml", () => {
  it("returns a string", () => {
    expect(typeof getIndexHtml()).toBe("string");
  });

  it("returns valid HTML5 document", () => {
    const html = getIndexHtml();
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("<html lang=\"en\">");
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
    expect(html).toContain("Generate onboarding documentation for any GitHub repository");
  });

  describe("UI elements", () => {
    it("has a repo URL input field", () => {
      const html = getIndexHtml();
      expect(html).toContain('id="repoUrl"');
      expect(html).toContain('placeholder="https://github.com/owner/repo"');
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

    it("has a results container", () => {
      const html = getIndexHtml();
      expect(html).toContain('id="results"');
      expect(html).toContain('id="stats"');
      expect(html).toContain('id="files"');
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

    it("styles body with dark background", () => {
      const html = getIndexHtml();
      expect(html).toContain("background: linear-gradient");
      expect(html).toContain("#1a1a2e");
    });

    it("has responsive container styles", () => {
      const html = getIndexHtml();
      expect(html).toContain("max-width: 900px");
      expect(html).toContain("margin: 0 auto");
    });

    it("defines modal overlay styles", () => {
      const html = getIndexHtml();
      expect(html).toContain("position: fixed");
      expect(html).toContain("z-index: 1000");
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
        "BOOTCAMP", "ONBOARDING", "ARCHITECTURE", "CODEMAP",
        "FIRST_TASKS", "RUNBOOK", "DEPENDENCIES", "SECURITY",
        "RADAR", "diagrams", "repo_facts.json",
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
});
