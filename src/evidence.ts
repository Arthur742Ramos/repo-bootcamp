import type { EvidenceCitation, RepoFacts, RepoInfo, ScanResult } from "./types.js";
import { buildBlobUrl } from "./source-links.js";

export type CitationVerification =
  | { status: "matched"; path: string; lineStart: number; lineEnd: number }
  | { status: "unverified"; reason: string };

export interface GuidanceEvidence {
  commands: CitationVerification[];
  firstTasks: CitationVerification[];
}

/**
 * Match only text already loaded within the selected scan. A match locates an
 * excerpt; it does not establish that the associated recommendation is true.
 */
export function verifyCitation(
  citation: EvidenceCitation | undefined,
  scan: Pick<ScanResult, "files" | "keySourceFiles"> | undefined
): CitationVerification {
  if (
    !citation ||
    typeof citation.path !== "string" ||
    !citation.path.trim() ||
    typeof citation.quote !== "string" ||
    !citation.quote.trim()
  ) {
    return { status: "unverified", reason: "No source excerpt supplied." };
  }
  if (!scan || !scan.files.some((file) => !file.isDirectory && file.path === citation.path)) {
    return { status: "unverified", reason: "Source is outside the selected scan." };
  }
  const content = scan.keySourceFiles.get(citation.path);
  if (content === undefined) {
    return { status: "unverified", reason: "Source was not loaded for this scan." };
  }
  const normalized = content.replace(/\r\n/g, "\n");
  const quote = citation.quote.replace(/\r\n/g, "\n");
  const offset = normalized.indexOf(quote);
  if (offset === -1)
    return { status: "unverified", reason: "Excerpt was not found in loaded source." };
  const lineStart = normalized.slice(0, offset).split("\n").length;
  const lineEnd = lineStart + quote.split("\n").length - (quote.endsWith("\n") ? 2 : 1);
  return { status: "matched", path: citation.path, lineStart, lineEnd };
}

export function collectGuidanceEvidence(facts: RepoFacts, scan: ScanResult): GuidanceEvidence {
  return {
    commands: facts.quickstart.commands.map((command) => verifyCitation(command.evidence, scan)),
    firstTasks: facts.firstTasks.map((task) => verifyCitation(task.evidence, scan)),
  };
}

/** Source links are emitted only for verified, scanned paths. */
export function evidenceUrl(
  evidence: CitationVerification,
  repoInfo: RepoInfo | undefined
): string | null {
  if (evidence.status !== "matched") return null;
  const pinnedRepo =
    repoInfo?.commitSha && repoInfo.branch !== "local"
      ? { ...repoInfo, branch: repoInfo.commitSha }
      : repoInfo;
  const base = buildBlobUrl(pinnedRepo, evidence.path);
  if (!base) return null;
  const { lineStart, lineEnd } = evidence;
  if (repoInfo?.provider === "gitlab") {
    return `${base}#L${lineStart}${lineEnd === lineStart ? "" : `-${lineEnd}`}`;
  }
  if (repoInfo?.provider === "bitbucket") {
    return `${base}#lines-${lineStart}${lineEnd === lineStart ? "" : `:${lineEnd}`}`;
  }
  return `${base}#L${lineStart}${lineEnd === lineStart ? "" : `-L${lineEnd}`}`;
}
