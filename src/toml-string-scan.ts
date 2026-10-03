/** Bounded TOML string/array readers for dependency metadata, not a document parser. */
export interface TomlString {
  value: string;
  /** First character after the complete closing delimiter. */
  end: number;
}

const basicEscapes: Record<string, string> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

/** Read one complete basic/literal string, including their multiline forms. */
export function readTomlString(source: string, start: number): TomlString | null {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;
  const multiline = source.startsWith(quote.repeat(3), start);
  const width = multiline ? 3 : 1;
  let index = start + width;
  if (multiline) {
    if (source.startsWith("\r\n", index)) index += 2;
    else if (source[index] === "\n") index++;
  }
  const chunks: string[] = [];
  while (index < source.length) {
    const character = source[index];
    if (character === quote) {
      let end = index;
      while (source[end] === quote) end++;
      const run = end - index;
      if (!multiline) return { value: chunks.join(""), end: index + 1 };
      if (run >= 3) {
        if (run > 5) return null;
        chunks.push(quote.repeat(run - 3));
        return { value: chunks.join(""), end };
      }
      chunks.push(quote.repeat(run));
      index = end;
      continue;
    }
    if (quote === '"' && character === "\\") {
      const escape = source[index + 1];
      if (escape !== undefined && Object.hasOwn(basicEscapes, escape)) {
        chunks.push(basicEscapes[escape]);
        index += 2;
        continue;
      }
      if (escape === "u" || escape === "U") {
        const digits = escape === "u" ? 4 : 8;
        const hex = source.slice(index + 2, index + 2 + digits);
        if (hex.length !== digits || !/^[\da-f]+$/i.test(hex)) return null;
        const scalar = Number.parseInt(hex, 16);
        if (scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff)) return null;
        chunks.push(String.fromCodePoint(scalar));
        index += digits + 2;
        continue;
      }
      if (multiline) {
        let next = index + 1;
        while (source[next] === " " || source[next] === "\t") next++;
        if (source[next] === "\n" || source.startsWith("\r\n", next)) {
          while (next < source.length) {
            if (/[ \t\n]/.test(source[next])) next++;
            else if (source[next] === "\r") {
              if (!source.startsWith("\r\n", next)) return null;
              next += 2;
            } else break;
          }
          index = next;
          continue;
        }
      }
      return null;
    }
    if (!multiline && (character === "\n" || character === "\r")) return null;
    if (character === "\r" && !source.startsWith("\r\n", index)) return null;
    const code = character.charCodeAt(0);
    if (
      (code < 0x20 && character !== "\t" && !(multiline && /[\r\n]/.test(character))) ||
      code === 0x7f
    )
      return null;
    if (multiline && source.startsWith("\r\n", index)) {
      chunks.push("\n");
      index += 2;
    } else {
      chunks.push(character);
      index++;
    }
  }
  return null;
}

/** Complete array bodies; quoted brackets and unrelated scalar strings are skipped. */
export function tomlArrayBodies(source: string, key?: string): string[] {
  const arrays: string[] = [];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '"' || source[index] === "'") {
      const quoted = readTomlString(source, index);
      if (!quoted) break;
      index = quoted.end - 1;
      continue;
    }
    if (source[index] !== "[") continue;
    const prefix = source.slice(source.lastIndexOf("\n", index) + 1, index);
    const assignment = prefix.match(/^\s*(?:"([^"]+)"|'([^']+)'|([\w-]+))\s*=\s*$/);
    const matchesKey =
      !key || (assignment && (assignment[1] ?? assignment[2] ?? assignment[3]) === key);
    const start = index + 1;
    let depth = 1;
    let cursor = start;
    for (; cursor < source.length && depth; cursor++) {
      if (source[cursor] === '"' || source[cursor] === "'") {
        const quoted = readTomlString(source, cursor);
        if (!quoted) return arrays;
        cursor = quoted.end - 1;
      } else if (source[cursor] === "[") depth++;
      else if (source[cursor] === "]") depth--;
    }
    if (depth) break;
    if (matchesKey) arrays.push(source.slice(start, cursor - 1));
    index = cursor - 1;
  }
  return arrays;
}

/** Primitive string members only; inline-table/group references are not packages. */
export function tomlArrayStrings(body: string): string[] {
  const values: string[] = [];
  let nesting = 0;
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (character === '"' || character === "'") {
      const quoted = readTomlString(body, index);
      if (!quoted) break;
      if (!nesting) values.push(quoted.value);
      index = quoted.end - 1;
    } else if (character === "[" || character === "{") nesting++;
    else if (character === "]" || character === "}") nesting = Math.max(0, nesting - 1);
  }
  return values;
}
