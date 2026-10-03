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
  applyOutputFormat,
} from "../src/formatter.js";

describe("markdownToHtml", () => {
  it("keeps command-line backticks inside a line-delimited code block", () => {
    const command = "npm run 'dev```literal```'\necho AFTER";
    const html = markdownToHtml("```bash\n" + command + "\n```\n[Next](./ONBOARDING.md)");
    expect(html).toContain(`<code class="language-bash">${command}</code>`);
    expect(html).toContain('<a href="./ONBOARDING.md">Next</a>');
    expect(html.match(/<pre /g)).toHaveLength(1);
    expect(html).toContain('tabindex="0" role="region" aria-label="Code block"');
  });

  it("matches fence type, minimum length and closing-line whitespace", () => {
    const content = "first\n```\n~~~~\n````literal\nlast  ";
    const html = markdownToHtml("````bash\n" + content + "\n````` \t\n# After");
    expect(html).toContain(`<code class="language-bash">${content}</code>`);
    expect(html).toContain('<h1 id="after">After</h1>');
    expect(markdownToHtml("~~~bash\necho `literal`\n~~~")).toContain(
      '<code class="language-bash">echo `literal`</code>'
    );
    expect(markdownToHtml("  ```bash\n  echo first\n echo second\n  ```")).toContain(
      '<code class="language-bash">echo first\necho second</code>'
    );
    expect(markdownToHtml("```bash\necho unfinished")).toContain(
      '<code class="language-bash">echo unfinished</code>'
    );
  });

  it("renders equal-length maximal spans and leaves mismatched runs literal", () => {
    expect(markdownToHtml("``npm run 'test`literal`'``")).toContain(
      "<code>npm run 'test`literal`'</code>"
    );
    expect(markdownToHtml("`` `literal` ``")).toContain("<code>`literal`</code>");
    expect(markdownToHtml("``  npm run test  ``")).toContain("<code> npm run test </code>");
    expect(markdownToHtml("`   `")).toContain("<code>   </code>");
    expect(markdownToHtml("```unmatched `` still literal `")).toBe(
      "<p>```unmatched `` still literal `</p>"
    );
  });

  it("protects variable spans in source links and escaped table cells", () => {
    expect(
      markdownToHtml("[``src/routes/[`id`]/page.ts``](./route.html) [next](./next.html)")
    ).toContain(
      '<a href="./route.html"><code>src/routes/[`id`]/page.ts</code></a> <a href="./next.html">next</a>'
    );
    const html = markdownToHtml(
      String.raw`| Command | Next |
|---|---|
| \`\`echo 'a\`b\\c\|d'\`\` | [next](./next.html) |`.replaceAll("\\`", "`")
    );
    expect(html).toContain("<code>echo 'a`b\\\\c|d'</code>");
    expect(html.match(/<td>/g)).toHaveLength(2);
    expect(html).toContain('<a href="./next.html">next</a>');
  });

  it("keeps literal block-placeholder-shaped text separate from real code", () => {
    const literal = "\x00CODEBLOCK_0\x00";
    const html = markdownToHtml(literal + "\n\n```bash\necho literal\n```");
    expect(html).toContain(`<p>${literal}</p>`);
    expect(html).toContain('<code class="language-bash">echo literal</code>');
    expect(html.match(/<pre /g)).toHaveLength(1);
  });

  it("keeps HTML-shaped payloads escaped inside variable spans and fenced blocks", () => {
    const html = markdownToHtml(
      "``<img src=x>`literal` &``\n\n````bash\n<script>literal</script>\n```\n````\n[bad](javascript:alert)"
    );
    expect(html).toContain("<code>&lt;img src=x&gt;`literal` &amp;</code>");
    expect(html).toContain("&lt;script&gt;literal&lt;/script&gt;\n```</code>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
  });

  it("converts headings", () => {
    expect(markdownToHtml("# Title")).toContain('<h1 id="title">Title</h1>');
    expect(markdownToHtml("## Sub")).toContain('<h2 id="sub">Sub</h2>');
    expect(markdownToHtml("### H3")).toContain('<h3 id="h3">H3</h3>');
  });

  it("assigns unique anchors to repeated, suffix-like, Unicode and empty headings", () => {
    const html = markdownToHtml(
      "# Setup\n\n## Setup\n\n## Setup-1\n\n## Setup\n\n## 環境設定\n\n## Café\n\n## Cafe\u0301\n\n## !!!"
    );
    const anchors = [...html.matchAll(/<h[1-6] id="([^"]*)"/g)].map((match) => match[1]);
    expect(anchors).toEqual([
      "setup",
      "setup-1",
      "setup-1-1",
      "setup-2",
      "環境設定",
      "café",
      "café-1",
      "section",
    ]);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("derives anchors from rendered formatted labels while escaping source HTML", () => {
    const html = markdownToHtml(
      '## **Run** `npm ci` [now](https://example.com)\n\n## `<img onerror=alert>` & "Setup"'
    );
    expect(html).toContain('id="run-npm-ci-now"');
    expect(html).toContain('id="img-onerroralert-setup"');
    expect(html).not.toContain("<img");
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

  it("converts mermaid code blocks to mermaid containers", () => {
    const md = "```mermaid\ngraph LR\nA-->B\n```";
    const html = markdownToHtml(md);
    expect(html).toContain('<div class="mermaid">');
    expect(html).not.toContain('class="language-mermaid"');
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

  it("renders linked inline-code route filenames containing brackets", () => {
    const url = "https://github.com/owner/project/blob/main/src/routes/%5Bid%5D/page.ts";
    const html = markdownToHtml(`- [\`src/routes/[id]/page.ts\`](${url})`);
    expect(html).toContain(`<a href="${url}"><code>src/routes/[id]/page.ts</code></a>`);
    expect(html).not.toContain(`](${url})`);
  });

  it("supports balanced label brackets and preserves unmatched backticks as text", () => {
    expect(markdownToHtml("[Route [id]](./route.html)")).toContain(
      '<a href="./route.html">Route [id]</a>'
    );
    expect(markdownToHtml("[literal ` tick](./route.html)")).toContain(
      '<a href="./route.html">literal ` tick</a>'
    );
  });

  it("does not treat backticks inside consumed URLs as later code delimiters", () => {
    const html = markdownToHtml("[first](./`file) [second](./two) `after`");
    expect(html).toContain('<a href="./`file">first</a> <a href="./two">second</a>');
    expect(html).toContain("<code>after</code>");
    expect(markdownToHtml("[`first`](./`file) [`second`](./two)")).toContain(
      '<a href="./two"><code>second</code></a>'
    );
    expect(markdownToHtml("![first](https://example.com/`file) [second](./two) `after`")).toContain(
      '<a href="./two">second</a> <code>after</code>'
    );
    expect(markdownToHtml("[unmatched [first](./`file) [second](./two) `after`")).toContain(
      '<a href="./two">second</a> <code>after</code>'
    );
  });

  it("handles long malformed labels without repeated suffix scans", () => {
    const source = "[[x] ".repeat(32000);
    const start = performance.now();
    const html = markdownToHtml(source);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(html).toBe(`<p>${source}</p>`);
  });

  it("renders label formatting without nested anchors or unsafe URLs", () => {
    const html = markdownToHtml(
      "[**source** `a]b.ts`](javascript:alert) [outer [inner](https://example.com)](./outer.html)"
    );
    expect(html).toContain("<strong>source</strong> <code>a]b.ts</code>");
    expect(html).not.toContain('href="javascript:');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="./outer.html"');
  });

  it("preserves image syntax for balanced or empty alt labels", () => {
    const html = markdownToHtml(
      "![Route [id]](https://example.com/route.png) ![](https://example.com/empty.png)"
    );
    expect(html).toContain('<img src="https://example.com/route.png" alt="Route [id]" />');
    expect(html).toContain('<img src="https://example.com/empty.png" alt="" />');
    expect(html).not.toContain("<a ");
  });

  it("escapes raw HTML inside linked code labels", () => {
    const html = markdownToHtml("[`<img src=x onerror=alert(1)>`](https://example.com)");
    expect(html).toContain("<code>&lt;img src=x onerror=alert(1)&gt;</code>");
    expect(html).not.toContain("<img");
  });

  it("preserves literal placeholder-shaped text", () => {
    const html = markdownToHtml("@@INLINE_999@@\n\n@@INLINE_0@@ [link](https://example.com)");
    expect(html).toContain("<p>@@INLINE_999@@</p>");
    expect(html).toContain('<p>@@INLINE_0@@ <a href="https://example.com">link</a></p>');
    expect(html.match(/<a href="https:\/\/example\.com">link<\/a>/g)).toHaveLength(1);
  });

  it("preserves literal placeholder-shaped text in protected inline constructs", () => {
    const html = markdownToHtml(
      "`@@INLINE_0@@` [@@INLINE_1@@](https://example.com) ![@@INLINE_2@@](https://example.com/image)"
    );
    expect(html).toContain("<code>@@INLINE_0@@</code>");
    expect(html).toContain('<a href="https://example.com">@@INLINE_1@@</a>');
    expect(html).toContain('<img src="https://example.com/image" alt="@@INLINE_2@@" />');
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

  it("keeps escaped pipes in table text and inline code and accepts omitted trailing bars", () => {
    const html = markdownToHtml(
      String.raw`| Range | File |
|---|---|
| ^1.0.0 \|\| ^2.0.0 | \`a\|b.ts\` |
| plain\\folder | \`raw\\folder\``.replaceAll("\\`", "`")
    );
    expect(html).toContain("<tr><td>^1.0.0 || ^2.0.0</td><td><code>a|b.ts</code></td></tr>");
    expect(html).toContain(
      String.raw`<tr><td>plain\folder</td><td><code>raw\\folder</code></td></tr>`
    );
  });

  it("distinguishes escaped backslashes from escaped column separators", () => {
    const html = markdownToHtml(String.raw`| A | B |
|---|---|
| a\\ | b\\\|c |`);
    expect(html).toContain(String.raw`<tr><td>a\</td><td>b\|c</td></tr>`);
  });

  it.each([0, 1, 2, 3, 4, 5])(
    "keeps %s literal code backslashes before an escaped table pipe",
    (count) => {
      const payload = "\\".repeat(count) + "| [owned](https://example.invalid/link)";
      const escaped = payload.replaceAll("|", "\\|");
      const html = markdownToHtml(`| A | B |\n|---|---|\n| \` ${escaped} \` | tail |`);
      expect(html).toContain(`<tr><td><code>${payload}</code></td><td>tail</td></tr>`);
      expect(html).not.toContain("<a href=");
    }
  );

  it("ignores trailing whitespace and CRLF without dropping intentional empty cells", () => {
    const html = markdownToHtml("| A | B |   \r\n|---|---|  \r\n| x | y |  \r\n| z | | \r\n");
    expect(html).toContain("<tr><th>A</th><th>B</th></tr>");
    expect(html).toContain("<tr><td>x</td><td>y</td></tr>");
    expect(html).toContain("<tr><td>z</td><td></td></tr>");
    expect(html).not.toContain("---");
    expect(html.match(/<th>/g)).toHaveLength(2);
    expect(html.match(/<td>/g)).toHaveLength(4);
  });

  it("passes through HTML tags", () => {
    const md = "<details>\n<summary>Click</summary>\n\nContent\n\n</details>";
    const html = markdownToHtml(md);
    expect(html).toContain("<details>");
    expect(html).toContain("<summary>Click</summary>");
    expect(html).toContain("</details>");
  });

  it("escapes raw HTML and drops unsafe inline URLs", () => {
    const html = markdownToHtml(
      '<script>alert("xss")</script>\n\n[Unsafe](javascript:alert)\n\n![Tracker](javascript:alert)'
    );
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<p>Unsafe</p>");
    expect(html).toContain("<p>Tracker</p>");
    expect(html).not.toContain("javascript:");
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
    expect(html).toContain('<h1 id="heading">Heading</h1>');
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
    expect(html).toContain('<h1 id="h1">H1</h1>');
    expect(html).toContain('<h2 id="h2">H2</h2>');
    expect(html).toContain('<h3 id="h3">H3</h3>');
  });

  it("handles whitespace-only input", () => {
    const html = markdownToHtml("   \n  \n   ");
    expect(typeof html).toBe("string");
  });

  it("handles links with special chars in URL", () => {
    const html = markdownToHtml("[link](https://example.com/path?q=1&b=2)");
    expect(html).toContain('href="https://example.com/path?q=1&amp;b=2"');
  });

  it("handles markdown with only a heading and no body", () => {
    const html = markdownToHtml("# Title");
    expect(html).toContain('<h1 id="title">Title</h1>');
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
    expect(html).toContain('<h1 id="test">Test</h1>');
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

  it("injects mermaid runtime when mermaid blocks exist", () => {
    const html = convertToHtml("```mermaid\ngraph LR\nA-->B\n```", "Mermaid Doc");
    expect(html).toContain("mermaid.esm.min.mjs");
  });
});

describe("convertToPdf", () => {
  it("produces PDF-ready HTML", () => {
    const html = convertToPdf("# Test", "Test Doc");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("@page");
    expect(html).toContain("page-break");
    expect(html).toContain('<h1 id="test">Test</h1>');
  });

  it("includes A4 page size", () => {
    const html = convertToPdf("# Test", "Title");
    expect(html).toContain("size: A4");
  });

  it("injects mermaid runtime when mermaid blocks exist", () => {
    const html = convertToPdf("```mermaid\ngraph LR\nA-->B\n```", "Mermaid PDF");
    expect(html).toContain("mermaid.esm.min.mjs");
  });
});

describe("formatter snapshots", () => {
  const snapshotMarkdown = `# Snapshot Title

> Snapshot quote

- [ ] todo item
- [x] done item

| Name | Value |
|------|-------|
| alpha | beta |

\`\`\`typescript
const answer = 42;
\`\`\`

\`\`\`mermaid
graph LR
A-->B
\`\`\``;

  it("matches markdownToHtml output", () => {
    expect(markdownToHtml(snapshotMarkdown)).toMatchSnapshot();
  });

  it("matches convertToHtml output", () => {
    expect(convertToHtml(snapshotMarkdown, "Snapshot Doc")).toMatchSnapshot();
  });

  it("matches convertToPdf output", () => {
    expect(convertToPdf(snapshotMarkdown, "Snapshot Doc")).toMatchSnapshot();
  });
});

describe("getFileExtension", () => {
  it("returns empty for markdown", () => {
    expect(getFileExtension("markdown")).toBe("");
  });

  it("returns .html for html", () => {
    expect(getFileExtension("html")).toBe(".html");
  });

  it("returns .html for pdf", () => {
    expect(getFileExtension("pdf")).toBe(".html");
  });
});

describe("formatFileName", () => {
  it("keeps names unchanged for markdown", () => {
    expect(formatFileName("BOOTCAMP.md", "markdown")).toBe("BOOTCAMP.md");
  });

  it("replaces .md with .html for html format", () => {
    expect(formatFileName("BOOTCAMP.md", "html")).toBe("BOOTCAMP.html");
  });

  it("replaces .md with .html for pdf format", () => {
    expect(formatFileName("BOOTCAMP.md", "pdf")).toBe("BOOTCAMP.html");
  });

  it("does not change .mmd files", () => {
    expect(formatFileName("diagrams.mmd", "html")).toBe("diagrams.mmd");
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
    expect(result).toContain('<h1 id="hello">Hello</h1>');
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

  it("does not convert .mmd files", () => {
    const mmd = "graph LR\n  A --> B";
    const result = formatContent(mmd, "diagrams.mmd", "html");
    expect(result).toBe(mmd);
  });
});

describe("wrapHtmlPage", () => {
  it("wraps body content in a full page", () => {
    const result = wrapHtmlPage('<h1 id="hi">Hi</h1>', "My Title");
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("<title>My Title</title>");
    expect(result).toContain('<h1 id="hi">Hi</h1>');
    expect(result).toContain("</body>");
  });
});

describe("applyOutputFormat document navigation", () => {
  it.each(["html", "pdf"] as const)("links the converted kit in %s output", (format) => {
    const docs = applyOutputFormat(
      [
        {
          name: "BOOTCAMP.md",
          content: "# Bootcamp\n\nRead [setup](./ONBOARDING.md) and [source](./src/README.md).",
        },
        { name: "ONBOARDING.md", content: "# Onboarding\n\nReturn [home](./BOOTCAMP.md)." },
      ],
      format
    );
    expect(docs.map((doc) => doc.name)).toEqual(["BOOTCAMP.html", "ONBOARDING.html"]);
    expect(docs[0].content).toContain('<a href="./ONBOARDING.html">setup</a>');
    expect(docs[1].content).toContain('<a href="./BOOTCAMP.html">home</a>');
    expect(docs[0].content).toContain('<a href="./src/README.md">source</a>');
  });

  it("resolves nested and encoded kit paths and preserves URL suffixes", () => {
    const docs = applyOutputFormat(
      [
        {
          name: "guides/START.md",
          content:
            "[setup](../ONBOARDING.md?mode=quick&theme=dark#setup) [nested](./Space%20%26%20Notes.md)",
        },
        { name: "ONBOARDING.md", content: "# Setup" },
        { name: "guides/Space & Notes.md", content: "# Notes" },
      ],
      "html"
    );
    expect(docs[0].content).toContain('href="../ONBOARDING.html?mode=quick&amp;theme=dark#setup"');
    expect(docs[0].content).toContain('href="./Space%20%26%20Notes.html"');
  });

  it("matches equivalent encoded path segments without treating encoded slashes as directories", () => {
    const docs = applyOutputFormat(
      [
        {
          name: "BOOTCAMP.md",
          content:
            "[extension](./ONBOARDING%2emd) [letter](./%4FNBOARDING.md) [notes](./guides/Space%20&%20Notes.md) [slash](./guides%2FSpace%20&%20Notes.md) [bad](./ONBOARDING%broken.md)",
        },
        { name: "ONBOARDING.md", content: "# Setup" },
        { name: "guides/Space & Notes.md", content: "# Notes" },
      ],
      "html"
    );
    expect(docs[0].content).toContain('href="./ONBOARDING.html">extension');
    expect(docs[0].content).toContain('href="./ONBOARDING.html">letter');
    expect(docs[0].content).toContain('href="./guides/Space%20%26%20Notes.html">notes');
    expect(docs[0].content).toContain('href="./guides%2FSpace%20&amp;%20Notes.md">slash');
    expect(docs[0].content).toContain('href="./ONBOARDING%broken.md">bad');
  });

  it("preserves external links, images, fragments and code examples", () => {
    const content =
      "[external](https://example.com/ONBOARDING.md) [section](#setup) ![image](https://example.com/ONBOARDING.md)\n\n`[setup](./ONBOARDING.md)`\n\n```md\n[setup](./ONBOARDING.md)\n```";
    const docs = applyOutputFormat(
      [
        { name: "BOOTCAMP.md", content },
        { name: "ONBOARDING.md", content: "# Setup" },
      ],
      "html"
    );
    expect(docs[0].content).toContain('href="https://example.com/ONBOARDING.md"');
    expect(docs[0].content).toContain('href="#setup"');
    expect(docs[0].content).toContain('src="https://example.com/ONBOARDING.md"');
    expect(docs[0].content).toContain("<code>[setup](./ONBOARDING.md)</code>");
    expect(docs[0].content).toContain('<code class="language-md">[setup](./ONBOARDING.md)</code>');
  });

  it("returns Markdown and non-Markdown artifacts unchanged", () => {
    const docs = [
      { name: "BOOTCAMP.md", content: "[setup](./ONBOARDING.md)" },
      { name: "facts.json", content: '{"link":"./ONBOARDING.md"}' },
    ];
    expect(applyOutputFormat(docs, "markdown")).toBe(docs);
    expect(applyOutputFormat(docs, "html")[1]).toBe(docs[1]);
  });
});
