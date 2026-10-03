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
  const encoded = segments
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join("/");
  const base = `https://${repoInfo.host}/${repoInfo.owner}/${repoInfo.repo}`;
  switch (repoInfo.provider) {
    case "gitlab":
      return `${base}/-/blob/${repoInfo.branch}/${encoded}`;
    case "bitbucket":
      return `${base}/src/${repoInfo.branch}/${encoded}`;
    default:
      return `${base}/blob/${repoInfo.branch}/${encoded}`;
  }
}
