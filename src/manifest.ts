import type { BootcampOptions, RepoFacts, RepoInfo, ScanResult } from "./types.js";

export interface AnalysisManifest {
  schemaVersion: 1;
  generatedAt: string;
  durationMs: number;
  repository: {
    fullName: string;
    url: string;
    branch: string;
    commitSha: string | null;
  };
  options: {
    focus: BootcampOptions["focus"];
    audience: BootcampOptions["audience"];
    format: string;
    maxFiles: number;
    style: string;
  };
  scan: {
    filesScanned: number;
    keyFilesRead: number;
    languages: string[];
    frameworks: string[];
    packageManager: string | null;
  };
  analysis: {
    model: string;
    toolCalls: number;
    confidence: string;
    evidenceSources: string[];
    evidence: Array<{
      path: string;
      lineStart: number;
      lineEnd: number | null;
      kind: "repository-file";
    }>;
  };
}

function collectFactSources(facts: RepoFacts): string[] {
  const sources = new Set<string>();
  const add = (values: string[] | undefined): void => {
    for (const value of values ?? []) {
      if (value.trim()) sources.add(value.trim());
    }
  };

  add(facts.sources);
  add(facts.quickstart?.sources);
  add(facts.structure?.sources);
  add(facts.ci?.sources);
  add(facts.contrib?.sources);
  add(facts.architecture?.sources);
  add(facts.runbook?.sources);
  for (const task of facts.firstTasks ?? []) add(task.files);
  return [...sources].sort();
}

export function createAnalysisManifest(params: {
  repoInfo: RepoInfo;
  scanResult: ScanResult;
  facts: RepoFacts;
  options: BootcampOptions;
  format: string;
  durationMs: number;
  model: string;
  toolCalls: number;
}): AnalysisManifest {
  const { repoInfo, scanResult, facts, options } = params;
  const evidenceSources = collectFactSources(facts);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    durationMs: params.durationMs,
    repository: {
      fullName: repoInfo.fullName,
      url: repoInfo.url,
      branch: repoInfo.branch,
      commitSha: repoInfo.commitSha ?? null,
    },
    options: {
      focus: options.focus,
      audience: options.audience,
      format: params.format,
      maxFiles: options.maxFiles,
      style: options.style ?? "oss",
    },
    scan: {
      filesScanned: scanResult.files.length,
      keyFilesRead: scanResult.keySourceFiles.size,
      languages: scanResult.stack.languages,
      frameworks: scanResult.stack.frameworks,
      packageManager: scanResult.stack.packageManager,
    },
    analysis: {
      model: params.model,
      toolCalls: params.toolCalls,
      confidence: facts.confidence ?? "unknown",
      evidenceSources,
      evidence: evidenceSources.map((path) => {
        const content = scanResult.keySourceFiles.get(path);
        return {
          path,
          lineStart: 1,
          lineEnd: content === undefined ? null : content.split(/\r?\n/).length,
          kind: "repository-file" as const,
        };
      }),
    },
  };
}
