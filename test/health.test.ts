import { describe, it, expect } from "vitest";
import {
  computeRepoHealth,
  generateHealthDocs,
  getHealthGrade,
  type RepoHealth,
} from "../src/health.js";
import type { FileInfo, ScanResult, StackInfo } from "../src/types.js";

interface ScanOverrides {
  readme?: string | null;
  stack?: Partial<StackInfo>;
}

function scan(
  files: Array<Partial<FileInfo> & { path: string }>,
  overrides: ScanOverrides = {}
): ScanResult {
  const full: FileInfo[] = files.map((f) => ({
    size: 100,
    isDirectory: false,
    ...f,
  })) as FileInfo[];
  return {
    files: full,
    readme: overrides.readme,
    stack: overrides.stack,
  } as unknown as ScanResult;
}

const HEALTHY_FILES: Array<Partial<FileInfo> & { path: string }> = [
  { path: "src/index.ts" },
  { path: "README.md" },
  { path: "LICENSE" },
  { path: "CONTRIBUTING.md" },
  { path: "CHANGELOG.md" },
  { path: "CODE_OF_CONDUCT.md" },
  { path: "SECURITY.md" },
  { path: ".github/ISSUE_TEMPLATE/bug.yml" },
  { path: ".github/PULL_REQUEST_TEMPLATE.md" },
  { path: ".github/CODEOWNERS" },
  { path: "test/app.test.ts" },
  { path: ".eslintrc.json" },
  { path: ".prettierrc" },
  { path: ".editorconfig" },
  { path: ".gitignore" },
  { path: ".github/workflows/ci.yml" },
  { path: ".github/dependabot.yml" },
  { path: ".husky/pre-commit" },
];

function healthyScan(): ScanResult {
  return scan(HEALTHY_FILES, { readme: "x".repeat(2000) });
}

describe("computeRepoHealth", () => {
  it("gives a fully-equipped repo a perfect score and no gaps", () => {
    const health = computeRepoHealth(healthyScan());
    expect(health.score).toBe(100);
    expect(health.grade).toBe("A");
    expect(health.failCount).toBe(0);
    expect(health.warnCount).toBe(0);
    expect(health.passCount).toBe(health.checks.length);
    expect(health.recommendations).toEqual([]);
    expect(health.earnedWeight).toBe(health.totalWeight);
  });

  it("flags every gap in a bare source-only repo", () => {
    const health = computeRepoHealth(scan([{ path: "src/index.ts" }, { path: "src/app.ts" }]));
    expect(health.score).toBe(0);
    expect(health.grade).toBe("F");
    expect(health.passCount).toBe(0);
    expect(health.failCount).toBe(health.checks.length);
    // Recommendations are capped and prioritized by weight (highest impact first).
    expect(health.recommendations).toHaveLength(8);
    // The three weight-3 checks (CI, README, tests) lead the list.
    expect(health.recommendations.slice(0, 3).join(" ")).toMatch(/CI/);
    expect(health.recommendations.slice(0, 3).join(" ")).toMatch(/README/);
    expect(health.recommendations.slice(0, 3).join(" ")).toMatch(/test suite/i);
  });

  it("anchors meta-file detection so source files are not mistaken for policies", () => {
    const health = computeRepoHealth(
      scan([
        { path: "src/security.ts" },
        { path: "src/contributing.ts" },
        { path: "src/license.ts" },
      ])
    );
    const byId = Object.fromEntries(health.checks.map((c) => [c.id, c]));
    expect(byId["security-policy"].status).toBe("fail");
    expect(byId["contributing"].status).toBe("fail");
    expect(byId["license"].status).toBe("fail");
  });

  it("detects a root SECURITY policy and one under .github/", () => {
    expect(
      computeRepoHealth(scan([{ path: "SECURITY.md" }])).checks.find(
        (c) => c.id === "security-policy"
      )?.status
    ).toBe("pass");
    expect(
      computeRepoHealth(scan([{ path: ".github/SECURITY.md" }])).checks.find(
        (c) => c.id === "security-policy"
      )?.status
    ).toBe("pass");
  });

  it("treats README length tiers as pass / warn / fail", () => {
    const detailed = (readme: string) =>
      computeRepoHealth(scan([{ path: "README.md" }], { readme })).checks.find(
        (c) => c.id === "readme-detailed"
      )!;

    expect(detailed("x".repeat(2000)).status).toBe("pass");
    expect(detailed("x".repeat(600)).status).toBe("warn");
    expect(detailed("short").status).toBe("fail");
  });

  it("counts a warning as half weight toward the score", () => {
    // README present (3) + brief README warn (1 -> 0.5). All else fails.
    const health = computeRepoHealth(scan([{ path: "README.md" }], { readme: "x".repeat(600) }));
    expect(health.warnCount).toBe(1);
    const detailed = health.checks.find((c) => c.id === "readme-detailed")!;
    expect(detailed.status).toBe("warn");
    expect(health.earnedWeight).toBeCloseTo(3.5, 5);
  });

  it("detects CI from a workflow file and from stack metadata", () => {
    expect(
      computeRepoHealth(scan([{ path: ".github/workflows/test.yaml" }])).checks.find(
        (c) => c.id === "ci"
      )?.status
    ).toBe("pass");
    expect(
      computeRepoHealth(scan([{ path: "src/index.ts" }], { stack: { hasCi: true } })).checks.find(
        (c) => c.id === "ci"
      )?.status
    ).toBe("pass");
    expect(
      computeRepoHealth(scan([{ path: "src/index.ts" }])).checks.find((c) => c.id === "ci")?.status
    ).toBe("fail");
  });

  it("recognizes Go and Python test naming conventions", () => {
    expect(
      computeRepoHealth(scan([{ path: "pkg/server_test.go" }])).checks.find((c) => c.id === "tests")
        ?.status
    ).toBe("pass");
    expect(
      computeRepoHealth(scan([{ path: "app/test_main.py" }])).checks.find((c) => c.id === "tests")
        ?.status
    ).toBe("pass");
  });

  it("handles an empty scan without throwing", () => {
    const health = computeRepoHealth(scan([]));
    expect(health.score).toBe(0);
    expect(health.grade).toBe("F");
    expect(health.checks.length).toBeGreaterThan(0);
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
  });

  it("normalizes Windows-style backslash paths", () => {
    const health = computeRepoHealth(scan([{ path: "src\\index.ts" }, { path: "README.md" }]));
    expect(health.checks.find((c) => c.id === "readme-present")?.status).toBe("pass");
  });
});

describe("getHealthGrade", () => {
  it("maps scores to letter grades", () => {
    expect(getHealthGrade(95)).toBe("A");
    expect(getHealthGrade(90)).toBe("A");
    expect(getHealthGrade(85)).toBe("B");
    expect(getHealthGrade(80)).toBe("B");
    expect(getHealthGrade(70)).toBe("C");
    expect(getHealthGrade(60)).toBe("D");
    expect(getHealthGrade(59)).toBe("F");
    expect(getHealthGrade(0)).toBe("F");
  });
});

describe("generateHealthDocs", () => {
  it("renders the score, category tables, and provenance footer", () => {
    const health: RepoHealth = computeRepoHealth(scan([{ path: "src/index.ts" }]));
    const doc = generateHealthDocs(health, "my-project");
    expect(doc).toContain("# Repo Health");
    expect(doc).toContain("my-project");
    expect(doc).toContain("## Onboarding Readiness");
    expect(doc).toContain("## Documentation");
    expect(doc).toContain("## Community");
    expect(doc).toContain("## Quality");
    expect(doc).toContain("## Automation");
    expect(doc).toContain("## Recommendations");
    expect(doc).toContain("computed deterministically");
  });

  it("celebrates a perfect repo with no recommendations", () => {
    const doc = generateHealthDocs(computeRepoHealth(healthyScan()), "perfect");
    expect(doc).toContain("100/100");
    expect(doc).toContain("No gaps detected");
  });
});
