/**
 * Parse JSON with comments and trailing commas while preserving quoted text.
 * Returns null when the input is not valid JSONC.
 */
export function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Continue with JSONC cleanup.
  }
  try {
    const chunks: string[] = [];
    let start = 0;
    let quoted = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') {
        quoted = true;
      } else if (char === "/" && text[i + 1] === "/") {
        let end = i + 2;
        while (end < text.length && text[end] !== "\r" && text[end] !== "\n") end++;
        chunks.push(text.slice(start, i), " ");
        start = end;
        i = end - 1;
      } else if (char === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        if (end === -1) return null;
        chunks.push(text.slice(start, i), " ");
        start = end + 2;
        i = end + 1;
      }
    }
    chunks.push(text.slice(start));
    const stripped = chunks.join("");

    const normalized: string[] = [];
    start = 0;
    quoted = false;
    escaped = false;
    for (let i = 0; i < stripped.length; i++) {
      const char = stripped[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        let next = i + 1;
        while (next < stripped.length && /\s/.test(stripped[next])) next++;
        if (stripped[next] === "}" || stripped[next] === "]") {
          normalized.push(stripped.slice(start, i));
          start = i + 1;
        }
      }
    }
    normalized.push(stripped.slice(start));
    return JSON.parse(normalized.join("")) as unknown;
  } catch {
    return null;
  }
}
