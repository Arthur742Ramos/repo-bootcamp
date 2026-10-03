import { readTomlString } from "./toml-string-scan.js";

/** Typed metadata only: numeric/date atoms are intentionally not interpreted. */
export type TomlMetadataTable = Map<string, TomlMetadataValue>;
export type TomlMetadataValue =
  string | boolean | TomlMetadataValue[] | TomlMetadataTable | { kind: "opaque"; raw: string };
export interface TomlDeclaration {
  kind: "table" | "assignment";
  path: string[];
  offset: number;
  end: number;
  array?: boolean;
}

interface TableState {
  explicit: boolean;
  dotted: boolean;
  sealed: boolean;
}
interface Key {
  path: string[];
  end: number;
}
interface Value {
  value: TomlMetadataValue;
  end: number;
}

/**
 * A bounded structural cursor, not a TOML scalar/constraint validator. Stops at
 * the first malformed declaration; callers must honor `complete` before using
 * the partial tree. Offsets are UTF-16 positions in the original source.
 */
export function scanTomlMetadata(content: string): {
  root: TomlMetadataTable;
  /** Outer declarations/headers only, suitable for source section slicing. */
  declarations: TomlDeclaration[];
  /** All declaration and inline-key occurrences, ordered by source offset. */
  occurrences: TomlDeclaration[];
  complete: boolean;
} {
  const states = new WeakMap<TomlMetadataTable, TableState>();
  const arrayTables = new WeakSet<TomlMetadataValue[]>();
  const declarations: TomlDeclaration[] = [];
  const occurrences: TomlDeclaration[] = [];
  let inlineOccurrences: TomlDeclaration[] = [];
  const makeTable = (dotted = false): TomlMetadataTable => {
    const table: TomlMetadataTable = new Map();
    states.set(table, { explicit: false, dotted, sealed: false });
    return table;
  };
  const root = makeTable();
  let current = root;
  let currentPath: string[] = [];
  const horizontal = (start: number): number => {
    while (content[start] === " " || content[start] === "\t") start++;
    return start;
  };
  const newline = (start: number): number => {
    if (content[start] === "\n") return start + 1;
    if (content.startsWith("\r\n", start)) return start + 2;
    return start;
  };
  const comment = (start: number): number => {
    if (content[start] !== "#") return start;
    while (start < content.length && !/[\r\n]/.test(content[start])) {
      const code = content.charCodeAt(start);
      if ((code < 0x20 && code !== 9) || code === 0x7f) return -1;
      start++;
    }
    return start;
  };
  const trivia = (start: number): number => {
    while (start < content.length) {
      const next = comment(horizontal(start));
      if (next < 0) return -1;
      const end = newline(next);
      if (end === next) return next;
      start = end;
    }
    return start;
  };
  const readKey = (start: number): Key | null => {
    const path: string[] = [];
    let index = horizontal(start);
    for (;;) {
      if (content[index] === '"' || content[index] === "'") {
        if (content.startsWith(content[index].repeat(3), index)) return null;
        const string = readTomlString(content, index);
        if (!string) return null;
        path.push(string.value);
        index = string.end;
      } else {
        const begin = index;
        while (index < content.length && /[A-Za-z0-9_-]/.test(content[index])) index++;
        if (begin === index) return null;
        path.push(content.slice(begin, index));
      }
      if (path.length > 128) return null;
      index = horizontal(index);
      if (content[index] !== ".") return { path, end: index };
      index = horizontal(index + 1);
    }
  };
  const child = (
    parent: TomlMetadataTable,
    key: string,
    dotted: boolean
  ): TomlMetadataTable | null => {
    if (states.get(parent)?.sealed) return null;
    const existing = parent.get(key);
    if (existing === undefined) {
      const table = makeTable(dotted);
      parent.set(key, table);
      return table;
    }
    if (existing instanceof Map) {
      const state = states.get(existing)!;
      if (state.sealed || (dotted && state.explicit)) return null;
      if (dotted) state.dotted = true;
      return existing;
    }
    if (Array.isArray(existing) && arrayTables.has(existing)) {
      if (dotted) return null;
      const last = existing[existing.length - 1];
      if (last instanceof Map) return last;
    }
    return null;
  };
  const assign = (table: TomlMetadataTable, path: string[], value: TomlMetadataValue): boolean => {
    for (const key of path.slice(0, -1)) {
      const next = child(table, key, true);
      if (!next) return false;
      table = next;
    }
    const key = path[path.length - 1];
    if (states.get(table)?.sealed || table.has(key)) return false;
    table.set(key, value);
    return true;
  };
  const seal = (value: TomlMetadataValue): void => {
    const pending = [value];
    while (pending.length) {
      const member = pending.pop()!;
      if (member instanceof Map) {
        states.get(member)!.sealed = true;
        for (const nested of member.values()) pending.push(nested);
      } else if (Array.isArray(member)) {
        for (const nested of member) pending.push(nested);
      }
    }
  };
  const readValue = (start: number, path: string[], depth = 0): Value | null => {
    if (depth > 128) return null;
    let index = horizontal(start);
    if (content[index] === '"' || content[index] === "'") {
      const string = readTomlString(content, index);
      return string ? { value: string.value, end: string.end } : null;
    }
    if (content[index] === "[") {
      const values: TomlMetadataValue[] = [];
      index = trivia(index + 1);
      if (index < 0) return null;
      if (content[index] === "]") return { value: values, end: index + 1 };
      for (;;) {
        // Array alternatives share their owning semantic path (no fake indexes).
        const member = readValue(index, path, depth + 1);
        if (!member) return null;
        values.push(member.value);
        index = trivia(member.end);
        if (index < 0) return null;
        if (content[index] === "]") return { value: values, end: index + 1 };
        if (content[index] !== ",") return null;
        index = trivia(index + 1);
        if (index < 0) return null;
        if (content[index] === "]") return { value: values, end: index + 1 };
      }
    }
    if (content[index] === "{") {
      const table = makeTable();
      index = horizontal(index + 1);
      if (content[index] === "}") {
        seal(table);
        return { value: table, end: index + 1 };
      }
      for (;;) {
        const offset = index;
        const key = readKey(index);
        if (!key || content[key.end] !== "=") return null;
        const memberPath = [...path, ...key.path];
        const member = readValue(key.end + 1, memberPath, depth + 1);
        if (!member || !assign(table, key.path, member.value)) return null;
        inlineOccurrences.push({
          kind: "assignment",
          path: memberPath,
          offset,
          end: member.end,
        });
        index = horizontal(member.end);
        if (content[index] === "}") {
          seal(table);
          return { value: table, end: index + 1 };
        }
        if (content[index] !== ",") return null;
        index = horizontal(index + 1);
        // Inline tables do not permit trailing commas or inter-member newlines.
        if (content[index] === "}") return null;
      }
    }
    const begin = index;
    while (index < content.length && !/[,\]}#\r\n]/.test(content[index])) index++;
    const raw = content.slice(begin, index).trimEnd();
    const end = begin + raw.length;
    if (raw === "true" || raw === "false") return { value: raw === "true", end };
    // Keep scalar spelling, without accepting stray quotes/headers/assignments.
    // Numeric/date semantics (ranges, calendar validity, etc.) are out of scope.
    const digits = "\\d(?:_?\\d)*";
    const decimal = "(?:0|[1-9](?:_?\\d)*)";
    const number = new RegExp(
      `^(?:[+-]?(?:inf|nan)|[+-]?${decimal}(?:\\.${digits})?(?:[eE][+-]?${digits})?|0x[\\da-fA-F](?:_?[\\da-fA-F])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*)$`
    );
    const date =
      /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?$/;
    const time = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
    if (!number.test(raw) && !date.test(raw) && !time.test(raw)) return null;
    return { value: { kind: "opaque", raw }, end };
  };
  const openTable = (path: string[], array: boolean): TomlMetadataTable | null => {
    let table = root;
    for (const key of path.slice(0, -1)) {
      const next = child(table, key, false);
      if (!next) return null;
      table = next;
    }
    const key = path[path.length - 1];
    if (states.get(table)?.sealed) return null;
    const existing = table.get(key);
    if (array) {
      if (existing !== undefined && (!Array.isArray(existing) || !arrayTables.has(existing)))
        return null;
      const values: TomlMetadataValue[] =
        existing === undefined ? [] : (existing as TomlMetadataValue[]);
      const element = makeTable();
      states.get(element)!.explicit = true;
      values.push(element);
      arrayTables.add(values);
      table.set(key, values);
      return element;
    }
    if (existing !== undefined && !(existing instanceof Map)) return null;
    const target = existing === undefined ? makeTable() : existing;
    const state = states.get(target)!;
    if (state.explicit || state.dotted || state.sealed) return null;
    state.explicit = true;
    table.set(key, target);
    return target;
  };
  const fail = () => ({ root, declarations, occurrences, complete: false });
  let index = 0;
  while (index < content.length) {
    index = trivia(index);
    if (index < 0) return fail();
    if (index === content.length) break;
    inlineOccurrences = [];
    const offset = index;
    let end: number;
    let declaration: TomlDeclaration;
    if (content[index] === "[") {
      const array = content[index + 1] === "[";
      const key = readKey(index + (array ? 2 : 1));
      if (!key || !content.startsWith(array ? "]]" : "]", key.end)) return fail();
      end = key.end + (array ? 2 : 1);
      const target = openTable(key.path, array);
      if (!target) return fail();
      current = target;
      currentPath = key.path;
      declaration = { kind: "table", path: key.path, offset, end, array };
    } else {
      const key = readKey(index);
      if (!key || content[key.end] !== "=") return fail();
      const path = [...currentPath, ...key.path];
      const value = readValue(key.end + 1, path);
      if (!value || !assign(current, key.path, value.value)) return fail();
      end = value.end;
      declaration = {
        kind: "assignment",
        path,
        offset,
        end,
      };
    }
    // Never recover by scanning later lines after malformed trailing content.
    const tail = comment(horizontal(end));
    if (tail < 0 || (tail < content.length && newline(tail) === tail)) return fail();
    declarations.push(declaration);
    // Nested members finish before their parents, so completion/insertion order
    // is not source order. Publish them only after the outer declaration closes.
    occurrences.push(declaration);
    for (const occurrence of inlineOccurrences.sort((left, right) => left.offset - right.offset))
      occurrences.push(occurrence);
    index = tail;
  }
  return { root, declarations, occurrences, complete: true };
}
