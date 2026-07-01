/**
 * Repo Health & Onboarding Readiness Module
 *
 * Deterministic (no LLM) evaluation of how "onboarding-ready" a repository is.
 * It inspects the file scan for the signals that make a project approachable to
 * new contributors — documentation, community files, quality tooling, and
 * automation — and produces a weighted 0-100 score, a letter grade, and a
 * prioritized list of concrete recommendations.
 *
 * Everything here is computed from the scanned file list (and, when available,
 * README/CONTRIBUTING contents) so results are stable across runs.
 */

import type { FileInfo, ScanResult } from "./types.js";
import { isTestFile } from "./utils.js";

/** Outcome of a single health check. */
export type HealthStatus = "pass" | "warn" | "fail";

/** Grouping used to organize checks in the report. */
export type HealthCategory = "Documentation" | "Community" | "Quality" | "Automation";

/** A single, deterministic onboarding-readiness check. */
export interface HealthCheck {
  /** Stable identifier, e.g. "readme-present". */
  id: string;
  /** Human-readable label shown in the report. */
  label: string;
  category: HealthCategory;
  status: HealthStatus;
  /** Relative importance; drives the weighted score and recommendation order. */
  weight: number;
  /** Short explanation/evidence for the status. */
  detail: string;
  /** Actionable suggestion, present when the check did not fully pass. */
  recommendation?: string;
}

/** Full repo-health result. */
export interface RepoHealth {
  /** 0-100, higher is healthier/more onboarding-ready. */
  score: number;
  /** Letter grade A-F derived from the score. */
  grade: string;
  /** Weight earned across all checks (warn counts as half). */
  earnedWeight: number;
  /** Total weight available across all checks. */
  totalWeight: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  checks: HealthCheck[];
  /** Prioritized, human-readable recommendations (highest impact first). */
  recommendations: string[];
}

/** Maximum recommendations surfaced in the report. */
const MAX_RECOMMENDATIONS = 8;

/** Directory prefixes where community/meta files conventionally live. */
const META_PREFIXES = ["", ".github/", ".gitlab/", "docs/", "doc/"];

function normalize(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/**
 * Does any file match `namePattern` at the repo root or inside a conventional
 * meta directory (.github/, docs/, ...)? This anchors detection so that, for
 * example, `src/security.ts` is not mistaken for a SECURITY policy.
 */
function hasMetaFile(paths: string[], namePattern: RegExp): boolean {
  return paths.some((path) => {
    for (const prefix of META_PREFIXES) {
      if (prefix !== "" && !path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.length > 0 && !rest.includes("/") && namePattern.test(rest)) {
        return true;
      }
    }
    return false;
  });
}

function hasPath(paths: string[], pattern: RegExp): boolean {
  return paths.some((path) => pattern.test(path));
}

interface DetectionContext {
  paths: string[];
  readmeLength: number;
  hasCi: boolean;
}

function computeReadmeLength(scan: ScanResult, files: FileInfo[]): number {
  if (typeof scan.readme === "string" && scan.readme.length > 0) {
    return scan.readme.trim().length;
  }
  const readme = files.find((f) => /^readme(\.[a-z0-9]+)?$/i.test(f.path.replace(/\\/g, "/")));
  return readme?.size ?? 0;
}

function buildContext(scan: ScanResult): DetectionContext {
  const files: FileInfo[] = (scan.files ?? []).filter((f) => !f.isDirectory);
  const paths = files.map((f) => normalize(f.path));

  const readmeLength = computeReadmeLength(scan, files);

  const ciFromFiles = hasPath(paths, /(^|\/)\.github\/workflows\/.+\.ya?ml$/)
    || hasPath(paths, /(^|\/)\.gitlab-ci\.yml$/)
    || hasPath(paths, /(^|\/)\.circleci\//)
    || hasPath(paths, /(^|\/)azure-pipelines\.yml$/)
    || hasPath(paths, /(^|\/)\.travis\.yml$/)
    || hasPath(paths, /(^|\/)jenkinsfile$/)
    || hasPath(paths, /(^|\/)bitbucket-pipelines\.yml$/)
    || hasPath(paths, /(^|\/)\.drone\.yml$/)
    || hasPath(paths, /(^|\/)appveyor\.yml$/);
  const hasCi = Boolean(scan.stack?.hasCi) || ciFromFiles;

  return { paths, readmeLength, hasCi };
}

interface CheckSpec {
  id: string;
  label: string;
  category: HealthCategory;
  weight: number;
  evaluate: (ctx: DetectionContext) => {
    status: HealthStatus;
    detail: string;
    recommendation?: string;
  };
}

function present(label: string): { status: HealthStatus; detail: string } {
  return { status: "pass", detail: `${label} present` };
}

function missing(
  label: string,
  recommendation: string
): { status: HealthStatus; detail: string; recommendation: string } {
  return { status: "fail", detail: `${label} not found`, recommendation };
}

const CHECK_SPECS: CheckSpec[] = [
  {
    id: "readme-present",
    label: "README",
    category: "Documentation",
    weight: 3,
    evaluate: (ctx) =>
      hasMetaFile(ctx.paths, /^readme(\.[a-z0-9]+)?$/)
        ? present("README")
        : missing("README", "Add a README that explains what the project does and how to run it"),
  },
  {
    id: "readme-detailed",
    label: "Detailed README",
    category: "Documentation",
    weight: 1,
    evaluate: (ctx) => {
      if (!hasMetaFile(ctx.paths, /^readme(\.[a-z0-9]+)?$/)) {
        return {
          status: "fail",
          detail: "No README to evaluate",
          recommendation: "Add a README with setup, usage, and contribution guidance",
        };
      }
      if (ctx.readmeLength >= 1500) {
        return { status: "pass", detail: `README is substantial (~${ctx.readmeLength} chars)` };
      }
      if (ctx.readmeLength >= 400) {
        return {
          status: "warn",
          detail: `README is brief (~${ctx.readmeLength} chars)`,
          recommendation: "Expand the README with setup steps, usage examples, and links to deeper docs",
        };
      }
      return {
        status: "fail",
        detail: `README is very short (~${ctx.readmeLength} chars)`,
        recommendation: "Flesh out the README — a stub README leaves newcomers stuck on day one",
      };
    },
  },
  {
    id: "license",
    label: "License",
    category: "Documentation",
    weight: 2,
    evaluate: (ctx) =>
      hasMetaFile(ctx.paths, /^(licen[sc]e|copying|unlicense)(\.[a-z0-9]+)?$/)
        ? present("License")
        : missing("License", "Add a LICENSE file so contributors know the usage terms"),
  },
  {
    id: "contributing",
    label: "Contributing guide",
    category: "Documentation",
    weight: 2,
    evaluate: (ctx) =>
      hasMetaFile(ctx.paths, /^contributing(\.[a-z0-9]+)?$/)
        ? present("CONTRIBUTING guide")
        : missing(
            "CONTRIBUTING guide",
            "Add CONTRIBUTING.md describing how to set up, test, and submit changes"
          ),
  },
  {
    id: "changelog",
    label: "Changelog",
    category: "Documentation",
    weight: 1,
    evaluate: (ctx) =>
      hasMetaFile(ctx.paths, /^(changelog|changes|history)(\.[a-z0-9]+)?$/)
        ? present("Changelog")
        : missing("Changelog", "Add a CHANGELOG so contributors can track notable changes"),
  },
  {
    id: "code-of-conduct",
    label: "Code of Conduct",
    category: "Community",
    weight: 1,
    evaluate: (ctx) =>
      hasMetaFile(ctx.paths, /^code[-_]?of[-_]?conduct(\.[a-z0-9]+)?$/)
        ? present("Code of Conduct")
        : missing(
            "Code of Conduct",
            "Add a CODE_OF_CONDUCT.md to set community expectations"
          ),
  },
  {
    id: "security-policy",
    label: "Security policy",
    category: "Community",
    weight: 1,
    evaluate: (ctx) =>
      hasMetaFile(ctx.paths, /^security(\.[a-z0-9]+)?$/)
        ? present("Security policy")
        : missing(
            "Security policy",
            "Add SECURITY.md explaining how to report vulnerabilities"
          ),
  },
  {
    id: "issue-templates",
    label: "Issue templates",
    category: "Community",
    weight: 1,
    evaluate: (ctx) =>
      hasPath(ctx.paths, /(^|\/)\.github\/issue_template($|[./])/)
        ? present("Issue templates")
        : missing(
            "Issue templates",
            "Add .github/ISSUE_TEMPLATE forms to guide high-quality bug reports and requests"
          ),
  },
  {
    id: "pr-template",
    label: "Pull request template",
    category: "Community",
    weight: 1,
    evaluate: (ctx) =>
      hasPath(ctx.paths, /(^|\/)pull_request_template($|[./])/)
        ? present("Pull request template")
        : missing(
            "Pull request template",
            "Add .github/PULL_REQUEST_TEMPLATE.md to standardize PR descriptions"
          ),
  },
  {
    id: "codeowners",
    label: "CODEOWNERS",
    category: "Community",
    weight: 1,
    evaluate: (ctx) =>
      hasPath(ctx.paths, /(^|\/)codeowners$/)
        ? present("CODEOWNERS")
        : missing(
            "CODEOWNERS",
            "Add a CODEOWNERS file so reviewers are auto-assigned and ownership is clear"
          ),
  },
  {
    id: "tests",
    label: "Automated tests",
    category: "Quality",
    weight: 3,
    evaluate: (ctx) =>
      ctx.paths.some((p) => isTestFile(p))
        ? present("Automated tests")
        : missing(
            "Automated tests",
            "Add a test suite — tests give newcomers a safety net for their first changes"
          ),
  },
  {
    id: "linter-config",
    label: "Linter configuration",
    category: "Quality",
    weight: 1,
    evaluate: (ctx) =>
      hasPath(
        ctx.paths,
        /(^|\/)(\.eslintrc(\.[a-z]+)?|eslint\.config\.[a-z]+|\.stylelintrc(\.[a-z]+)?|\.pylintrc|\.flake8|ruff\.toml|\.ruff\.toml|\.golangci\.ya?ml|\.rubocop\.yml|tslint\.json|biome\.jsonc?)$/
      )
        ? present("Linter configuration")
        : missing(
            "Linter configuration",
            "Add a linter config (e.g. ESLint, Ruff, golangci-lint) to keep contributions consistent"
          ),
  },
  {
    id: "formatter-config",
    label: "Formatter configuration",
    category: "Quality",
    weight: 1,
    evaluate: (ctx) =>
      hasPath(
        ctx.paths,
        /(^|\/)(\.prettierrc(\.[a-z]+)?|prettier\.config\.[a-z]+|\.clang-format|rustfmt\.toml|\.rustfmt\.toml|\.scalafmt\.conf|dprint\.jsonc?|biome\.jsonc?)$/
      )
        ? present("Formatter configuration")
        : missing(
            "Formatter configuration",
            "Add an auto-formatter config (e.g. Prettier, rustfmt, clang-format) to avoid style churn"
          ),
  },
  {
    id: "editorconfig",
    label: "EditorConfig",
    category: "Quality",
    weight: 1,
    evaluate: (ctx) =>
      hasPath(ctx.paths, /(^|\/)\.editorconfig$/)
        ? present("EditorConfig")
        : missing(
            "EditorConfig",
            "Add an .editorconfig so editors share indentation and encoding settings"
          ),
  },
  {
    id: "gitignore",
    label: ".gitignore",
    category: "Quality",
    weight: 1,
    evaluate: (ctx) =>
      hasPath(ctx.paths, /(^|\/)\.gitignore$/)
        ? present(".gitignore")
        : missing(".gitignore", "Add a .gitignore to keep build artifacts and secrets out of version control"),
  },
  {
    id: "ci",
    label: "Continuous integration",
    category: "Automation",
    weight: 3,
    evaluate: (ctx) =>
      ctx.hasCi
        ? present("CI configuration")
        : missing(
            "CI configuration",
            "Add CI (e.g. GitHub Actions) so tests and lint run automatically on every change"
          ),
  },
  {
    id: "dependency-automation",
    label: "Dependency automation",
    category: "Automation",
    weight: 1,
    evaluate: (ctx) =>
      hasPath(
        ctx.paths,
        /(^|\/)(dependabot\.ya?ml|renovate\.json|\.renovaterc(\.[a-z]+)?)$/
      )
        ? present("Dependency automation")
        : missing(
            "Dependency automation",
            "Enable Dependabot or Renovate to keep dependencies patched automatically"
          ),
  },
  {
    id: "git-hooks",
    label: "Git hooks / pre-commit",
    category: "Automation",
    weight: 1,
    evaluate: (ctx) =>
      hasPath(ctx.paths, /(^|\/)\.husky\//)
        || hasPath(ctx.paths, /(^|\/)\.pre-commit-config\.ya?ml$/)
        || hasPath(ctx.paths, /(^|\/)\.githooks\//)
        || hasPath(ctx.paths, /(^|\/)lefthook\.ya?ml$/)
        ? present("Git hooks / pre-commit")
        : missing(
            "Git hooks / pre-commit",
            "Add pre-commit hooks (e.g. Husky, pre-commit) to catch issues before they land"
          ),
  },
];

/**
 * Convert a health score to a letter grade.
 */
export function getHealthGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Compute deterministic repo-health/onboarding-readiness from a completed scan.
 */
export function computeRepoHealth(scan: ScanResult): RepoHealth {
  const ctx = buildContext(scan);

  const checks: HealthCheck[] = CHECK_SPECS.map((spec) => {
    const result = spec.evaluate(ctx);
    return {
      id: spec.id,
      label: spec.label,
      category: spec.category,
      weight: spec.weight,
      status: result.status,
      detail: result.detail,
      recommendation: result.recommendation,
    };
  });

  let earnedWeight = 0;
  let totalWeight = 0;
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const check of checks) {
    totalWeight += check.weight;
    if (check.status === "pass") {
      earnedWeight += check.weight;
      passCount += 1;
    } else if (check.status === "warn") {
      earnedWeight += check.weight / 2;
      warnCount += 1;
    } else {
      failCount += 1;
    }
  }

  const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;

  const recommendations = checks
    .filter((check) => check.status !== "pass" && check.recommendation)
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        a.category.localeCompare(b.category) ||
        a.label.localeCompare(b.label)
    )
    .slice(0, MAX_RECOMMENDATIONS)
    .map((check) => check.recommendation as string);

  return {
    score,
    grade: getHealthGrade(score),
    earnedWeight: Math.round(earnedWeight * 10) / 10,
    totalWeight,
    passCount,
    warnCount,
    failCount,
    checks,
    recommendations,
  };
}

const STATUS_ICON: Record<HealthStatus, string> = {
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
};

const CATEGORY_ORDER: HealthCategory[] = ["Documentation", "Community", "Quality", "Automation"];

/**
 * Render repo health as a Markdown document (HEALTH.md).
 */
export function generateHealthDocs(health: RepoHealth, projectName: string): string {
  const lines: string[] = [];
  const scoreEmoji = health.score >= 80 ? "🟢" : health.score >= 60 ? "🟡" : "🔴";

  lines.push("# Repo Health");
  lines.push("");
  lines.push(
    `Onboarding-readiness snapshot of **${projectName}** — the documentation, community, quality, and automation signals that help new contributors get productive quickly.`
  );
  lines.push("");

  lines.push("## Onboarding Readiness");
  lines.push("");
  lines.push(`${scoreEmoji} **${health.score}/100** (Grade: ${health.grade})`);
  lines.push("");
  lines.push(
    `${health.passCount} passed · ${health.warnCount} warning${health.warnCount === 1 ? "" : "s"} · ${health.failCount} missing`
  );
  lines.push("");

  for (const category of CATEGORY_ORDER) {
    const categoryChecks = health.checks.filter((check) => check.category === category);
    if (categoryChecks.length === 0) continue;

    lines.push(`## ${category}`);
    lines.push("");
    lines.push("| Check | Status | Detail |");
    lines.push("|-------|--------|--------|");
    for (const check of categoryChecks) {
      lines.push(`| ${check.label} | ${STATUS_ICON[check.status]} | ${check.detail} |`);
    }
    lines.push("");
  }

  if (health.recommendations.length > 0) {
    lines.push("## Recommendations");
    lines.push("");
    lines.push("Highest-impact improvements first:");
    lines.push("");
    health.recommendations.forEach((recommendation, index) => {
      lines.push(`${index + 1}. ${recommendation}`);
    });
    lines.push("");
  } else {
    lines.push("## Recommendations");
    lines.push("");
    lines.push("🎉 No gaps detected — this repository covers the onboarding-readiness checklist.");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("_Health is computed deterministically from the file scan (no AI), so it's stable across runs._");
  lines.push("");

  return lines.join("\n");
}
