/** Discover supported public zero-argument signatures without evaluating Just. */
const RESERVED = new Set(["set", "export", "alias", "import", "mod"]);
const PASSIVE_ATTRIBUTES = new Set(["no-cd"]);

/** Literal defaults only: single quotes, or double quotes with Just escapes. */
function literalEnd(line: string, start: number): number | undefined {
  const quote = line[start];
  if (quote !== "'" && quote !== '"') return;
  if (line.slice(start, start + 3) === quote.repeat(3)) return;
  for (let index = start + 1; index < line.length; index++) {
    if (line[index] === quote) return index + 1;
    if (quote !== '"' || line[index] !== "\\") continue;
    const escaped = line[++index];
    if ('nrt"\\'.includes(escaped ?? "") && escaped !== undefined) continue;
    if (escaped !== "u" || line[++index] !== "{") return;
    const begin = ++index;
    while (index < line.length && /[A-Fa-f0-9]/.test(line[index])) index++;
    const digits = line.slice(begin, index);
    if (line[index] !== "}" || digits.length < 1 || digits.length > 6) return;
    const code = Number.parseInt(digits, 16);
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return;
  }
  return undefined;
}

function spaceEnd(line: string, start: number): number {
  while (line[start] === " " || line[start] === "\t") start++;
  return start;
}

function zeroArgumentName(line: string): string | undefined {
  const recipe = line.match(/^@?([A-Za-z_][A-Za-z0-9_-]*)/);
  if (!recipe || RESERVED.has(recipe[1]) || recipe[1].startsWith("_")) return;
  let index = recipe[0].length;
  while (index < line.length) {
    const beforeSpace = index;
    index = spaceEnd(line, index);
    if (line[index] === ":" && line[index + 1] !== "=") return recipe[1];
    if (index === beforeSpace) return;
    const variadic = line[index] === "+" || line[index] === "*" ? line[index++] : "";
    if (line[index] === "$") index++;
    if (!/[A-Za-z_]/.test(line[index] ?? "")) return;
    index++;
    while (index < line.length && /[A-Za-z0-9_-]/.test(line[index])) index++;
    const parameterEnd = index;
    index = spaceEnd(line, index);
    if (line[index] === "=") {
      index = spaceEnd(line, index + 1);
      const end = literalEnd(line, index);
      if (end === undefined) return;
      index = end;
    } else {
      if (variadic !== "*") return;
      // Keep the separator so the next parameter can be inspected normally.
      index = parameterEnd;
    }
    // Variadics must be last; expression suffixes and malformed tokens are unknown.
    const following = spaceEnd(line, index);
    if (variadic && line[following] !== ":") return;
  }
  return undefined;
}

/** Shield multiline literal/backtick data, never interpreting recipe bodies. */
function* declarationLines(content: string): Generator<{
  line: string | undefined;
  attributeStart?: boolean;
  attributeEnd?: boolean;
}> {
  let delimiter: string | undefined;
  let parentheses = 0;
  let brackets = 0;
  let attribute = false;
  for (const line of content.split(/\r?\n/)) {
    const inside = delimiter !== undefined || parentheses > 0 || brackets > 0;
    const attributeStart = !inside && line.startsWith("[");
    if (attributeStart) attribute = true;
    if (!inside && !attribute && (/^\s/.test(line) || line.startsWith("#"))) {
      yield { line };
      continue;
    }
    for (let index = 0; index < line.length;) {
      if (delimiter) {
        if (delimiter[0] !== "'" && line[index] === "\\") {
          index += 2;
          continue;
        }
        if (line.slice(index, index + delimiter.length) === delimiter) {
          index += delimiter.length;
          delimiter = undefined;
        } else index++;
      } else {
        const char = line[index];
        if (char === "#") break;
        if (char === "'" || char === '"' || char === "`") {
          delimiter = line.slice(index, index + 3) === char.repeat(3) ? char.repeat(3) : char;
          index += delimiter.length;
        } else {
          if (char === "(") parentheses++;
          else if (char === ")" && parentheses > 0) parentheses--;
          else if (char === "[") brackets++;
          else if (char === "]" && brackets > 0) brackets--;
          index++;
        }
      }
    }
    const attributeEnd = attribute && !delimiter && parentheses === 0 && brackets === 0;
    yield {
      line: attribute
        ? line
        : inside || delimiter || parentheses > 0 || brackets > 0
          ? undefined
          : line,
      attributeStart,
      attributeEnd,
    };
    if (attributeEnd) attribute = false;
  }
}

export function publicJustRecipes(content: string): Array<{ name: string; description?: string }> {
  const recipes: Array<{ name: string; description?: string }> = [];
  const seen = new Set<string>();
  let comment: string | undefined;
  let privateRecipe = false;
  let unsupportedAttribute = false;
  for (const line of attributeLines(content)) {
    if (line === undefined || /^\s/.test(line) || line === "") {
      comment = undefined;
      privateRecipe = false;
      unsupportedAttribute = false;
      continue;
    }
    if (line.startsWith("#")) {
      comment = line.replace(/^#+\s*/, "") || undefined;
      continue;
    }
    if (line.startsWith("[")) {
      const attributes = line.match(/^\[\s*([A-Za-z-]+(?:\s*,\s*[A-Za-z-]+)*)\s*\]\s*(?:#.*)?$/);
      if (!attributes) unsupportedAttribute = true;
      else
        for (const attribute of attributes[1].split(/\s*,\s*/)) {
          if (attribute === "private") privateRecipe = true;
          else if (!PASSIVE_ATTRIBUTES.has(attribute)) unsupportedAttribute = true;
        }
      continue;
    }
    const name = !privateRecipe && !unsupportedAttribute ? zeroArgumentName(line) : undefined;
    if (name && !seen.has(name)) {
      seen.add(name);
      recipes.push({ name, description: comment });
    }
    comment = undefined;
    privateRecipe = false;
    unsupportedAttribute = false;
  }
  return recipes;
}

/** Fold literal attribute blocks once, keeping private/unsupported state on the recipe. */
function* attributeLines(content: string): Generator<string | undefined> {
  let parts: string[] | undefined;
  for (const { line, attributeStart, attributeEnd } of declarationLines(content)) {
    if (parts) {
      parts.push(line ?? "");
      if (attributeEnd) {
        yield parts.join(" ");
        parts = undefined;
      }
    } else if (attributeStart && !attributeEnd) parts = [line ?? ""];
    else yield line;
  }
}
