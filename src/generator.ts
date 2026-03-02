/**
 * Document Generator
 * Generates markdown documentation from repo_facts.json
 */

import type { RepoFacts, BootcampOptions } from "./types.js";
import { getStyleConfig, type StyleConfig } from "./plugins.js";

/** Maximum items shown in summary sections of BOOTCAMP.md */
const MAX_BOOTCAMP_SUMMARY_ITEMS = 5;
/** Maximum beginner tasks shown in the quick-start section */
const MAX_QUICK_TASKS = 3;
/** Maximum audience-specific files shown in focused sections */
const MAX_AUDIENCE_FILES = 6;
/** Maximum highlighted tasks shown in audience guidance sections */
const MAX_AUDIENCE_TASKS = 3;

type Audience = BootcampOptions["audience"];
type RepoTask = RepoFacts["firstTasks"][number];

const AUDIENCE_PROFILES: Record<
  Audience,
  {
    label: string;
    onboardingTitle: string;
    onboardingDescription: string;
    architectureTitle: string;
    architectureDescription: string;
    firstTaskTitle: string;
    firstTaskDescription: string;
    architectureChecklist: string[];
    categoryOrder: RepoTask["category"][];
    filePatterns: RegExp[];
  }
> = {
  all: {
    label: "all engineers",
    onboardingTitle: "Start Here",
    onboardingDescription: "General onboarding — explore the codebase at your own pace.",
    architectureTitle: "Architecture Focus",
    architectureDescription: "Use this view to understand the overall system design.",
    firstTaskTitle: "Recommended first tasks",
    firstTaskDescription: "Starter tasks across different areas of the codebase.",
    architectureChecklist: [
      "Trace one key flow from entry point to output.",
      "Identify the main abstractions and their relationships.",
      "Run the test suite and understand how tests are structured.",
    ],
    categoryOrder: ["bug-fix", "test", "feature", "docs", "refactor"],
    filePatterns: [/.*/],
  },
  backend: {
    label: "backend engineers",
    onboardingTitle: "Backend Start Here",
    onboardingDescription: "Focus first on request handling, service logic, and persistence boundaries.",
    architectureTitle: "Backend Architecture Focus",
    architectureDescription: "Use this view to understand server-side execution paths and data movement.",
    firstTaskTitle: "Backend-first task picks",
    firstTaskDescription: "Prioritized tasks with server-side impact and API/data ownership.",
    architectureChecklist: [
      "Trace one request from entrypoint to business logic and data access.",
      "Map validation/auth boundaries before adding or changing endpoints.",
      "Confirm backend tests covering the touched flow.",
    ],
    categoryOrder: ["feature", "bug-fix", "test", "refactor", "docs"],
    filePatterns: [
      /(api|server|backend|service|controller|handler|route|middleware|db|database|sql|schema|model|repository|worker|queue)/i,
      /\.(go|py|java|rb|php|cs|rs)$/i,
    ],
  },
  frontend: {
    label: "frontend engineers",
    onboardingTitle: "Frontend Start Here",
    onboardingDescription: "Focus first on UI flows, state updates, and client-side rendering boundaries.",
    architectureTitle: "Frontend Architecture Focus",
    architectureDescription: "Use this view to understand component composition and client data flow.",
    firstTaskTitle: "Frontend-first task picks",
    firstTaskDescription: "Prioritized tasks that improve UI behavior, quality, and UX confidence.",
    architectureChecklist: [
      "Trace one user flow from route entry to rendered component state.",
      "Identify state ownership and data-fetch boundaries before changes.",
      "Run UI-focused tests for components and interaction paths.",
    ],
    categoryOrder: ["feature", "test", "bug-fix", "refactor", "docs"],
    filePatterns: [
      /(frontend|client|ui|web|component|components|view|views|page|pages|layout|style|styles|css|sass|scss|tailwind|hook|hooks|state|redux|store|router)/i,
      /\.(tsx|jsx|css|scss|sass|html)$/i,
    ],
  },
  sre: {
    label: "sre engineers",
    onboardingTitle: "SRE Start Here",
    onboardingDescription: "Focus first on deploy paths, observability, and operational safety controls.",
    architectureTitle: "Operations & Reliability Focus",
    architectureDescription: "Use this view to understand runtime behavior, release flow, and failure handling.",
    firstTaskTitle: "SRE-first task picks",
    firstTaskDescription: "Prioritized tasks that improve reliability, visibility, and incident readiness.",
    architectureChecklist: [
      "Follow the release path from CI checks to deployment targets.",
      "Confirm metrics/logging/alerting coverage for critical flows.",
      "Review runbook and incident checks before production changes.",
    ],
    categoryOrder: ["docs", "feature", "bug-fix", "refactor", "test"],
    filePatterns: [
      /(deploy|deployment|infra|infrastructure|k8s|kubernetes|helm|terraform|ansible|docker|compose|ops|runbook|incident|monitor|metrics|prometheus|grafana|alert|slo|workflow|ci|cd)/i,
      /^\.github\/workflows\//i,
      /(dockerfile|compose|kustomization|chart)/i,
    ],
  },
};

function getAudienceProfile(audience?: Audience) {
  return AUDIENCE_PROFILES[audience || "backend"];
}

function scorePathForAudience(path: string, audience?: Audience): number {
  const profile = getAudienceProfile(audience);
  const target = path.toLowerCase();
  return profile.filePatterns.reduce((score, pattern) => score + (pattern.test(target) ? 2 : 0), 0);
}

function getAudienceFiles(facts: RepoFacts, audience?: Audience, limit = MAX_AUDIENCE_FILES): string[] {
  const candidates = new Set<string>();

  for (const entrypoint of facts.structure.entrypoints) {
    candidates.add(entrypoint.path);
  }
  for (const dir of facts.structure.keyDirs) {
    candidates.add(dir.path);
    for (const file of dir.keyFiles || []) {
      candidates.add(file);
    }
  }
  for (const workflow of facts.ci.workflows) {
    candidates.add(workflow.file);
  }
  for (const dir of facts.structure.docsDirs) {
    candidates.add(dir);
  }
  for (const source of facts.architecture.sources || []) {
    candidates.add(source);
  }
  for (const source of facts.runbook?.sources || []) {
    candidates.add(source);
  }

  const ranked = [...candidates]
    .filter(Boolean)
    .map((item) => ({ item, score: scorePathForAudience(item, audience) }))
    .sort((a, b) => b.score - a.score || a.item.localeCompare(b.item))
    .map((entry) => entry.item);

  return ranked.slice(0, limit);
}

function scoreTaskForAudience(task: RepoTask, audience?: Audience): number {
  const profile = getAudienceProfile(audience);
  const categoryBoost = profile.categoryOrder.length - profile.categoryOrder.indexOf(task.category);
  const fileBoost = task.files.reduce((sum, file) => sum + scorePathForAudience(file, audience), 0);
  return categoryBoost + fileBoost;
}

function getAudienceTasks(facts: RepoFacts, audience?: Audience): RepoTask[] {
  return [...facts.firstTasks].sort((a, b) => scoreTaskForAudience(b, audience) - scoreTaskForAudience(a, audience));
}

function resolveStyleConfig(
  options?: Pick<BootcampOptions, "style">,
  styleConfig?: StyleConfig
): StyleConfig {
  return styleConfig || getStyleConfig(options?.style);
}

function getSectionDepthLimits(sectionDepth: StyleConfig["sectionDepth"]): {
  summaryItems: number;
  quickTasks: number;
} {
  const limits: Record<StyleConfig["sectionDepth"], { summaryItems: number; quickTasks: number }> = {
    minimal: { summaryItems: 3, quickTasks: 2 },
    standard: { summaryItems: MAX_BOOTCAMP_SUMMARY_ITEMS, quickTasks: MAX_QUICK_TASKS },
    deep: { summaryItems: 8, quickTasks: 5 },
  };
  return limits[sectionDepth];
}

function tonePrefix(styleConfig: StyleConfig): string {
  const prefix = styleConfig.emoji ? "✨ " : "";
  const toneLine: Record<StyleConfig["tone"], string> = {
    formal: "Structured guidance for predictable execution.",
    casual: "Friendly guidance to help you ship quickly.",
    technical: "Technical guidance focused on precision and system understanding.",
  };
  return `${prefix}${styleConfig.introText}\n\n> ${toneLine[styleConfig.tone]}`;
}

/**
 * Format confidence as a badge
 */
function confidenceBadge(confidence?: "high" | "medium" | "low"): string {
  if (!confidence) return "";
  const badges: Record<string, string> = {
    high: "![Confidence: High](https://img.shields.io/badge/confidence-high-brightgreen)",
    medium: "![Confidence: Medium](https://img.shields.io/badge/confidence-medium-yellow)",
    low: "![Confidence: Low](https://img.shields.io/badge/confidence-low-red)",
  };
  return badges[confidence] || "";
}

/**
 * Format sources as a collapsible section
 */
function sourcesSection(sources?: string[], label = "Sources"): string {
  if (!sources || sources.length === 0) return "";
  return `
<details>
<summary>${label}</summary>

${sources.map(s => `- \`${s}\``).join("\n")}

</details>
`;
}

/**
 * Generate BOOTCAMP.md - the main 1-page overview
 */
export function generateBootcamp(
  facts: RepoFacts,
  options: BootcampOptions,
  styleConfig?: StyleConfig
): string {
  const resolvedStyle = resolveStyleConfig(options, styleConfig);
  const depthLimits = getSectionDepthLimits(resolvedStyle.sectionDepth);
  const prereqs = facts.quickstart.prerequisites.map((p) => `- ${p}`).join("\n");
  const steps = facts.quickstart.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const commands = facts.quickstart.commands
    .slice(0, depthLimits.summaryItems)
    .map((c) => `\`${c.command}\``)
    .join(", ");

  const keyDirs = facts.structure.keyDirs
    .slice(0, depthLimits.summaryItems)
    .map((d) => `- \`${d.path}\` - ${d.purpose}`)
    .join("\n");

  const quickTasks = facts.firstTasks
    .filter((t) => t.difficulty === "beginner")
    .slice(0, Math.min(depthLimits.quickTasks, resolvedStyle.firstTasksCount))
    .map((t) => `- **${t.title}**: ${t.description}`)
    .join("\n");

  const nextStepLinks = [
    "- 📖 [ONBOARDING.md](./ONBOARDING.md) - Full setup guide",
    "- 🏗️ [ARCHITECTURE.md](./ARCHITECTURE.md) - System design",
    "- 🗺️ [CODEMAP.md](./CODEMAP.md) - Directory tour",
    "- ✅ [FIRST_TASKS.md](./FIRST_TASKS.md) - Starter issues",
    resolvedStyle.sections.showRunbook ? "- 📘 [RUNBOOK.md](./RUNBOOK.md) - Operational reference" : "",
    resolvedStyle.sections.showDependencyGraph ? "- 🧩 [DEPENDENCIES.md](./DEPENDENCIES.md) - Dependency graph" : "",
    resolvedStyle.sections.showSecurityDetails ? "- 🔐 [SECURITY.md](./SECURITY.md) - Security findings" : "",
    resolvedStyle.sections.showRadar ? "- 📡 [RADAR.md](./RADAR.md) - Technology risk radar" : "",
    resolvedStyle.sections.showImpact ? "- 🎯 [IMPACT.md](./IMPACT.md) - Change impact analysis" : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `# ${facts.repoName} Bootcamp

${confidenceBadge(facts.confidence)}

> ${facts.purpose}

${facts.description}
${tonePrefix(resolvedStyle)}
${sourcesSection(facts.sources, "Based on")}

## Quick Facts

| | |
|---|---|
| **Languages** | ${facts.stack.languages.join(", ")} |
| **Frameworks** | ${facts.stack.frameworks.join(", ") || "None"} |
| **Build System** | ${facts.stack.buildSystem} |
| **Package Manager** | ${facts.stack.packageManager || "N/A"} |

## Prerequisites

${prereqs}

## Quick Start

${steps}

**Key commands:** ${commands}

## Project Structure

${keyDirs}

## If You Only Have 30 Minutes

1. Read this document
2. Run the dev server: \`${facts.quickstart.commands.find((c) => c.name.includes("dev"))?.command || facts.quickstart.commands[0]?.command || "npm run dev"}\`
3. Pick one of these starter tasks:

${quickTasks || "- _No beginner tasks suggested_"}

## Next Steps

${nextStepLinks}

---
*Generated by [Repo Bootcamp](https://github.com/repo-bootcamp)*
`;
}

/**
 * Generate ONBOARDING.md - detailed setup guide
 */
export function generateOnboarding(
  facts: RepoFacts,
  options?: Pick<BootcampOptions, "audience">
): string {
  const profile = getAudienceProfile(options?.audience);
  const prereqs = facts.quickstart.prerequisites.map((p) => `- [ ] ${p}`).join("\n");
  const commands = facts.quickstart.commands
    .map((c) => `### ${c.name}\n\`\`\`bash\n${c.command}\n\`\`\`\n${c.description ? `> ${c.description}` : ""}`)
    .join("\n\n");

  const errors = facts.quickstart.commonErrors
    ?.map((e) => `### ${e.error}\n**Fix:** ${e.fix}`)
    .join("\n\n") || "_No common errors documented_";

  const testDirs = facts.structure.testDirs.map((d) => `- \`${d}\``).join("\n");
  const testCmd = facts.quickstart.commands.find(
    (c) => c.name.includes("test") || c.command.includes("test")
  );
  const audienceFiles = getAudienceFiles(facts, options?.audience)
    .map((file) => `- \`${file}\``)
    .join("\n");
  const audienceTasks = getAudienceTasks(facts, options?.audience)
    .slice(0, MAX_AUDIENCE_TASKS)
    .map((task) => `- **${task.title}** (${task.category}) - ${task.files[0] ? `start in \`${task.files[0]}\`` : "pick the implementation file from FIRST_TASKS.md"}`)
    .join("\n");

  return `# Onboarding Guide: ${facts.repoName}

## Prerequisites Checklist

${prereqs}

## Clone & Install

\`\`\`bash
# Clone the repository
git clone https://github.com/${facts.repoName}.git
cd ${facts.repoName.split("/")[1]}

# Install dependencies
${facts.quickstart.commands.find((c) => c.name === "install")?.command || `${facts.stack.packageManager || "npm"} install`}
\`\`\`

## Available Commands

${commands}

## Development Loop

1. Start the dev server/watch mode
2. Make changes to files in \`${facts.structure.keyDirs[0]?.path || "src/"}\`
3. Changes should hot-reload (if applicable)
4. Run tests before committing

## ${profile.onboardingTitle}

${profile.onboardingDescription}

**Files to read first**
${audienceFiles || "- `_No role-specific files detected_`"}

**Suggested first tasks**
${audienceTasks || "- `_No tasks available yet_`"}

## Running Tests

${testCmd ? `\`\`\`bash\n${testCmd.command}\n\`\`\`` : "_No test command detected_"}

Test directories:
${testDirs || "_No test directories detected_"}

## Common Errors & Fixes

${errors}

## Editor Setup

${facts.contrib.codeStyle ? `This project uses: **${facts.contrib.codeStyle}**` : "Check for .editorconfig, .prettierrc, or eslint config files."}

Recommended extensions:
- ESLint / Prettier (if applicable)
- Language-specific extensions for ${facts.stack.languages.join(", ")}

## Getting Help

- Check existing issues on GitHub
- Read through the docs in \`${facts.structure.docsDirs[0] || "docs/"}\`
- Look at existing code for patterns

---
*Generated by [Repo Bootcamp](https://github.com/repo-bootcamp)*
`;
}

/**
 * Generate ARCHITECTURE.md
 */
export function generateArchitecture(
  facts: RepoFacts,
  options?: Pick<BootcampOptions, "audience">
): string {
  const profile = getAudienceProfile(options?.audience);
  const components = facts.architecture.components
    .map((c) => `### ${c.name}\n\n**Directory:** \`${c.directory}\`\n\n${c.description}`)
    .join("\n\n");

  const abstractions = facts.architecture.keyAbstractions
    ?.map((a) => `- **${a.name}**: ${a.description}`)
    .join("\n") || "_None documented_";

  // Generate code examples section
  let codeExamplesSection = "";
  if (facts.architecture.codeExamples && facts.architecture.codeExamples.length > 0) {
    const examples = facts.architecture.codeExamples
      .map((ex) => {
        // Detect language from file extension
        const ext = ex.file.split('.').pop() || '';
        const langMap: Record<string, string> = {
          ts: "typescript",
          tsx: "typescript",
          js: "javascript",
          jsx: "javascript",
          py: "python",
          go: "go",
          rs: "rust",
          java: "java",
          rb: "ruby",
          php: "php",
          cs: "csharp",
          cpp: "cpp",
          c: "c",
        };
        const lang = langMap[ext] || ext;
        
        return `### ${ex.title}

**File:** \`${ex.file}\`

\`\`\`${lang}
${ex.code}
\`\`\`

${ex.explanation}`;
      })
      .join("\n\n");
    
    codeExamplesSection = `## Code Examples

${examples}

`;
  }

  // Generate Mermaid diagram
  const mermaidDiagram = generateMermaidDiagram(facts);
  const audienceComponents = facts.architecture.components
    .filter((component) => scorePathForAudience(`${component.name} ${component.directory} ${component.description}`, options?.audience) > 0)
    .slice(0, MAX_AUDIENCE_TASKS)
    .map((component) => `- **${component.name}** (\`${component.directory}\`)`)
    .join("\n");
  const audienceFiles = getAudienceFiles(facts, options?.audience)
    .slice(0, MAX_AUDIENCE_TASKS)
    .map((file) => `- \`${file}\``)
    .join("\n");
  const audienceChecklist = profile.architectureChecklist.map((item) => `- ${item}`).join("\n");

  return `# Architecture: ${facts.repoName}

## Overview

${facts.architecture.overview}
${sourcesSection(facts.architecture.sources)}

## System Diagram

\`\`\`mermaid
${mermaidDiagram}
\`\`\`

## Components

${components}

${options?.audience && options.audience !== "all" ? `## ${profile.architectureTitle}

${profile.architectureDescription}

${audienceChecklist}

### Components to trace first
${audienceComponents || "- _No role-specific components detected_"}

### Files to inspect first
${audienceFiles || "- _No role-specific files detected_"}

` : ""}${codeExamplesSection}## Data Flow

${facts.architecture.dataFlow || "_Data flow not documented_"}

## Key Abstractions

${abstractions}

## Entrypoints

| Path | Type | Description |
|------|------|-------------|
${facts.structure.entrypoints.length > 0
  ? facts.structure.entrypoints.map((e) => `| \`${e.path}\` | ${e.type} | ${e.description || "-"} |`).join("\n")
  : "| _None detected_ | - | - |"}

## Where to Change What

| Task | Location |
|------|----------|
| Add a new feature | \`${facts.structure.keyDirs.find((d) => d.purpose.toLowerCase().includes("source") || d.purpose.toLowerCase().includes("main"))?.path || "src/"}\` |
| Add tests | \`${facts.structure.testDirs[0] || "tests/"}\` |
| Modify build | \`${facts.stack.buildSystem === "npm" ? "package.json" : "build config"}\` |
| Update CI | \`${facts.ci.workflows[0]?.file || ".github/workflows/"}\` |

---
*Generated by [Repo Bootcamp](https://github.com/repo-bootcamp)*
`;
}

/**
 * Generate a Mermaid diagram from repo facts
 */
function generateMermaidDiagram(facts: RepoFacts): string {
  const components = facts.architecture.components;

  if (components.length === 0) {
    return `graph LR
    A[Entry] --> B[Core]
    B --> C[Output]`;
  }

  const nodes = components.map((c, i) => `    ${String.fromCharCode(65 + i)}["${c.name}"]`);
  const links: string[] = [];

  // Create simple linear flow if no dataFlow specified
  for (let i = 0; i < components.length - 1; i++) {
    links.push(`    ${String.fromCharCode(65 + i)} --> ${String.fromCharCode(66 + i)}`);
  }

  return `graph LR
${nodes.join("\n")}
${links.join("\n")}`;
}

/**
 * Generate CODEMAP.md
 */
export function generateCodemap(facts: RepoFacts): string {
  const dirs = facts.structure.keyDirs
    .map((d) => {
      const files = d.keyFiles?.map((f) => `  - \`${f}\``).join("\n") || "";
      return `### \`${d.path}\`

${d.purpose}

${files ? `Key files:\n${files}` : ""}`;
    })
    .join("\n\n");

  const entrypoints = facts.structure.entrypoints
    .map((e) => `- [\`${e.path}\`](./${e.path}) - ${e.description || e.type}`)
    .join("\n");

  return `# Code Map: ${facts.repoName}

A guided tour of the codebase for new contributors.

## Start Here

${entrypoints}

These are the main entry points to understand how the code flows.

## Directory Guide

${dirs}

## Test Structure

| Directory | Purpose |
|-----------|---------|
${facts.structure.testDirs.length > 0 
  ? facts.structure.testDirs.map((d) => `| \`${d}\` | Test files |`).join("\n")
  : "| _None detected_ | - |"}

## CI/CD

| Workflow | Triggers |
|----------|----------|
${facts.ci.workflows.length > 0
  ? facts.ci.workflows.map((w) => `| \`${w.file}\` | ${w.triggers.join(", ") || "-"} |`).join("\n")
  : "| _None detected_ | - |"}

## Reading Order for New Contributors

1. Start with the README
2. Look at the main entry point: \`${facts.structure.entrypoints[0]?.path || "src/index.ts"}\`
3. Trace through one user flow
4. Read the tests to understand expected behavior
5. Check CI to understand quality gates

---
*Generated by [Repo Bootcamp](https://github.com/repo-bootcamp)*
`;
}

/**
 * Generate FIRST_TASKS.md
 */
export function generateFirstTasks(
  facts: RepoFacts,
  options?: Pick<BootcampOptions, "audience" | "style">,
  styleConfig?: StyleConfig
): string {
  const resolvedStyle = resolveStyleConfig(options, styleConfig);
  const profile = getAudienceProfile(options?.audience);
  const prioritizedTasks = getAudienceTasks(facts, options?.audience).slice(0, resolvedStyle.firstTasksCount);
  const tasksByCategory = {
    beginner: prioritizedTasks.filter((t) => t.difficulty === "beginner"),
    intermediate: prioritizedTasks.filter((t) => t.difficulty === "intermediate"),
    advanced: prioritizedTasks.filter((t) => t.difficulty === "advanced"),
  };
  const audiencePicks = prioritizedTasks
    .slice(0, Math.min(MAX_AUDIENCE_TASKS, resolvedStyle.firstTasksCount))
    .map((task) => `- **${task.title}** (${task.difficulty}, ${task.category})`)
    .join("\n");
  const hiddenTasks = Math.max(0, facts.firstTasks.length - prioritizedTasks.length);
  const styleLimitNote = hiddenTasks > 0
    ? `_Showing top ${prioritizedTasks.length} tasks for the ${resolvedStyle.name} style pack (${hiddenTasks} hidden)._`
    : "";
  const includeFullTaskDetails = resolvedStyle.sectionDepth !== "minimal";

  const formatTask = (t: (typeof facts.firstTasks)[0]) => `### ${t.title}

**Difficulty:** ${t.difficulty} | **Category:** ${t.category}

${t.description}

${includeFullTaskDetails ? `**Why this matters:** ${t.why}` : ""}

${includeFullTaskDetails
    ? `**Files to look at:**\n${t.files.map((f) => `- \`${f}\``).join("\n")}`
    : `**Start in:** ${t.files[0] ? `\`${t.files[0]}\`` : "_No file provided_"}`}
`;

  return `# First Tasks: ${facts.repoName}

Suggested starter tasks for new contributors, organized by difficulty.
${tonePrefix(resolvedStyle)}

## ${profile.firstTaskTitle}

${profile.firstTaskDescription}
${styleLimitNote}

${audiencePicks || "_No tasks suggested yet_"}

## Beginner Tasks (Safe Small Wins)

${tasksByCategory.beginner.map(formatTask).join("\n") || "_No beginner tasks suggested_"}

## Intermediate Tasks

${tasksByCategory.intermediate.map(formatTask).join("\n") || "_No intermediate tasks suggested_"}

## Advanced Tasks

${tasksByCategory.advanced.map(formatTask).join("\n") || "_No advanced tasks suggested_"}

## How to Pick a Task

1. **New to the codebase?** Start with a beginner task
2. **Want to learn the architecture?** Pick an intermediate refactor
3. **Ready for a challenge?** Try an advanced feature task

## Before You Start

1. Read [ARCHITECTURE.md](./ARCHITECTURE.md) to understand the system
2. Check if there's an existing issue for the task
3. Create a feature branch
4. Write tests for your changes
5. Submit a PR referencing this task

---
*Generated by [Repo Bootcamp](https://github.com/repo-bootcamp)*
`;
}

/**
 * Generate RUNBOOK.md
 */
export function generateRunbook(facts: RepoFacts): string {
  // Check if runbook is applicable
  const notApplicable = facts.runbook?.applicable === false || 
    (!facts.runbook?.deploySteps?.length && 
     !facts.runbook?.observability?.length &&
     !facts.runbook?.incidents?.length);

  if (notApplicable) {
    return `# Runbook: ${facts.repoName}

> This repository is a library/tool and does not require operational runbook documentation.

For usage instructions, see [ONBOARDING.md](./ONBOARDING.md).

## Build & Release

${facts.quickstart.commands.find(c => c.name === "build")?.command 
  ? `\`\`\`bash\n${facts.quickstart.commands.find(c => c.name === "build")?.command}\n\`\`\`` 
  : "_No build command detected_"}

## Publishing (if applicable)

- Ensure all tests pass
- Update version in ${facts.stack.buildSystem === "npm" ? "package.json" : "config file"}
- Create a git tag
- Push to trigger CI/CD

---
*Generated by [Repo Bootcamp](https://github.com/repo-bootcamp)*
`;
  }

  const runbook = facts.runbook!;
  const deploySteps = runbook.deploySteps?.map((s, i) => `${i + 1}. ${s}`).join("\n") || "_Not documented_";
  const observability = runbook.observability?.map((o) => `- ${o}`).join("\n") || "_Not documented_";
  const incidents =
    runbook.incidents?.map((i) => `### ${i.name}\n\n**Check:** ${i.check}`).join("\n\n") || "_No incidents documented_";

  return `# Runbook: ${facts.repoName}

Operational guide for deploying and maintaining this service.
${sourcesSection(runbook.sources)}

## Deployment

${deploySteps}

## Observability

${observability}

## Incident Response

${incidents}

## Health Checks

- Check CI status on GitHub
- Verify deployment succeeded
- Monitor error rates post-deploy

---
*Generated by [Repo Bootcamp](https://github.com/repo-bootcamp)*
`;
}

/**
 * Generate Mermaid diagrams file
 */
export function generateDiagrams(facts: RepoFacts): string {
  const componentDiagram = generateMermaidDiagram(facts);

  return `# Diagrams: ${facts.repoName}

## Component Architecture

\`\`\`mermaid
${componentDiagram}
\`\`\`

## Directory Structure

\`\`\`mermaid
graph TD
${facts.structure.keyDirs.map((d, i) => `    D${i}["${d.path}"]`).join("\n")}
\`\`\`

## CI/CD Pipeline

\`\`\`mermaid
graph LR
    A[Push] --> B[CI]
    B --> C{Tests Pass?}
    C -->|Yes| D[Build]
    C -->|No| E[Fix]
    D --> F[Deploy]
\`\`\`
`;
}
