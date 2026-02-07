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
    const cls = lang ? ` class="language-${lang}"` : "";
    return `<pre><code${cls}>${escapeHtml(code.trimEnd())}</code></pre>`;
  });
}

/**
 * Convert inline markdown formatting to HTML.
 */
function convertInlineFormatting(line: string): string {
  // Images (must come before links)
  line = line.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  // Links
  line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Bold
  line = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  line = line.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Inline code
  line = line.replace(/`([^`]+)`/g, "<code>$1</code>");
  return line;
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
  let processed = md.replace(/```(\w*)\n([\s\S]*?)```/g, (match) => {
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
        if (inList) { html.push("</ul>"); inList = false; }
        if (inOrderedList) { html.push("</ol>"); inOrderedList = false; }
        if (inTable) { html.push("</table>"); inTable = false; }
        html.push(codeBlockPlaceholders[parseInt(indexText, 10)]);
        continue;
      }
    }

    // Passthrough HTML tags (e.g. <details>, <summary>)
    if (/^\s*</.test(line)) {
      if (inList) { html.push("</ul>"); inList = false; }
      if (inOrderedList) { html.push("</ol>"); inOrderedList = false; }
      if (inTable) { html.push("</table>"); inTable = false; }
      html.push(line);
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      if (inList) { html.push("</ul>"); inList = false; }
      if (inOrderedList) { html.push("</ol>"); inOrderedList = false; }
      if (inTable) { html.push("</table>"); inTable = false; }
      const level = headingMatch[1].length;
      html.push(`<h${level}>${convertInlineFormatting(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      if (inList) { html.push("</ul>"); inList = false; }
      if (inOrderedList) { html.push("</ol>"); inOrderedList = false; }
      if (inTable) { html.push("</table>"); inTable = false; }
      html.push("<hr />");
      continue;
    }

    // Blockquote
    if (/^>\s*(.*)/.test(line)) {
      if (inList) { html.push("</ul>"); inList = false; }
      if (inOrderedList) { html.push("</ol>"); inOrderedList = false; }
      if (inTable) { html.push("</table>"); inTable = false; }
      const text = line.replace(/^>\s*/, "");
      html.push(`<blockquote>${convertInlineFormatting(text)}</blockquote>`);
      continue;
    }

    // Table row
    if (/^\|/.test(line)) {
      // Skip separator rows (e.g. |---|---|)
      if (/^\|[\s-:|]+\|$/.test(line)) continue;

      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      if (!inTable) {
        html.push("<table>");
        inTable = true;
        html.push("<tr>" + cells.map(c => `<th>${convertInlineFormatting(c)}</th>`).join("") + "</tr>");
      } else {
        html.push("<tr>" + cells.map(c => `<td>${convertInlineFormatting(c)}</td>`).join("") + "</tr>");
      }
      continue;
    } else if (inTable) {
      html.push("</table>");
      inTable = false;
    }

    // Unordered list item
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    if (ulMatch) {
      if (inOrderedList) { html.push("</ol>"); inOrderedList = false; }
      if (!inList) { html.push("<ul>"); inList = true; }
      let content = ulMatch[2];
      content = content.replace(/^\[x\]\s*/i, "☑ ").replace(/^\[ \]\s*/, "☐ ");
      html.push(`<li>${convertInlineFormatting(content)}</li>`);
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^\s*\d+\.\s+(.*)/);
    if (olMatch) {
      if (inList) { html.push("</ul>"); inList = false; }
      if (!inOrderedList) { html.push("<ol>"); inOrderedList = true; }
      html.push(`<li>${convertInlineFormatting(olMatch[1])}</li>`);
      continue;
    }

    // Close open lists on non-list lines
    if (inList) { html.push("</ul>"); inList = false; }
    if (inOrderedList) { html.push("</ol>"); inOrderedList = false; }

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
  details { margin: 0.5em 0; }
  summary { cursor: pointer; }
</style>
</head>
<body>
${body}
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
 * to a `.pdf.html` file and use a headless browser to produce the
 * actual PDF, or pipe it directly.
 */
export function convertToPdf(markdown: string, title: string): string {
  const body = markdownToHtml(markdown);
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
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Derive the output file extension for the chosen format.
 */
export function getFileExtension(format: OutputFormat): string {
  switch (format) {
    case "html": return ".html";
    case "pdf": return ".pdf.html";
    default: return "";
  }
}

/**
 * Replace the original file extension with the format-appropriate one.
 * For markdown format, returns the name unchanged.
 */
export function formatFileName(originalName: string, format: OutputFormat): string {
  if (format === "markdown") return originalName;

  // Don't convert non-markdown files (JSON, mermaid)
  if (!originalName.endsWith(".md") && !originalName.endsWith(".mmd")) {
    return originalName;
  }

  const baseName = originalName.replace(/\.(md|mmd)$/, "");
  return baseName + getFileExtension(format);
}

/**
 * Convert document content based on the chosen format.
 * Non-markdown files (JSON, mermaid) are returned unchanged.
 */
export function formatContent(
  content: string,
  originalName: string,
  format: OutputFormat,
): string {
  if (format === "markdown") return content;

  // Don't convert non-markdown files
  if (!originalName.endsWith(".md") && !originalName.endsWith(".mmd")) {
    return content;
  }

  const title = originalName.replace(/\.(md|mmd)$/, "");
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
