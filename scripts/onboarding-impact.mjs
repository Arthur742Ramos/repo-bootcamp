import { readFile } from "node:fs/promises";

const scoreNames = [
  ["health", "Health", "higher"],
  ["metrics", "Approachability", "higher"],
  ["security", "Security heuristic", "higher"],
  ["onboardingRisk", "Onboarding risk", "lower"],
];
const statuses = new Set(["pass", "warn", "fail"]);

function markdown(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n<>]/g, " ");
}

function validate(report) {
  if (!report || typeof report !== "object" || !Number.isSafeInteger(report.filesScanned)) {
    throw new Error("Invalid scan report.");
  }
  for (const [key] of scoreNames) {
    const score = report.scores?.[key]?.score;
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error(`Invalid ${key} score.`);
    }
  }
  if (!Array.isArray(report.health?.checks)) throw new Error("Missing health checks.");
  const checks = new Map();
  for (const check of report.health.checks) {
    if (
      typeof check?.id !== "string" ||
      typeof check.label !== "string" ||
      !statuses.has(check.status) ||
      checks.has(check.id)
    ) {
      throw new Error("Invalid health check.");
    }
    checks.set(check.id, check);
  }
  return checks;
}

function summary(base, head) {
  const baseChecks = validate(base);
  const headChecks = validate(head);
  if (
    baseChecks.size !== headChecks.size ||
    [...baseChecks.keys()].some((id) => !headChecks.has(id))
  ) {
    throw new Error("The scan reports use different health checks and cannot be compared.");
  }

  const lines = [
    "## Onboarding impact",
    "",
    "Both revisions were scanned with the pull request's analyzer (up to 500 entries each).",
    "",
    "| Measure | Base | PR | Change | Direction |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  for (const [key, label, direction] of scoreNames) {
    const before = base.scores[key].score;
    const after = head.scores[key].score;
    const delta = after - before;
    lines.push(
      `| ${label} | ${before} | ${after} | ${delta > 0 ? "+" : ""}${delta} | ${direction} is better |`
    );
  }
  const changes = [...headChecks.values()].filter(
    (check) => baseChecks.get(check.id).status !== check.status
  );
  lines.push("", "### Changed readiness checks", "");
  if (changes.length === 0) {
    lines.push("No readiness check statuses changed.");
  } else {
    lines.push("| Check | Base | PR |", "| --- | --- | --- |");
    for (const check of changes) {
      lines.push(
        `| ${markdown(check.label)} | ${baseChecks.get(check.id).status} | ${check.status} |`
      );
    }
  }
  lines.push(
    "",
    `Files scanned: base ${base.filesScanned}, PR ${head.filesScanned}.`,
    "Scores are deterministic heuristics; the security score is not a security audit.",
    ""
  );
  return lines.join("\n");
}

try {
  const [basePath, headPath] = process.argv.slice(2);
  if (!basePath || !headPath || process.argv.length !== 4) {
    throw new Error("Usage: node scripts/onboarding-impact.mjs <base.json> <head.json>");
  }
  const [base, head] = await Promise.all(
    [basePath, headPath].map(async (path) => JSON.parse(await readFile(path, "utf8")))
  );
  process.stdout.write(summary(base, head));
} catch (error) {
  console.error(`Cannot produce onboarding impact: ${error.message}`);
  process.exitCode = 1;
}
