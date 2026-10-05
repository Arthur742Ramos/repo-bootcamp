import type {
  scanTomlMetadata,
  TomlMetadataTable,
  TomlMetadataValue,
} from "./toml-metadata-scan.js";

// Documented lint/format/type/test configuration namespaces, not package or
// build managers. Unknown tools retain the existing pyproject precedence.
const nonOwningTools = new Set(["ruff", "black", "pytest", "mypy", "coverage"]);

function admissibleAtom(raw: string): boolean {
  const date = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))?)?$/
  );
  const time = raw.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  const validTime = (hour: string, minute: string, second: string): boolean =>
    Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60;
  if (date) {
    const year = Number(date[1]);
    const month = Number(date[2]);
    const day = Number(date[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return (
      year > 0 &&
      month > 0 &&
      month <= 12 &&
      day > 0 &&
      day <= days[month - 1] &&
      (!date[4] || validTime(date[4], date[5], date[6])) &&
      (!date[7] || (Number(date[7]) < 24 && Number(date[8]) < 60))
    );
  }
  if (time) return validTime(time[1], time[2], time[3]);

  // The structural cursor already validates atom spelling. Do not construct a
  // potentially enormous BigInt: admit a conservative standard signed range.
  const normalized = raw.replace(/_/g, "");
  for (const [prefix, length] of [
    ["0x", 16],
    ["0o", 21],
    ["0b", 63],
  ] as const) {
    if (normalized.startsWith(prefix)) {
      const digits = normalized.slice(2).replace(/^0+/, "") || "0";
      return digits.length < length || (digits.length === length && digits[0] <= "7");
    }
  }
  if (/^[+-]?\d+$/.test(normalized)) {
    const negative = normalized.startsWith("-");
    const digits = normalized.replace(/^[+-]/, "");
    const limit = negative ? "9223372036854775808" : "9223372036854775807";
    return digits.length < limit.length || (digits.length === limit.length && digits <= limit);
  }
  // Float, infinity and NaN spelling was checked by the cursor; no value is
  // resolved, normalized or used as dependency metadata here.
  return true;
}

function admissibleValue(value: TomlMetadataValue): boolean {
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(admissibleValue);
  if (value instanceof Map) return [...value.values()].every(admissibleValue);
  return admissibleAtom(value.raw);
}

/** Conservative non-owning tooling metadata, never a zero-dependency fallback. */
export function isToolingOnlyPyproject(metadata: ReturnType<typeof scanTomlMetadata>): boolean {
  if (!metadata.complete || metadata.root.size !== 1) return false;
  const tool = metadata.root.get("tool");
  if (!(tool instanceof Map)) return false;
  for (const [name, configuration] of tool) {
    if (!nonOwningTools.has(name) || !(configuration instanceof Map)) return false;
  }
  return admissibleValue(tool as TomlMetadataTable);
}
