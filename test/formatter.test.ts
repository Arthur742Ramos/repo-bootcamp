/**
 * Tests for the output format converter
 */

import { describe, it, expect } from "vitest";
import {
  markdownToHtml,
  convertToHtml,
  convertToPdf,
  formatFileName,
  formatContent,
  wrapHtmlPage,
  getFileExtension,
} from "../src/formatter.js";

describe("markdownToHtml", () => {
  it("converts headings", () => {
    expect(markdownToHtml("# Title")).toContain("<h1>Title</h1>");
    expect(markdownToHtml("## Sub")).toContain("<h2>Sub</h2>");
    expect(markdownToHtml("### H3")).toContain("<h3>H3</h3>");
  });

  it("converts unordered lists", () => {
    const md = "- one\n- two\n- three";
    const html = markdownToHtml(md);
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>three</li>");
    expect(html).toContain("</ul>");
  });

  it("converts ordered lists", () => {
    const md = "1. first\n2. second";
    const html = markdownToHtml(md);
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("</ol>");
  });

  it("converts code blocks with language", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const html = markdownToHtml(md);
    expect(html).toContain('<code class="language-typescript">');
    expect(html).toContain("const x = 1;");
    expect(html).toContain("</pre>");
  });

  it("converts code blocks without language", () => {
    const md = "```\nplain code\n```";
    const html = markdownToHtml(md);
    expect(html).toContain("<code>");
    expect(html).toContain("plain code");
  });

  it("escapes HTML in code blocks", () => {
    const md = '```\n<div class="test">\n```';
    const html = markdownToHtml(md);
    expect(html).toContain("&lt;div");
    expect(html).not.toContain('<div class="test">');
  });

  it("converts inline bold", () => {
    expect(markdownToHtml("**bold**")).toContain("<strong>bold</strong>");
  });

  it("converts inline italic", () => {
    expect(markdownToHtml("*italic*")).toContain("<em>italic</em>");
  });

  it("converts inline code", () => {
    expect(markdownToHtml("`code`")).toContain("<code>code</code>");
  });

  it("converts links", () => {
    const html = markdownToHtml("[text](https://example.com)");
    expect(html).toContain('<a href="https://example.com">text</a>');
  });

  it("converts images", () => {
    const html = markdownToHtml("![alt](https://img.shields.io/badge)");
    expect(html).toContain('<img src="https://img.shields.io/badge" alt="alt" />');
  });

  it("converts blockquotes", () => {
    const html = markdownToHtml("> quoted text");
    expect(html).toContain("<blockquote>quoted text</blockquote>");
  });

  it("converts horizontal rules", () => {
    expect(markdownToHtml("---")).toContain("<hr />");
    expect(markdownToHtml("-----")).toContain("<hr />");
  });

  it("converts tables", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |";
    const html = markdownToHtml(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("</table>");
  });

  it("passes through HTML tags", () => {
    const md = "<details>\n<summary>Click</summary>\n\nContent\n\n</details>";
    const html = markdownToHtml(md);
    expect(html).toContain("<details>");
    expect(html).toContain("<summary>Click</summary>");
    expect(html).toContain("</details>");
  });

  it("handles checkboxes in list items", () => {
    const md = "- [ ] todo\n- [x] done";
    const html = markdownToHtml(md);
    expect(html).toContain("☐ todo");
    expect(html).toContain("☑ done");
  });

  it("handles empty input", () => {
    expect(markdownToHtml("")).toBe("");
  });

  it("handles complex document structure", () => {
    const md = `# Heading

> A quote

- item 1
- item 2

| Col A | Col B |
|-------|-------|
| val 1 | val 2 |

---

Paragraph text with **bold** and *italic*.`;

    const html = markdownToHtml(md);
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<table>");
    expect(html).toContain("<hr />");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("escapes script tags in code blocks", () => {
    const md = '```\n<script>alert("xss")</script>\n```';
    const html = markdownToHtml(md);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("handles nested formatting correctly", () => {
    const html = markdownToHtml("**bold with `code` inside**");
    expect(html).toContain("<strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("handles consecutive headings", () => {
    const md = "# H1\n## H2\n### H3";
    const html = markdownToHtml(md);
    expect(html).toContain("<h1>H1</h1>");
    expect(html).toContain("<h2>H2</h2>");
    expect(html).toContain("<h3>H3</h3>");
  });

  it("handles whitespace-only input", () => {
    const html = markdownToHtml("   \n  \n   ");
    expect(typeof html).toBe("string");
  });

  it("handles links with special chars in URL", () => {
    const html = markdownToHtml("[link](https://example.com/path?q=1&b=2)");
    expect(html).toContain('href="https://example.com/path?q=1&b=2"');
  });

  it("handles markdown with only a heading and no body", () => {
    const html = markdownToHtml("# Title");
    expect(html).toContain("<h1>Title</h1>");
  });

  it("handles table with empty cells", () => {
    const md = "| A | B |\n|---|---|\n| val | data |";
    const html = markdownToHtml(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<td>val</td>");
    expect(html).toContain("<td>data</td>");
  });
});

describe("convertToHtml", () => {
  it("produces a full HTML page", () => {
    const html = convertToHtml("# Test", "Test Doc");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Test Doc</title>");
    expect(html).toContain("<h1>Test</h1>");
    expect(html).toContain("</html>");
  });

  it("includes CSS styles", () => {
    const html = convertToHtml("# Test", "Title");
    expect(html).toContain("<style>");
    expect(html).toContain("font-family");
  });

  it("escapes title", () => {
    const html = convertToHtml("# Test", 'Title & "Quotes"');
    expect(html).toContain("Title &amp; &quot;Quotes&quot;");
  });
});

describe("convertToPdf", () => {
  it("produces PDF-ready HTML", () => {
    const html = convertToPdf("# Test", "Test Doc");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("@page");
    expect(html).toContain("page-break");
    expect(html).toContain("<h1>Test</h1>");
  });

  it("includes A4 page size", () => {
    const html = convertToPdf("# Test", "Title");
    expect(html).toContain("size: A4");
  });
});

describe("getFileExtension", () => {
  it("returns empty for markdown", () => {
    expect(getFileExtension("markdown")).toBe("");
  });

  it("returns .html for html", () => {
    expect(getFileExtension("html")).toBe(".html");
  });

  it("returns .pdf.html for pdf", () => {
    expect(getFileExtension("pdf")).toBe(".pdf.html");
  });
});

describe("formatFileName", () => {
  it("keeps names unchanged for markdown", () => {
    expect(formatFileName("BOOTCAMP.md", "markdown")).toBe("BOOTCAMP.md");
  });

  it("replaces .md with .html for html format", () => {
    expect(formatFileName("BOOTCAMP.md", "html")).toBe("BOOTCAMP.html");
  });

  it("replaces .md with .pdf.html for pdf format", () => {
    expect(formatFileName("BOOTCAMP.md", "pdf")).toBe("BOOTCAMP.pdf.html");
  });

  it("replaces .mmd extension for html format", () => {
    expect(formatFileName("diagrams.mmd", "html")).toBe("diagrams.html");
  });

  it("does not change .json files", () => {
    expect(formatFileName("repo_facts.json", "html")).toBe("repo_facts.json");
  });

  it("does not change files without .md or .mmd extension", () => {
    expect(formatFileName("somefile.txt", "html")).toBe("somefile.txt");
  });
});

describe("formatContent", () => {
  it("returns markdown unchanged for markdown format", () => {
    const md = "# Test";
    expect(formatContent(md, "BOOTCAMP.md", "markdown")).toBe(md);
  });

  it("converts .md files to html", () => {
    const md = "# Hello";
    const result = formatContent(md, "BOOTCAMP.md", "html");
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("<h1>Hello</h1>");
  });

  it("converts .md files to pdf html", () => {
    const md = "# Hello";
    const result = formatContent(md, "BOOTCAMP.md", "pdf");
    expect(result).toContain("@page");
  });

  it("does not convert .json files", () => {
    const json = '{"key": "value"}';
    expect(formatContent(json, "repo_facts.json", "html")).toBe(json);
  });

  it("converts .mmd files", () => {
    const mmd = "graph LR\n  A --> B";
    const result = formatContent(mmd, "diagrams.mmd", "html");
    expect(result).toContain("<!DOCTYPE html>");
  });
});

describe("wrapHtmlPage", () => {
  it("wraps body content in a full page", () => {
    const result = wrapHtmlPage("<h1>Hi</h1>", "My Title");
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("<title>My Title</title>");
    expect(result).toContain("<h1>Hi</h1>");
    expect(result).toContain("</body>");
  });
});
