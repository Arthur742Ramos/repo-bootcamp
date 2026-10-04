import type { RepoInfo } from "./types.js";

/** UTF-16 source strings must contain only scalar values or paired surrogates. */
export function isWellFormedSourceText(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** Keep source names as data, including delimiter and malformed-model controls. */
export function sourcePathCode(value: string, table = false): string {
  // JSON notation makes malformed scalars/control characters visible without
  // inventing a replacement filename or allowing a path to split a document.
  let notation = !isWellFormedSourceText(value);
  for (let index = 0; !notation && index < value.length; index++) {
    const code = value.charCodeAt(index);
    notation = code < 32 || code === 127;
  }
  const raw = notation
    ? JSON.stringify(value).split(String.fromCharCode(127)).join("\\u007f")
    : value;
  const literal = table ? raw.replace(/\|/g, "\\|") : raw;
  const runs = literal.match(/`+/g) ?? [];
  const fence = "`".repeat(runs.reduce((longest, run) => Math.max(longest, run.length), 0) + 1);
  const padding =
    literal.startsWith("`") ||
    literal.endsWith("`") ||
    (literal.startsWith(" ") && literal.endsWith(" ") && /[^ ]/.test(literal))
      ? " "
      : "";
  return fence + padding + literal + padding + fence;
}

// Reserved delimiters can terminate Markdown destinations even when URI-safe.
const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );

/** Existing local source targets, contained and encoded rather than fabricated. */
export function buildRelativeSourceUrl(filePath: string): string | null {
  if (!filePath || !isWellFormedSourceText(filePath) || filePath.split("/").includes(".."))
    return null;
  return "./" + filePath.split("/").map(encodeSegment).join("/");
}

/** Build a provider-aware source URL, preserving selected-directory context. */
export function buildBlobUrl(repoInfo: RepoInfo | undefined, filePath: string): string | null {
  if (
    !repoInfo?.host ||
    !repoInfo.owner ||
    repoInfo.owner === "local" ||
    !repoInfo.branch ||
    repoInfo.branch === "local"
  )
    return null;
  if (!isWellFormedSourceText(filePath)) return null;
  const cleanPath = filePath.replace(/^\.?\/+/, "");
  const prefix = (repoInfo.sourcePathPrefix || "").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!cleanPath || prefix.startsWith("/") || !isWellFormedSourceText(prefix)) return null;
  const segments = [prefix, cleanPath].filter(Boolean).join("/").split("/");
  // A model-provided path must not navigate out of the selected package.
  if (segments.includes("..")) return null;
  const encoded = segments.map(encodeSegment).join("/");
  const base = `https://${repoInfo.host}/${repoInfo.owner}/${repoInfo.repo}`;
  // Tag checkouts report detached HEAD; link the concrete analyzed content.
  const sourceRef =
    repoInfo.branch === "HEAD" && repoInfo.commitSha ? repoInfo.commitSha : repoInfo.branch;
  // A detected default ref can contain URL/Markdown delimiters even though
  // explicit clone refs are deliberately restricted. Preserve slash-separated
  // refs, but prevent a literal '#' or ')' from swallowing the source path.
  if (
    !isWellFormedSourceText(sourceRef) ||
    ![repoInfo.host, repoInfo.owner, repoInfo.repo].every(isWellFormedSourceText)
  )
    return null;
  const ref = sourceRef.split("/").map(encodeSegment).join("/");
  switch (repoInfo.provider) {
    case "gitlab":
      return `${base}/-/blob/${ref}/${encoded}`;
    case "bitbucket":
      return `${base}/src/${ref}/${encoded}`;
    default:
      return `${base}/blob/${ref}/${encoded}`;
  }
}
