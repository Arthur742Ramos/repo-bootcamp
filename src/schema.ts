/**
 * Zod Schema for RepoFacts validation
 * Validates the JSON output from the LLM and provides detailed error messages
 */

import { z } from "zod";

// Stack info schema
const StackInfoSchema = z.object({
  languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  buildSystem: z.string().default(""),
  packageManager: z.string().nullable().default(null),
  hasDocker: z.boolean().default(false),
  hasCi: z.boolean().default(false),
});

// Command schema
const CommandSchema = z.object({
  name: z.string(),
  command: z.string(),
  source: z.string(),
  description: z.string().optional(),
});

// Common error schema
const CommonErrorSchema = z.object({
  error: z.string(),
  fix: z.string(),
});

// Quickstart schema
const QuickstartSchema = z.object({
  prerequisites: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
  commands: z.array(CommandSchema).default([]),
  commonErrors: z.array(CommonErrorSchema).optional(),
  sources: z.array(z.string()).optional(),
});

// Directory info schema
const DirectoryInfoSchema = z.object({
  path: z.string(),
  purpose: z.string(),
  keyFiles: z.array(z.string()).optional(),
});

// Entrypoint schema
const EntrypointSchema = z.object({
  path: z.string(),
  type: z.enum(["main", "binary", "server", "cli", "web", "library"]),
  description: z.string().optional(),
});

// Structure schema
const StructureSchema = z.object({
  keyDirs: z.array(DirectoryInfoSchema).default([]),
  entrypoints: z.array(EntrypointSchema).default([]),
  testDirs: z.array(z.string()).default([]),
  docsDirs: z.array(z.string()).default([]),
  sources: z.array(z.string()).optional(),
});

// CI workflow schema
const CIWorkflowSchema = z.object({
  name: z.string(),
  file: z.string(),
  triggers: z.array(z.string()).default([]),
  mainSteps: z.array(z.string()).default([]),
});

// CI schema
const CISchema = z.object({
  workflows: z.array(CIWorkflowSchema).default([]),
  mainChecks: z.array(z.string()).default([]),
  sources: z.array(z.string()).optional(),
});

// Contributing schema
const ContribSchema = z.object({
  howToAddFeature: z.array(z.string()).default([]),
  howToAddTest: z.array(z.string()).default([]),
  codeStyle: z.string().optional(),
  sources: z.array(z.string()).optional(),
});

// Component schema
const ComponentSchema = z.object({
  name: z.string(),
  description: z.string(),
  directory: z.string(),
});

// Key abstraction schema
const KeyAbstractionSchema = z.object({
  name: z.string(),
  description: z.string(),
});

// Code example schema
const CodeExampleSchema = z.object({
  title: z.string(),
  file: z.string(),
  code: z.string(),
  explanation: z.string(),
});

// Architecture schema
const ArchitectureSchema = z.object({
  overview: z.string().default(""),
  components: z.array(ComponentSchema).default([]),
  dataFlow: z.string().optional(),
  keyAbstractions: z.array(KeyAbstractionSchema).optional(),
  codeExamples: z.array(CodeExampleSchema).optional(),
  sources: z.array(z.string()).optional(),
});

// First task schema
const FirstTaskSchema = z.object({
  title: z.string(),
  description: z.string(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  category: z.enum(["bug-fix", "test", "docs", "refactor", "feature"]),
  files: z.array(z.string()).default([]),
  why: z.string(),
});

// Incident schema
const IncidentSchema = z.object({
  name: z.string(),
  check: z.string(),
});

// Runbook schema
const RunbookSchema = z.object({
  applicable: z.boolean().optional(),
  deploySteps: z.array(z.string()).optional(),
  observability: z.array(z.string()).optional(),
  incidents: z.array(IncidentSchema).optional(),
  sources: z.array(z.string()).optional(),
});

/** Zod schema for runtime validation of LLM-generated RepoFacts */
export const RepoFactsSchema = z.object({
  repoName: z.string(),
  purpose: z.string(),
  description: z.string(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  sources: z.array(z.string()).optional(),
  stack: StackInfoSchema,
  quickstart: QuickstartSchema,
  structure: StructureSchema,
  ci: CISchema,
  contrib: ContribSchema,
  architecture: ArchitectureSchema,
  firstTasks: z.array(FirstTaskSchema).default([]),
  runbook: RunbookSchema.optional(),
});

/** Inferred TypeScript type from the Zod schema */
export type ValidatedRepoFacts = z.infer<typeof RepoFactsSchema>;

/**
 * Validation result
 */
export interface ValidationResult {
  success: boolean;
  data?: ValidatedRepoFacts;
  errors?: string[];
  warnings?: string[];
}

/**
 * Validate parsed JSON against the schema
 */
export function validateRepoFacts(data: unknown): ValidationResult {
  const result = RepoFactsSchema.safeParse(data);

  if (result.success) {
    const warnings: string[] = [];

    // Check for quality issues (warnings, not errors)
    if (result.data.firstTasks.length < 5) {
      warnings.push(`Only ${result.data.firstTasks.length} first tasks (recommend 8-10)`);
    }
    if (result.data.structure.keyDirs.length < 2) {
      warnings.push("Few key directories documented");
    }
    if (result.data.architecture.components.length < 2) {
      warnings.push("Few architecture components documented");
    }
    if (!result.data.quickstart.commands.length) {
      warnings.push("No commands documented");
    }

    return {
      success: true,
      data: result.data,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  // Format errors nicely
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return `${path}: ${issue.message}`;
  });

  return {
    success: false,
    errors,
  };
}

/**
 * Get a summary of what's missing for retry prompts
 */
export function getMissingFieldsSummary(errors: string[]): string {
  const missingFields = errors
    .filter((e) => e.includes("Required"))
    .map((e) => e.split(":")[0]);

  if (missingFields.length > 0) {
    return `Missing required fields: ${missingFields.join(", ")}`;
  }

  return errors.slice(0, 3).join("; ");
}
