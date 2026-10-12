import { createHash } from "node:crypto";
import type { CacheGenerationOptions, CachePhase } from "../../src/cache.js";

/** Build synthetic projection filenames from each phase's own saved identity. */
export function projectedCacheFilename(
  entry: { repoFullName: string; commitSha: string; generationOptions: CacheGenerationOptions },
  phase: CachePhase,
  projection = {
    facts: "|projection=facts-v2-effective-analysis-inputs",
    deps: "|projection=mixed-ecosystems-v12-contained-metadata",
    security: "|projection=security-v1-contained-metadata",
    impact: "",
    cycles: "",
  }[phase]
): string {
  const options = entry.generationOptions;
  const fields: unknown[] = [
    options.focus || "",
    options.style || "",
    options.model || "",
    options.audience || "",
    options.maxFiles ?? null,
    options.subdir || "",
    [...new Set(options.exclude ?? [])].sort(),
    options.scanFingerprint || "",
  ];
  if (phase === "facts" && options.analysisFingerprint) fields.push(options.analysisFingerprint);
  const identity = JSON.stringify(fields);
  const base =
    `${entry.repoFullName}@${entry.commitSha}` +
    (identity === JSON.stringify(["", "", "", "", null, "", [], ""]) ? "" : `|${identity}`);
  const hash = createHash("sha256")
    .update(base + (phase === "facts" ? "" : `|phase=${phase}`) + projection)
    .digest("hex")
    .slice(0, 16);
  return `${entry.repoFullName.replaceAll("/", "-")}${phase === "facts" ? "" : `-${phase}`}-${hash}.json`;
}
