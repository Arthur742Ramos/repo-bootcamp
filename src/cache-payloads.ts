/** Validate persisted deterministic results at the analyzer reuse boundary. */
import { z } from "zod";
import type { AnalysisPhase } from "./cache.js";
import type { DependencyAnalysis } from "./deps.js";
import type { SecurityAnalysis } from "./security.js";
import type { ChangeImpact } from "./types.js";
import type { CyclesSummary } from "./cycles.js";

const strings = z.array(z.string());
const dependency = z.object({
  name: z.string(),
  version: z.string(),
  type: z.enum(["runtime", "dev", "peer", "optional"]),
  description: z.string().optional(),
  ecosystem: z.enum(["node", "rust", "python", "go"]).optional(),
  sourceFile: z.string().optional(),
});
const deps: z.ZodType<DependencyAnalysis | null> = z
  .object({
    packageManager: z.string(),
    packageManagers: strings.optional(),
    totalCount: z.number().int().nonnegative(),
    runtime: z.array(dependency),
    dev: z.array(dependency),
    peer: z.array(dependency),
    categories: z.array(z.object({ name: z.string(), deps: strings })),
  })
  .refine(
    (value) => value.totalCount === value.runtime.length + value.dev.length + value.peer.length
  )
  .nullable();
const security: z.ZodType<SecurityAnalysis> = z.object({
  score: z.number().min(0).max(100),
  authPatterns: z.array(
    z.object({
      type: z.string(),
      library: z.string().optional(),
      files: strings,
      description: z.string(),
    })
  ),
  securityDeps: z.array(
    z.object({
      name: z.string(),
      purpose: z.string(),
      type: z.enum(["auth", "crypto", "validation", "security-header", "rate-limit", "other"]),
    })
  ),
  findings: z.array(
    z.object({
      category: z.string(),
      title: z.string(),
      description: z.string(),
      severity: z.enum(["critical", "high", "medium", "low", "info"]),
      file: z.string().optional(),
      line: z.number().int().nonnegative().optional(),
      recommendation: z.string().optional(),
    })
  ),
  secretsHandling: z.object({
    envFiles: strings,
    configFiles: strings,
    gitignoreSecrets: z.boolean(),
    hasEnvExample: z.boolean(),
  }),
  headers: z.object({ hasHelmet: z.boolean(), hasCors: z.boolean(), hasCSP: z.boolean() }),
  hasRateLimiting: z.boolean(),
  hasInputValidation: z.boolean(),
  hasSqlInjectionPrevention: z.boolean(),
  sourceFilesScanned: z.number().int().nonnegative().optional(),
});
const impact: z.ZodType<ChangeImpact[]> = z.array(
  z.object({
    file: z.string(),
    affectedFiles: strings,
    affectedTests: strings,
    affectedDocs: strings,
    importedBy: strings,
    imports: strings,
  })
);
const cycles: z.ZodType<CyclesSummary> = z
  .object({
    moduleCount: z.number().int().nonnegative(),
    cycles: z.array(
      z
        .object({ size: z.number().int().positive(), files: strings })
        .refine((cycle) => cycle.size === cycle.files.length)
    ),
    rings: strings,
  })
  .refine((value) => value.rings.length === value.cycles.length);

const schemas = { deps, security, impact, cycles };
export function isValidAnalysisCacheValue(phase: AnalysisPhase, value: unknown): boolean {
  return schemas[phase].safeParse(value).success;
}
