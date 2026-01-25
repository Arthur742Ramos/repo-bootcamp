/**
 * Tech Radar + Onboarding Risk Module
 * Analyzes the tech stack to identify modern, stable, legacy, and risky signals
 */

import type { TechRadar, RadarSignal, StackInfo, FileInfo } from "./types.js";
import type { DependencyAnalysis } from "./deps.js";
import type { SecurityAnalysis } from "./security.js";

/**
 * Modern/recommended patterns and tools
 */
const MODERN_SIGNALS: Record<string, string> = {
  // Build tools
  "vite": "Modern build tool with fast HMR",
  "esbuild": "Blazing fast bundler",
  "swc": "Rust-based fast compiler",
  "bun": "Modern JavaScript runtime",
  "turbo": "High-performance build system",
  "tsup": "Zero-config TypeScript bundler",
  // Frameworks
  "next": "Modern React meta-framework",
  "@remix-run": "Full-stack web framework",
  "astro": "Modern static site builder",
  "solid-js": "Fine-grained reactive framework",
  "svelte": "Compile-time reactive framework",
  // State management
  "zustand": "Lightweight state management",
  "jotai": "Atomic state management",
  "@tanstack/react-query": "Modern data fetching",
  "trpc": "End-to-end typesafe APIs",
  // Testing
  "vitest": "Fast Vite-native test runner",
  "playwright": "Modern E2E testing",
  // Backend
  "hono": "Ultra-fast web framework",
  "drizzle-orm": "TypeScript-first ORM",
  "prisma": "Modern database toolkit",
  // Validation
  "zod": "TypeScript-first schema validation",
  // Package managers
  "pnpm": "Fast, disk space efficient package manager",
};

/**
 * Legacy/outdated patterns
 */
const LEGACY_SIGNALS: Record<string, string> = {
  // Build tools
  "webpack": "Consider migrating to Vite or esbuild",
  "gulp": "Legacy task runner",
  "grunt": "Legacy task runner",
  "bower": "Deprecated package manager",
  // Frameworks
  "create-react-app": "Deprecated; use Vite or Next.js",
  "angular.js": "Legacy Angular (v1)",
  // State management
  "redux": "Consider lighter alternatives like Zustand",
  "mobx": "Consider lighter alternatives",
  // Testing
  "mocha": "Consider Vitest for faster tests",
  "jasmine": "Consider modern alternatives",
  "karma": "Legacy test runner",
  "enzyme": "Deprecated; use React Testing Library",
  // Backend
  "express": "Stable but consider Hono or Fastify",
  // Database
  "mongoose": "Consider Prisma or Drizzle for type safety",
  "sequelize": "Consider Prisma or Drizzle for type safety",
  // Utilities
  "moment": "Use date-fns or dayjs instead",
  "lodash": "Many methods now native; use sparingly",
  "request": "Deprecated; use fetch or got",
  "axios": "Consider fetch or ky",
};

/**
 * Risky signals (security/maintenance concerns)
 */
const RISKY_SIGNALS: Record<string, string> = {
  "node-sass": "Deprecated; use sass (dart-sass)",
  "tslint": "Deprecated; use ESLint with typescript-eslint",
  "husky": "Ensure v5+ (v4 has breaking changes)",
  "left-pad": "Infamous npm incident package",
  "event-stream": "Had security incident",
  "colors": "Had protestware incident",
  "faker": "Unmaintained; use @faker-js/faker",
  "core-js": "Ensure updated (security patches)",
};

/**
 * Stable/recommended signals
 */
const STABLE_SIGNALS: Record<string, string> = {
  "typescript": "Industry standard type system",
  "eslint": "Standard linting tool",
  "prettier": "Standard code formatter",
  "react": "Stable UI library",
  "vue": "Stable UI framework",
  "fastify": "Fast and low overhead web framework",
  "jest": "Well-established test runner",
  "@testing-library/react": "Recommended React testing",
  "helmet": "Security headers middleware",
  "cors": "CORS middleware",
  "dotenv": "Environment variable management",
  "winston": "Production-grade logging",
  "pino": "Fast JSON logger",
};

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

    if (MODERN_SIGNALS[name]) {
      result.modern.push({
        name,
        category: "modern",
        reason: MODERN_SIGNALS[name],
      });
    } else if (RISKY_SIGNALS[name]) {
      result.risky.push({
        name,
        category: "risky",
        reason: RISKY_SIGNALS[name],
      });
    } else if (LEGACY_SIGNALS[name]) {
      result.legacy.push({
        name,
        category: "legacy",
        reason: LEGACY_SIGNALS[name],
      });
    } else if (STABLE_SIGNALS[name]) {
      result.stable.push({
        name,
        category: "stable",
        reason: STABLE_SIGNALS[name],
      });
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

  // Tests
  const hasTests = files.some(f => 
    /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(f.path) ||
    f.path.includes("__tests__") ||
    f.path.includes("test/")
  );
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
    const legacyCount = [...deps.runtime, ...deps.dev].filter(d => 
      LEGACY_SIGNALS[d.name]
    ).length;
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

    const criticalFindings = security.findings.filter(f => f.severity === "critical");
    if (criticalFindings.length > 0) {
      risk += 10;
      factors.push(`Critical security findings (${criticalFindings.length})`);
    }
  }

  // Complexity signals
  const sourceFiles = files.filter(f => 
    /\.(ts|js|tsx|jsx|py|go|rs)$/.test(f.path) && !f.path.includes("node_modules")
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
    stack, files, deps, security, hasReadme, hasContributing
  );

  // Add stack-based signals
  if (stack.languages.includes("TypeScript")) {
    depSignals.modern.push({
      name: "TypeScript",
      category: "modern",
      reason: "Type-safe JavaScript",
    });
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
    case "A": return "🟢";
    case "B": return "🟢";
    case "C": return "🟡";
    case "D": return "🟠";
    case "F": return "🔴";
    default: return "⚪";
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
  lines.push(`${emoji} **Risk Score: ${radar.onboardingRisk.score}/100** (Grade: ${radar.onboardingRisk.grade})`);
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
