/**
 * Root requirements metadata only: join before the caller strips comments.
 * Match pip's continuation/comment handling without include traversal or
 * environment expansion. Keep leading backslashes so unsupported path-like
 * prefixes cannot become admitted package names through normalization.
 * https://github.com/pypa/pip/blob/main/src/pip/_internal/req/req_file.py
 */
export function* rootRequirementLogicalLines(content: string): Generator<string> {
  let pending: string[] = [];
  for (const physical of content.split(/\r\n?|\n/)) {
    const comment = /^\s*#/.test(physical);
    if (!comment && physical.endsWith("\\")) {
      // pip joins even terminal slash runs. Preserve the leading path prefix;
      // the existing root extractor still rejects it rather than inventing a name.
      pending.push(physical.replace(/\\+$/, ""));
      continue;
    }
    // A comment immediately following a continuation must still be recognized
    // after joining, even when the preceding fragment ends without whitespace.
    const part = comment ? " " + physical : physical;
    if (pending.length) {
      pending.push(part);
      yield pending.join("");
      pending = [];
    } else yield part;
  }
  // pip accepts a trailing continuation at EOF; no line is fetched or expanded.
  if (pending.length) yield pending.join("");
}
