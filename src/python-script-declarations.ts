/** Literal TOML declarations for task discovery, without evaluating a project. */
interface TomlString {
  value: string;
  end: number;
}

/** Read the four TOML string forms; keys use only the single-line forms. */
function readString(
  text: string,
  start: number,
  key = false,
  decode = true
): TomlString | undefined {
  const quote = text[start];
  if (quote !== '"' && quote !== "'") return;
  const multiline = text.slice(start, start + 3) === quote.repeat(3);
  if (key && multiline) return;
  let index = start + (multiline ? 3 : 1);
  const pieces: string[] = [];
  if (multiline && text[index] === "\r") index++;
  if (multiline && text[index] === "\n") index++;
  while (index < text.length) {
    const char = text[index];
    if (char === quote) {
      if (!multiline) return { value: pieces.join(""), end: index + 1 };
      let end = index;
      while (text[end] === quote) end++;
      const count = end - index;
      if (count >= 3) {
        if (count > 5) return;
        if (decode) pieces.push(quote.repeat(count - 3));
        return { value: pieces.join(""), end };
      }
      if (decode) pieces.push(quote.repeat(count));
      index = end;
      continue;
    }
    if (char === "\\" && quote === '"') {
      const escaped = text[++index];
      if (multiline && /[ \t\r\n]/.test(escaped ?? "")) {
        const whitespaceStart = index;
        while (index < text.length && /[ \t\r\n]/.test(text[index])) index++;
        if (!text.slice(whitespaceStart, index).includes("\n")) return;
        continue;
      }
      const escapes: Record<string, string> = {
        b: "\b",
        t: "\t",
        n: "\n",
        f: "\f",
        r: "\r",
        '"': '"',
        "\\": "\\",
      };
      if (escaped === "u" || escaped === "U") {
        const width = escaped === "u" ? 4 : 8;
        const digits = text.slice(index + 1, index + 1 + width);
        if (digits.length !== width || !/^[0-9A-Fa-f]+$/.test(digits)) return;
        const point = Number.parseInt(digits, 16);
        if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return;
        if (decode) pieces.push(String.fromCodePoint(point));
        index += width + 1;
        continue;
      }
      if (!(escaped in escapes)) return;
      if (decode) pieces.push(escapes[escaped]);
      index++;
      continue;
    }
    const code = char.charCodeAt(0);
    if (
      (!multiline && (char === "\n" || char === "\r")) ||
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0x7f
    )
      return;
    if (decode) pieces.push(char);
    index++;
  }
  return undefined;
}

/**
 * Fold value data into one statement, shielding tables/keys inside strings,
 * comments and arrays. Each character is visited a bounded number of times.
 */
function* statements(content: string): Generator<string> {
  let start = 0;
  let index = 0;
  let depth = 0;
  const parts: string[] = [];
  while (index < content.length) {
    const char = content[index];
    if (char === '"' || char === "'") {
      const string = readString(content, index, false, false);
      // Incomplete/unsupported strings cannot safely expose later declarations.
      if (!string) return;
      index = string.end;
      continue;
    }
    if (char === "#") {
      parts.push(content.slice(start, index));
      while (index < content.length && content[index] !== "\n") index++;
      start = index;
      continue;
    }
    if (char === "[" || char === "{") depth++;
    if (char === "]" || char === "}") depth--;
    if (char === "\n" && depth === 0) {
      parts.push(content.slice(start, index));
      yield parts.join("").trim();
      parts.length = 0;
      start = index + 1;
    }
    index++;
  }
  parts.push(content.slice(start));
  if (depth === 0) yield parts.join("").trim();
}

function skipSpace(text: string, index: number): number {
  while (text[index] === " " || text[index] === "\t") index++;
  return index;
}

/** A quoted dot is part of a name; an unquoted dot separates table components. */
function readKey(text: string, start: number): TomlString | undefined {
  start = skipSpace(text, start);
  if (text[start] === '"' || text[start] === "'") return readString(text, start, true);
  let end = start;
  while (end < text.length && /[A-Za-z0-9_-]/.test(text[end])) end++;
  if (end > start) return { value: text.slice(start, end), end };
  return undefined;
}

function tablePath(statement: string): string[] | undefined {
  if (!statement.startsWith("[") || statement.startsWith("[[")) return;
  const path: string[] = [];
  let index = 1;
  while (index < statement.length) {
    const key = readKey(statement, index);
    if (!key) return;
    path.push(key.value);
    index = skipSpace(statement, key.end);
    if (statement[index] === "]" && index === statement.length - 1) return path;
    if (statement[index] !== ".") return;
    index++;
  }
  return undefined;
}

function stringValue(value: string): string | undefined {
  const string = readString(value, 0);
  if (string && value.slice(string.end).trim() === "") return string.value;
  return undefined;
}

/** Literal string-array extras are supported by Poetry's script-table schema. */
function stringArray(text: string, start: number): { value: string[]; end: number } | undefined {
  if (text[start] !== "[") return;
  const values: string[] = [];
  let index = start + 1;
  while (index < text.length) {
    while (/[ \t\r\n]/.test(text[index] ?? "")) index++;
    if (text[index] === "]") return { value: values, end: index + 1 };
    const string = readString(text, index);
    if (!string) return;
    values.push(string.value);
    index = string.end;
    while (/[ \t\r\n]/.test(text[index] ?? "")) index++;
    if (text[index] === "]") return { value: values, end: index + 1 };
    if (text[index++] !== ",") return;
  }
  return undefined;
}

/** Preserve current reference/type and legacy callable script-table shapes. */
function poetryTable(value: string): boolean {
  if (!value.startsWith("{") || !value.endsWith("}")) return false;
  const fields = new Map<string, string | string[]>();
  let index = 1;
  while (index < value.length - 1) {
    const key = readKey(value, index);
    if (!key || fields.has(key.value)) return false;
    index = skipSpace(value, key.end);
    if (value[index++] !== "=") return false;
    index = skipSpace(value, index);
    const field = key.value === "extras" ? stringArray(value, index) : readString(value, index);
    if (!field) return false;
    fields.set(key.value, field.value);
    index = skipSpace(value, field.end);
    if (index === value.length - 1) break;
    if (value[index++] !== ",") return false;
    if (skipSpace(value, index) === value.length - 1) return false;
  }
  const callable = fields.get("callable");
  if (typeof callable === "string" && callable !== "") {
    return [...fields.keys()].every((key) => key === "callable" || key === "extras");
  }
  const reference = fields.get("reference");
  return (
    typeof reference === "string" &&
    reference !== "" &&
    (fields.get("type") === "file" || fields.get("type") === "console") &&
    [...fields.keys()].every((key) => key === "reference" || key === "type" || key === "extras")
  );
}

export function pythonScriptDeclarations(
  content: string
): Array<{ name: string; poetry: boolean }> {
  const scripts: Array<{ name: string; poetry: boolean }> = [];
  let section: "pep621" | "poetry" | undefined;
  for (const statement of statements(content)) {
    if (statement.startsWith("[")) {
      const path = tablePath(statement);
      section =
        path?.length === 2 && path[0] === "project" && path[1] === "scripts"
          ? "pep621"
          : path?.length === 3 &&
              path[0] === "tool" &&
              path[1] === "poetry" &&
              path[2] === "scripts"
            ? "poetry"
            : undefined;
      continue;
    }
    if (!section) continue;
    const key = readKey(statement, 0);
    if (!key || !/^[A-Za-z0-9_.-]+$/.test(key.value)) continue;
    const equals = skipSpace(statement, key.end);
    // Dotted keys create nested objects, not console-script names.
    if (statement[equals] !== "=") continue;
    const value = statement.slice(equals + 1).trim();
    if (stringValue(value) === undefined && !(section === "poetry" && poetryTable(value))) continue;
    scripts.push({ name: key.value, poetry: section === "poetry" });
  }
  return scripts;
}
