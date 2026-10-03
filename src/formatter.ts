/**
 * Output Format Converter
 *
 * Converts generated markdown documents to HTML or PDF format.
 * PDF generation wraps the HTML output in a minimal page suitable
 * for rendering with a headless browser (e.g. Puppeteer / Chrome).
 */

/** Supported output formats */
export type OutputFormat = "markdown" | "html" | "pdf";

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convert a fenced code block to an HTML <pre><code> block.
 */
function convertCodeBlocks(match: string): string {
  return match.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    if (lang === "mermaid") {
      return `<div class="mermaid">\n${escapeHtml(code.trimEnd())}\n</div>`;
    }
    const cls = lang ? ` class="language-${lang}"` : "";
    return `<pre><code${cls}>${escapeHtml(code.trimEnd())}</code></pre>`;
  });
}

function getMermaidRuntime(body: string): string {
  if (!body.includes('class="mermaid"')) return "";
  return `
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true });
</script>`;
}

/**
 * Convert inline markdown formatting to HTML.
 */
function convertInlineFormatting(line: string): string {
  const isSafeUrl = (value: string, allowRelative: boolean): boolean => {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) return true;
    if (!allowRelative) return false;
    return trimmed.startsWith("#") || trimmed.startsWith("./") || trimmed.startsWith("../");
  };

  // Render protected inline constructs as output fragments while walking the
  // source. This avoids textual placeholders entirely: user content can never
  // be mistaken for an internal token during restoration.
  const render = (source: string, allowLinks = true): string => {
    let output = "";
    let index = 0;

    // Index boundaries once: repeatedly scanning unmatched labels would make
    // bracket-heavy repository text quadratic. Code spans protect brackets.
    const nextBacktick = new Int32Array(source.length);
    const nextParen = new Int32Array(source.length);
    let backtick = -1;
    let paren = -1;
    for (let cursor = source.length - 1; cursor >= 0; cursor--) {
      nextBacktick[cursor] = backtick;
      nextParen[cursor] = paren;
      if (source[cursor] === "`") backtick = cursor;
      if (source[cursor] === ")") paren = cursor;
    }
    const labelEnds = new Map<number, number>();
    const labelStarts: number[] = [];
    for (let cursor = 0; cursor < source.length; cursor++) {
      if (source[cursor] === "`" && nextBacktick[cursor] > cursor + 1) {
        cursor = nextBacktick[cursor];
      } else if (source[cursor] === "[") {
        labelStarts.push(cursor);
      } else if (source[cursor] === "]" && labelStarts.length) {
        labelEnds.set(labelStarts.pop()!, cursor);
      }
    }
    const readLink = (
      start: number,
      allowEmptyLabel = false
    ): { text: string; url: string; length: number } | null => {
      const close = labelEnds.get(start);
      if (
        close === undefined ||
        (!allowEmptyLabel && close === start + 1) ||
        source[close + 1] !== "("
      ) {
        return null;
      }
      const end = nextParen[close + 1];
      if (end <= close + 2) return null;
      return {
        text: source.slice(start + 1, close),
        url: source.slice(close + 2, end),
        length: end - start + 1,
      };
    };

    while (index < source.length) {
      const remainder = source.slice(index);

      // Images must be checked before links so the leading `!` is not treated
      // as ordinary text. Unsafe image URLs are rendered as escaped alt text.
      const imageMatch = source[index] === "!" ? readLink(index + 1, true) : null;
      if (imageMatch) {
        const { text: alt, url, length } = imageMatch;
        output += isSafeUrl(url, false)
          ? `<img src="${escapeHtml(url.trim())}" alt="${escapeHtml(alt)}" />`
          : escapeHtml(alt);
        index += length + 1;
        continue;
      }

      const linkMatch = allowLinks ? readLink(index) : null;
      if (linkMatch) {
        const { text, url, length } = linkMatch;
        output += isSafeUrl(url, true)
          ? `<a href="${escapeHtml(url.trim())}">${render(text, false)}</a>`
          : render(text, false);
        index += length;
        continue;
      }

      const codeMatch = remainder.match(/^`([^`]+)`/);
      if (codeMatch) {
        output += `<code>${escapeHtml(codeMatch[1])}</code>`;
        index += codeMatch[0].length;
        continue;
      }

      const boldMatch = remainder.match(/^\*\*(.+?)\*\*/);
      if (boldMatch) {
        output += `<strong>${render(boldMatch[1], allowLinks)}</strong>`;
        index += boldMatch[0].length;
        continue;
      }

      const italicMatch = remainder.match(/^\*(.+?)\*/);
      if (italicMatch) {
        output += `<em>${render(italicMatch[1], allowLinks)}</em>`;
        index += italicMatch[0].length;
        continue;
      }

      output += escapeHtml(source[index]);
      index += 1;
    }

    return output;
  };

  return render(line);
}

/**
 * Convert a simple markdown string to HTML.
 *
 * Handles the subset of markdown produced by the generator: headings,
 * lists, tables, code blocks, blockquotes, inline formatting, HTML
 * passthrough, and horizontal rules.
 */
export function markdownToHtml(md: string): string {
  // Pull out code blocks so they aren't processed line-by-line
  const codeBlockPlaceholders: string[] = [];
  const processed = md.replace(/```(\w*)\n([\s\S]*?)```/g, (match) => {
    const idx = codeBlockPlaceholders.length;
    codeBlockPlaceholders.push(convertCodeBlocks(match));
    return `\x00CODEBLOCK_${idx}\x00`;
  });

  const lines = processed.split("\n");
  const html: string[] = [];
  let inList = false;
  let inOrderedList = false;
  let inTable = false;
  const placeholderPrefix = "\x00CODEBLOCK_";
  const placeholderSuffix = "\x00";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Restore code block placeholders
    if (line.startsWith(placeholderPrefix) && line.endsWith(placeholderSuffix)) {
      const indexText = line.slice(placeholderPrefix.length, -placeholderSuffix.length);
      if (/^\d+$/.test(indexText)) {
        if (inList) {
          html.push("</ul>");
          inList = false;
        }
        if (inOrderedList) {
          html.push("</ol>");
          inOrderedList = false;
        }
        if (inTable) {
          html.push("</table>");
          inTable = false;
        }
        html.push(codeBlockPlaceholders[parseInt(indexText, 10)]);
        continue;
      }
    }

    // Preserve only the disclosure tags emitted by the generator. Other raw
    // HTML is escaped so a repository-derived document cannot execute scripts
    // when opened through the HTML/PDF output formats.
    if (/^\s*</.test(line)) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      if (inOrderedList) {
        html.push("</ol>");
        inOrderedList = false;
      }
      if (inTable) {
        html.push("</table>");
        inTable = false;
      }
      const trimmedLine = line.trim();
      const summaryMatch = trimmedLine.match(/^<summary>([\s\S]*)<\/summary>$/i);
      html.push(
        /^<\/?details>$/i.test(trimmedLine)
          ? trimmedLine
          : summaryMatch
            ? `<summary>${escapeHtml(summaryMatch[1])}</summary>`
            : escapeHtml(line)
      );
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      if (inOrderedList) {
        html.push("</ol>");
        inOrderedList = false;
      }
      if (inTable) {
        html.push("</table>");
        inTable = false;
      }
      const level = headingMatch[1].length;
      html.push(`<h${level}>${convertInlineFormatting(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      if (inOrderedList) {
        html.push("</ol>");
        inOrderedList = false;
      }
      if (inTable) {
        html.push("</table>");
        inTable = false;
      }
      html.push("<hr />");
      continue;
    }

    // Blockquote
    if (/^>\s*(.*)/.test(line)) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      if (inOrderedList) {
        html.push("</ol>");
        inOrderedList = false;
      }
      if (inTable) {
        html.push("</table>");
        inTable = false;
      }
      const text = line.replace(/^>\s*/, "");
      html.push(`<blockquote>${convertInlineFormatting(text)}</blockquote>`);
      continue;
    }

    // Table row
    if (/^\|/.test(line)) {
      // Skip separator rows (e.g. |---|---|)
      if (/^\|[\s-:|]+\|$/.test(line)) continue;

      const cells = line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      if (!inTable) {
        html.push("<table>");
        inTable = true;
        html.push(
          "<tr>" + cells.map((c) => `<th>${convertInlineFormatting(c)}</th>`).join("") + "</tr>"
        );
      } else {
        html.push(
          "<tr>" + cells.map((c) => `<td>${convertInlineFormatting(c)}</td>`).join("") + "</tr>"
        );
      }
      continue;
    } else if (inTable) {
      html.push("</table>");
      inTable = false;
    }

    // Unordered list item
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    if (ulMatch) {
      if (inOrderedList) {
        html.push("</ol>");
        inOrderedList = false;
      }
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      let content = ulMatch[2];
      content = content.replace(/^\[x\]\s*/i, "☑ ").replace(/^\[ \]\s*/, "☐ ");
      html.push(`<li>${convertInlineFormatting(content)}</li>`);
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^\s*\d+\.\s+(.*)/);
    if (olMatch) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      if (!inOrderedList) {
        html.push("<ol>");
        inOrderedList = true;
      }
      html.push(`<li>${convertInlineFormatting(olMatch[1])}</li>`);
      continue;
    }

    // Close open lists on non-list lines
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
    if (inOrderedList) {
      html.push("</ol>");
      inOrderedList = false;
    }

    // Blank line
    if (line.trim() === "") continue;

    // Paragraph
    html.push(`<p>${convertInlineFormatting(line)}</p>`);
  }

  // Close any open lists/tables
  if (inList) html.push("</ul>");
  if (inOrderedList) html.push("</ol>");
  if (inTable) html.push("</table>");

  return html.join("\n");
}

/**
 * Wrap HTML body content in a full HTML page with basic styling.
 */
export function wrapHtmlPage(body: string, title: string): string {
  const mermaidRuntime = getMermaidRuntime(body);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #24292f; line-height: 1.6; }
  h1, h2, h3, h4 { margin-top: 1.5em; }
  pre { background: #f6f8fa; padding: 1em; border-radius: 6px; overflow-x: auto; }
  code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.9em; }
  :not(pre) > code { background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d0d7de; padding: 0.5em 1em; text-align: left; }
  th { background: #f6f8fa; }
  blockquote { border-left: 4px solid #d0d7de; margin: 1em 0; padding: 0.5em 1em; color: #57606a; }
  hr { border: none; border-top: 1px solid #d0d7de; margin: 2em 0; }
  a { color: #0969da; text-decoration: none; }
  a:hover { text-decoration: underline; }
  img { max-width: 100%; }
  .mermaid { overflow-x: auto; }
  details { margin: 0.5em 0; }
  summary { cursor: pointer; }
</style>
</head>
<body>
${body}
${mermaidRuntime}
</body>
</html>`;
}

/**
 * Convert a markdown document to a full HTML page.
 */
export function convertToHtml(markdown: string, title: string): string {
  return wrapHtmlPage(markdownToHtml(markdown), title);
}

/**
 * Convert a markdown document to a PDF-ready HTML page.
 *
 * Returns HTML with print-optimised styles. The caller can write this
 * to a `.html` file and use a headless browser to produce the
 * actual PDF, or pipe it directly.
 */
export function convertToPdf(markdown: string, title: string): string {
  const body = markdownToHtml(markdown);
  const mermaidRuntime = getMermaidRuntime(body);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; max-width: 100%; color: #24292f; line-height: 1.6; font-size: 11pt; }
  h1, h2, h3, h4 { margin-top: 1.5em; page-break-after: avoid; }
  pre { background: #f6f8fa; padding: 1em; border-radius: 6px; overflow-x: auto; page-break-inside: avoid; }
  code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.9em; }
  :not(pre) > code { background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; page-break-inside: avoid; }
  th, td { border: 1px solid #d0d7de; padding: 0.5em 1em; text-align: left; }
  th { background: #f6f8fa; }
  blockquote { border-left: 4px solid #d0d7de; margin: 1em 0; padding: 0.5em 1em; color: #57606a; }
  hr { border: none; border-top: 1px solid #d0d7de; margin: 2em 0; }
  a { color: #0969da; text-decoration: none; }
  img { max-width: 100%; }
  .mermaid { overflow-x: auto; }
</style>
</head>
<body>
${body}
${mermaidRuntime}
</body>
</html>`;
}

/**
 * Derive the output file extension for the chosen format.
 */
export function getFileExtension(format: OutputFormat): string {
  switch (format) {
    case "html":
      return ".html";
    case "pdf":
      return ".html";
    default:
      return "";
  }
}

/**
 * Replace the original file extension with the format-appropriate one.
 * For markdown format, returns the name unchanged.
 */
export function formatFileName(originalName: string, format: OutputFormat): string {
  if (format === "markdown") return originalName;

  // Don't convert non-markdown files (JSON, mermaid)
  if (!originalName.endsWith(".md")) {
    return originalName;
  }

  const baseName = originalName.replace(/\.md$/, "");
  return baseName + getFileExtension(format);
}

/**
 * Convert document content based on the chosen format.
 * Non-markdown files (JSON, mermaid) are returned unchanged.
 */
export function formatContent(content: string, originalName: string, format: OutputFormat): string {
  if (format === "markdown") return content;

  // Don't convert non-markdown files
  if (!originalName.endsWith(".md")) {
    return content;
  }

  const title = originalName.replace(/\.md$/, "");
  if (format === "html") return convertToHtml(content, title);
  if (format === "pdf") return convertToPdf(content, title);
  return content;
}

export function formatDocName(name: string, format: OutputFormat): string {
  if (format === "markdown" || !name.endsWith(".md")) return name;
  return formatFileName(name, format);
}

export function applyOutputFormat(
  documents: { name: string; content: string }[],
  format: OutputFormat
): { name: string; content: string }[] {
  if (format === "markdown") return documents;
  return documents.map((doc) => {
    if (!doc.name.endsWith(".md")) return doc;
    return {
      name: formatFileName(doc.name, format),
      content: formatContent(doc.content, doc.name, format),
    };
  });
}
