interface Token {
  value: string;
  quoted: boolean;
  punctuation?: boolean;
}
export interface GoDependencyDeclaration {
  name: string;
  version: string;
}

// Match the Go modfile parser's double-quoted strconv.Unquote semantics, rather
// than the reference prose's broader raw-string wording. No version resolution.
// https://go.dev/src/cmd/vendor/golang.org/x/mod/modfile/rule.go
function quotedValue(line: string, start: number): { value: string; end: number } | null {
  const bytes: number[] = [];
  const append = (value: string): void => {
    bytes.push(...Buffer.from(value, "utf8"));
  };
  const escapes: Record<string, string> = {
    a: "\x07",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
    "\\": "\\",
    '"': '"',
  };
  let cursor = start + 1;
  while (cursor < line.length) {
    const char = line[cursor++];
    if (char === '"') {
      try {
        return {
          value: new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)),
          end: cursor,
        };
      } catch {
        return null;
      }
    }
    if (char !== "\\") {
      const point = line.codePointAt(cursor - 1)!;
      append(String.fromCodePoint(point));
      if (point > 0xffff) cursor++;
      continue;
    }
    const escape = line[cursor++];
    if (escape in escapes) {
      append(escapes[escape]);
      continue;
    }
    let count = 0;
    let radix = 16;
    if (escape === "x") count = 2;
    else if (escape === "u") count = 4;
    else if (escape === "U") count = 8;
    else if (/[0-7]/.test(escape ?? "")) {
      count = 3;
      radix = 8;
      cursor--;
    } else return null;
    const digits = line.slice(cursor, cursor + count);
    if (digits.length !== count || !(radix === 8 ? /^[0-7]+$/ : /^[0-9a-fA-F]+$/).test(digits))
      return null;
    cursor += count;
    const point = Number.parseInt(digits, radix);
    if (escape === "x" || radix === 8) {
      if (point > 255) return null;
      bytes.push(point);
    } else {
      if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return null;
      append(String.fromCodePoint(point));
    }
  }
  return null;
}

function lineTokens(line: string): Token[] | null {
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    if (/[ \t\r]/.test(line[cursor])) {
      cursor++;
      continue;
    }
    if (line.startsWith("//", cursor)) break;
    if (line.startsWith("/*", cursor)) return null;
    const char = line[cursor];
    if (char === '"') {
      const parsed = quotedValue(line, cursor);
      if (!parsed) return null;
      tokens.push({ value: parsed.value, quoted: true });
      cursor = parsed.end;
    } else if (/[()[\]{},]/.test(char)) {
      tokens.push({ value: char, quoted: false, punctuation: true });
      cursor++;
    } else {
      const start = cursor;
      while (
        cursor < line.length &&
        !/[ \t\r()[\]{},]/.test(line[cursor]) &&
        !line.startsWith("//", cursor)
      ) {
        if (/["'`]/.test(line[cursor]) || line.startsWith("/*", cursor)) return null;
        cursor++;
      }
      tokens.push({ value: line.slice(start, cursor), quoted: false });
    }
  }
  return tokens;
}

/** Declared require data only; caller retains existing first-occurrence dedup. */
export function scanGoDependencyDeclarations(content: string): GoDependencyDeclaration[] {
  const declarations: GoDependencyDeclaration[] = [];
  let block: string | null = null;
  const add = (tokens: Token[]): void => {
    if (tokens.length !== 2 || tokens.some((token) => token.punctuation)) return;
    const [name, version] = tokens.map((token) => token.value);
    // Retain the existing v-prefixed declared-version contract, without semver
    // canonicalization or a new resolver/schema validation policy.
    if (!name || /[\s\x00-\x1f\x7f]/.test(name + version) || !version.startsWith("v")) return;
    declarations.push({ name, version });
  };
  for (const line of content.split("\n")) {
    const tokens = lineTokens(line);
    // Invalid literal syntax cannot expose later text as fake directives.
    if (!tokens) return [];
    if (!tokens.length) continue;
    if (block !== null) {
      if (tokens.length === 1 && tokens[0].punctuation && tokens[0].value === ")") block = null;
      else if (block === "require") add(tokens);
      continue;
    }
    if (tokens[0].quoted || tokens[0].punctuation) continue;
    if (tokens.length === 2 && tokens[1].punctuation && tokens[1].value === "(") {
      block = tokens[0].value;
      continue;
    }
    if (tokens[0].value === "require") add(tokens.slice(1));
  }
  return block === null ? declarations : [];
}
