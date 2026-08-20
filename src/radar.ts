/**
 * Tech Radar + Onboarding Risk Module
 * Analyzes the tech stack to identify modern, stable, legacy, and risky signals
 */

import type { TechRadar, RadarSignal, StackInfo, FileInfo } from "./types.js";
import type { DependencyAnalysis } from "./deps.js";
import type { SecurityAnalysis } from "./security.js";
import { isTestFile } from "./utils.js";
import radarSignals from "./data/radar-signals.json" with { type: "json" };

const MODERN_SIGNALS: Record<string, string> = radarSignals.modern;
const LEGACY_SIGNALS: Record<string, string> = radarSignals.legacy;
const RISKY_SIGNALS: Record<string, string> = radarSignals.risky;
const STABLE_SIGNALS: Record<string, string> = radarSignals.stable;

/**
 * Look up a radar signal for a dependency name, matching either an exact key
 * or a scope key — so a scope stub like `@remix-run` matches `@remix-run/react`,
 * and a bare key like `trpc` matches the `@trpc/*` scope.
 */
function lookupSignal(name: string, signals: Record<string, string>): string | undefined {
  if (signals[name]) return signals[name];
  for (const key of Object.keys(signals)) {
    const scope = key.startsWith("@") ? key : `@${key}`;
    if (name.startsWith(`${scope}/`)) return signals[key];
  }
  return undefined;
}

/**
 * Analyze dependencies for radar signals
 */
function analyzeDepSignals(deps: DependencyAnalysis | null): {
  modern: RadarSignal[];
  stable: RadarSignal[];
  legacy: RadarSignal[];
  risky: RadarSignal[];
} {
  const result = {
    modern: [] as RadarSignal[],
    stable: [] as RadarSignal[],
    legacy: [] as RadarSignal[],
    risky: [] as RadarSignal[],
  };

  if (!deps) return result;

  const allDeps = [...deps.runtime, ...deps.dev];

  for (const dep of allDeps) {
    const name = dep.name;

    const modern = lookupSignal(name, MODERN_SIGNALS);
    const risky = lookupSignal(name, RISKY_SIGNALS);
    const legacy = lookupSignal(name, LEGACY_SIGNALS);
    const stable = lookupSignal(name, STABLE_SIGNALS);

    if (modern) {
      result.modern.push({ name, category: "modern", reason: modern });
    } else if (risky) {
      result.risky.push({ name, category: "risky", reason: risky });
    } else if (legacy) {
      result.legacy.push({ name, category: "legacy", reason: legacy });
    } else if (stable) {
      result.stable.push({ name, category: "stable", reason: stable });
    }
  }

  return result;
}

/**
 * Calculate onboarding risk score
 */
function calculateOnboardingRisk(
  stack: StackInfo,
  files: FileInfo[],
  deps: DependencyAnalysis | null,
  security: SecurityAnalysis | null,
  hasReadme: boolean,
  hasContributing: boolean
): { score: number; grade: string; factors: string[] } {
  let risk = 0;
  const factors: string[] = [];

  // Documentation
  if (!hasReadme) {
    risk += 20;
    factors.push("Missing README");
  }
  if (!hasContributing) {
    risk += 10;
    factors.push("Missing CONTRIBUTING guide");
  }

  // CI/CD
  if (!stack.hasCi) {
    risk += 15;
    factors.push("No CI/CD pipeline detected");
  }

  // Tests — reuse the canonical predicate so path segments like `tests/` count
  // (and `latest/` does not) and non-JS conventions (Go `*_test.go`, Python
  // `test_*.py`/`*_test.py`) are recognized consistently with the other analyzers.
  const hasTests = files.some((f) => isTestFile(f.path));
  if (!hasTests) {
    risk += 15;
    factors.push("No test files detected");
  }

  // Dependencies
  if (deps) {
    if (deps.totalCount > 100) {
      risk += 10;
      factors.push(`Large dependency count (${deps.totalCount})`);
    }
    // Check for legacy deps
    const legacyCount = [...deps.runtime, ...deps.dev].filter((d) => LEGACY_SIGNALS[d.name]).length;
    if (legacyCount > 5) {
      risk += 10;
      factors.push(`Multiple legacy dependencies (${legacyCount})`);
    }
  }

  // Security
  if (security) {
    if (security.score < 60) {
      risk += 15;
      factors.push(`Low security score (${security.score})`);
    } else if (security.score < 80) {
      risk += 5;
      factors.push(`Moderate security score (${security.score})`);
    }

    const criticalFindings = security.findings.filter((f) => f.severity === "critical");
    if (criticalFindings.length > 0) {
      risk += 10;
      factors.push(`Critical security findings (${criticalFindings.length})`);
    }
  }

  // Complexity signals
  const sourceFiles = files.filter(
    (f) => /\.(ts|js|tsx|jsx|py|go|rs)$/.test(f.path) && !f.path.includes("node_modules")
  );
  if (sourceFiles.length > 500) {
    risk += 10;
    factors.push(`Large codebase (${sourceFiles.length} source files)`);
  }

  // Docker (helps onboarding)
  if (stack.hasDocker) {
    risk -= 5;
    if (factors.length === 0) factors.push("Docker available for easy setup");
  }

  // Clamp to 0-100
  risk = Math.max(0, Math.min(100, risk));

  // Calculate grade (inverted - lower risk = better grade)
  let grade: string;
  if (risk <= 10) grade = "A";
  else if (risk <= 25) grade = "B";
  else if (risk <= 40) grade = "C";
  else if (risk <= 60) grade = "D";
  else grade = "F";

  return { score: risk, grade, factors };
}

/**
 * Generate full tech radar analysis
 */
export function generateTechRadar(
  stack: StackInfo,
  files: FileInfo[],
  deps: DependencyAnalysis | null,
  security: SecurityAnalysis | null,
  hasReadme: boolean,
  hasContributing: boolean
): TechRadar {
  const depSignals = analyzeDepSignals(deps);
  const onboardingRisk = calculateOnboardingRisk(
    stack,
    files,
    deps,
    security,
    hasReadme,
    hasContributing
  );

  // Add stack-based signals
  if (stack.languages.includes("TypeScript")) {
    // Avoid listing TypeScript in two rings: a `typescript` dependency is
    // already categorized (stable) by analyzeDepSignals, so only add the
    // language-derived signal when nothing else covers it.
    const alreadyHasTs = [
      ...depSignals.modern,
      ...depSignals.stable,
      ...depSignals.legacy,
      ...depSignals.risky,
    ].some((s) => s.name.toLowerCase() === "typescript");
    if (!alreadyHasTs) {
      depSignals.modern.push({
        name: "TypeScript",
        category: "modern",
        reason: "Type-safe JavaScript",
      });
    }
  }

  if (stack.hasCi) {
    depSignals.stable.push({
      name: "CI/CD",
      category: "stable",
      reason: "Automated testing and deployment",
    });
  }

  if (stack.hasDocker) {
    depSignals.stable.push({
      name: "Docker",
      category: "stable",
      reason: "Containerized development environment",
    });
  }

  return {
    modern: depSignals.modern,
    stable: depSignals.stable,
    legacy: depSignals.legacy,
    risky: depSignals.risky,
    onboardingRisk,
  };
}

/**
 * Get risk grade color emoji
 */
export function getRiskEmoji(grade: string): string {
  switch (grade) {
    case "A":
      return "🟢";
    case "B":
      return "🟢";
    case "C":
      return "🟡";
    case "D":
      return "🟠";
    case "F":
      return "🔴";
    default:
      return "⚪";
  }
}

/**
 * Generate RADAR.md documentation
 */
export function generateRadarDocs(radar: TechRadar, projectName: string): string {
  const lines: string[] = [];

  lines.push("# Tech Radar");
  lines.push("");
  lines.push(`Technology assessment for **${projectName}**.`);
  lines.push("");

  // Onboarding Risk Score
  lines.push("## Onboarding Risk");
  lines.push("");
  const emoji = getRiskEmoji(radar.onboardingRisk.grade);
  lines.push(
    `${emoji} **Risk Score: ${radar.onboardingRisk.score}/100** (Grade: ${radar.onboardingRisk.grade})`
  );
  lines.push("");
  if (radar.onboardingRisk.factors.length > 0) {
    lines.push("**Factors:**");
    for (const factor of radar.onboardingRisk.factors) {
      lines.push(`- ${factor}`);
    }
  } else {
    lines.push("No significant onboarding risks detected.");
  }
  lines.push("");

  // Radar visualization (text-based)
  lines.push("## Technology Assessment");
  lines.push("");
  lines.push("```");
  lines.push("        ADOPT          |         TRIAL");
  lines.push("    (Modern, use)      |    (Stable, proven)");
  lines.push("-----------------------+------------------------");
  lines.push("        ASSESS         |         HOLD");
  lines.push("    (Evaluate)         |    (Legacy/Risky)");
  lines.push("```");
  lines.push("");

  // Modern (Adopt)
  if (radar.modern.length > 0) {
    lines.push("### 🚀 Modern (Adopt)");
    lines.push("");
    lines.push("Technologies that are current best practices:");
    lines.push("");
    lines.push("| Technology | Why |");
    lines.push("|------------|-----|");
    for (const signal of radar.modern) {
      lines.push(`| ${signal.name} | ${signal.reason} |`);
    }
    lines.push("");
  }

  // Stable (Trial)
  if (radar.stable.length > 0) {
    lines.push("### ✅ Stable (Trial)");
    lines.push("");
    lines.push("Proven technologies with strong ecosystem support:");
    lines.push("");
    lines.push("| Technology | Why |");
    lines.push("|------------|-----|");
    for (const signal of radar.stable) {
      lines.push(`| ${signal.name} | ${signal.reason} |`);
    }
    lines.push("");
  }

  // Legacy (Hold)
  if (radar.legacy.length > 0) {
    lines.push("### ⚠️ Legacy (Hold)");
    lines.push("");
    lines.push("Technologies that may need migration:");
    lines.push("");
    lines.push("| Technology | Recommendation |");
    lines.push("|------------|----------------|");
    for (const signal of radar.legacy) {
      lines.push(`| ${signal.name} | ${signal.reason} |`);
    }
    lines.push("");
  }

  // Risky
  if (radar.risky.length > 0) {
    lines.push("### 🔴 Risky (Avoid)");
    lines.push("");
    lines.push("Technologies with known issues:");
    lines.push("");
    lines.push("| Technology | Concern |");
    lines.push("|------------|---------|");
    for (const signal of radar.risky) {
      lines.push(`| ${signal.name} | ${signal.reason} |`);
    }
    lines.push("");
  }

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Category | Count |`);
  lines.push(`|----------|-------|`);
  lines.push(`| 🚀 Modern | ${radar.modern.length} |`);
  lines.push(`| ✅ Stable | ${radar.stable.length} |`);
  lines.push(`| ⚠️ Legacy | ${radar.legacy.length} |`);
  lines.push(`| 🔴 Risky | ${radar.risky.length} |`);
  lines.push("");

  return lines.join("\n");
}
