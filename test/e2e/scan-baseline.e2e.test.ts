import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./helpers.js";
import pkg from "../../package.json" with { type: "json" };

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "bootcamp-baseline-e2e-"));
  directories.push(root);
  const repo = join(root, "repo with spaces");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({ name: "baseline-fixture", version: "1.0.0", scripts: { test: "vitest" } })
  );
  await writeFile(
    join(repo, "README.md"),
    "# Baseline fixture\n\n" + "Onboarding guidance. ".repeat(50)
  );
  await writeFile(join(repo, "src", "index.ts"), "export const answer = 42;\n");
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
  const baseline = join(root, "baseline report.json");
  const initial = await runCli(["scan", repo, "--json"]);
  expect(initial.exitCode, initial.stderr).toBe(0);
  await writeFile(baseline, initial.stdout);
  return { root, repo, baseline, report: JSON.parse(initial.stdout) };
}

describe("scan baseline CLI", () => {
  it("emits comparable metadata and a clean unchanged JSON comparison", async () => {
    const { repo, baseline, report } = await setup();
    expect(report.metadata).toEqual({
      schemaVersion: 1,
      analyzerVersion: pkg.version,
      maxFiles: 500,
    });
    const result = await runCli([
      "scan",
      repo,
      "--baseline",
      baseline,
      "--check",
      "--min-score",
      "0",
      "--json",
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    const compared = JSON.parse(result.stdout);
    expect(compared.comparison.regressed).toBe(false);
    expect(compared.comparison.scores).toHaveLength(4);
    expect(compared.comparison.healthChanges).toEqual([]);
  }, 60_000);
  it("reports genuine readiness regressions and gates them only with --check", async () => {
    const { repo, baseline, report } = await setup();
    await rm(join(repo, "README.md"));
    const ungated = await runCli(["scan", repo, "--baseline", baseline, "--json"]);
    expect(ungated.exitCode, ungated.stderr).toBe(0);
    const compared = JSON.parse(ungated.stdout);
    expect(compared.scores.health.score).toBeLessThan(report.scores.health.score);
    expect(compared.comparison.regressed).toBe(true);
    expect(
      compared.comparison.healthChanges.some((check: { after: string }) => check.after === "fail")
    ).toBe(true);
    const gated = await runCli([
      "scan",
      repo,
      "--baseline",
      baseline,
      "--check",
      "--min-score",
      "0",
      "--json",
    ]);
    expect(gated.exitCode).toBe(1);
    expect(JSON.parse(gated.stdout).comparison.regressed).toBe(true);
    const tolerated = await runCli([
      "scan",
      repo,
      "--baseline",
      baseline,
      "--check",
      "--min-score",
      "0",
      "--max-regression",
      "100",
    ]);
    expect(tolerated.exitCode, tolerated.stderr).toBe(0);
    expect(tolerated.stdout).toContain("Baseline comparison");
    expect(tolerated.stdout).toContain("Changed readiness checks:");
  }, 60_000);
  it("retains the absolute minimum gate even when the baseline is unchanged", async () => {
    const { repo, baseline } = await setup();
    const result = await runCli([
      "scan",
      repo,
      "--baseline",
      baseline,
      "--check",
      "--min-score",
      "100",
      "--json",
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).comparison.regressed).toBe(false);
  }, 60_000);
  it("rejects incompatible metadata before resolving a repository", async () => {
    const { baseline } = await setup();
    const result = await runCli([
      "scan",
      "./not-a-repository",
      "--baseline",
      baseline,
      "--max-files",
      "100",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Baseline is incompatible");
    expect(result.stderr).not.toContain("Failed to resolve repository");
  }, 60_000);
  it("rejects invalid combinations and numeric literals before repository work", async () => {
    for (const args of [
      ["--max-regression", "2"],
      ["--baseline", "missing.json", "--max-regression", "2"],
      ["--baseline", "missing.json", "--check", "--max-regression", "NaN"],
      ["--baseline", "missing.json", "--check", "--max-regression", "101"],
      ["--baseline", "missing.json", "--check", "--max-regression", "-1"],
      ["--baseline", "missing.json", "--check", "--max-regression", "2junk"],
      ["--baseline", "missing.json", "--max-files", "2junk"],
      ["--baseline", "missing.json", "--min-score", "2junk"],
    ]) {
      const result = await runCli(["scan", "./not-a-repository", ...args]);
      expect(result.exitCode, args.join(" ")).toBe(1);
      expect(result.stderr, args.join(" ")).toContain("Scan failed:");
      expect(result.stderr).not.toContain("Failed to resolve repository");
      expect(result.stdout).toBe("");
    }
  }, 60_000);
  it("shows scan-only help and shell completion options", async () => {
    const scan = await runCli(["scan", "--help"]);
    expect(scan.stdout).toContain("--baseline <file>");
    expect(scan.stdout).toContain("--max-regression <points>");
    for (const command of ["health", "metrics", "security"]) {
      const help = await runCli([command, "--help"]);
      expect(help.stdout).not.toContain("--baseline");
      const rejected = await runCli([command, ".", "--baseline", "anything.json"]);
      expect(rejected.exitCode).toBe(1);
      expect(rejected.stderr).toContain("unknown option");
    }
    const completion = await runCli(["completion", "bash"]);
    expect(completion.exitCode).toBe(0);
    expect(completion.stdout).toContain("--baseline");
    expect(completion.stdout).toContain("--max-regression");
  }, 60_000);
});
