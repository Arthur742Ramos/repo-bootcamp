// Match pip's lexical archive types without inspecting or opening any origin.
// https://github.com/pypa/pip/blob/main/src/pip/_internal/utils/filetypes.py
const archiveExtensions = [
  ".zip",
  ".whl",
  ".tar.bz2",
  ".tbz",
  ".tar.gz",
  ".tgz",
  ".tar",
  ".tar.xz",
  ".txz",
  ".tlz",
  ".tar.lz",
  ".tar.lzma",
];

/** Reject obvious unnamed root local references without inventing a dependency name. */
export function isRootLocalRequirementReference(line: string): boolean {
  if (/^(?:[A-Za-z]:|file:)/i.test(line)) return true;
  // Preserve the existing projection of declared comparison/parenthesized
  // suffixes and named references. Their values remain literal metadata.
  if (/^[A-Za-z0-9._-]+(?:[ \t]*\[[^\]]*\])?\s*(?:[=<>!~@]|\()/.test(line)) return false;
  if (/[/\\]/.test(line)) return true;
  // pip permits extras on a local reference. A bare same-named directory is
  // ambiguous with a real package, so never consult its existence to decide.
  // This is the same nonempty final bracket-group stripping as before, but
  // do not rescan every unmatched '[' on a hostile long metadata line.
  let filename = line;
  if (line.endsWith("]")) {
    const previousClose = line.lastIndexOf("]", line.length - 2);
    const open = line.indexOf("[", previousClose + 1);
    if (open >= 0 && open < line.length - 2) filename = line.slice(0, open);
  }
  filename = filename.trimEnd().toLowerCase();
  return archiveExtensions.some((extension) => filename.endsWith(extension));
}
