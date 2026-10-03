import type { RepoInfo } from "./types.js";

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
  const cleanPath = filePath.replace(/^\.?\/+/, "");
  const prefix = (repoInfo.sourcePathPrefix || "").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!cleanPath || prefix.startsWith("/")) return null;
  const segments = [prefix, cleanPath].filter(Boolean).join("/").split("/");
  // A model-provided path must not navigate out of the selected package.
  if (segments.includes("..")) return null;
  // encodeURIComponent leaves parentheses unescaped, which can terminate
  // Markdown destinations. Encode those along with other reserved symbols.
  const encodeSegment = (segment: string): string =>
    encodeURIComponent(segment).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
  const encoded = segments.map(encodeSegment).join("/");
  const base = `https://${repoInfo.host}/${repoInfo.owner}/${repoInfo.repo}`;
  // Tag checkouts report detached HEAD; link the concrete analyzed content.
  const sourceRef =
    repoInfo.branch === "HEAD" && repoInfo.commitSha ? repoInfo.commitSha : repoInfo.branch;
  // A detected default ref can contain URL/Markdown delimiters even though
  // explicit clone refs are deliberately restricted. Preserve slash-separated
  // refs, but prevent a literal '#' or ')' from swallowing the source path.
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
