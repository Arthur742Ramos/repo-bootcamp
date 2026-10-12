import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const { mkdtemp } = await import("node:fs/promises");
  const home = await mkdtemp(join(actual.tmpdir(), "bootcamp-phase-recovery-home-"));
  return { ...actual, homedir: () => home };
});
import { getCacheDir, readPhaseCache, writePhaseCache } from "../src/cache.js";
import { runParallelAnalysis } from "../src/analysis.js";
import { scanRepo } from "../src/ingest.js";
import * as deps from "../src/deps.js";
import * as security from "../src/security.js";
import * as impact from "../src/impact.js";
import { isValidAnalysisCacheValue } from "../src/cache-payloads.js";

afterAll(async () => {
  await rm(dirname(dirname(getCacheDir())), { recursive: true, force: true });
});
const phases = ["deps", "security", "impact", "cycles"] as const;
describe("deterministic cache payload recovery", () => {
  it.each(phases)("recomputes malformed %s once and retains valid phase reuse", async (phase) => {
    const root = await mkdtemp(join(tmpdir(), "bootcamp-phase-recovery-"));
    try {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "src/index.ts"), "export const fixture = 1;\n");
      await writeFile(join(root, "package.json"), '{"dependencies":{"express":"5"}}');
      const reference = await runParallelAnalysis(root, await scanRepo(root, 100));
      const values = {
        deps: reference.deps,
        security: reference.security,
        impact: reference.impacts,
        cycles: reference.cycles,
      };
      const repo = `phase-recovery/${phase}`,
        sha = "same-sha";
      for (const key of phases)
        await writePhaseCache(key, repo, sha, key === phase ? { malformed: true } : values[key]);
      const compute =
        phase === "deps"
          ? vi.spyOn(deps, "extractDependencies")
          : phase === "security"
            ? vi.spyOn(security, "analyzeSecurityPatterns")
            : vi.spyOn(impact, "buildImportGraph");
      try {
        const options = { repoFullName: repo, commitSha: sha };
        await runParallelAnalysis(root, await scanRepo(root, 100), undefined, options);
        const repaired = await readPhaseCache(phase, repo, sha);
        expect(repaired).toEqual({ hit: true, value: values[phase] });
        await runParallelAnalysis(root, await scanRepo(root, 100), undefined, options);
        expect(compute).toHaveBeenCalledTimes(1);
      } finally {
        compute.mockRestore();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a valid null dependency result as a hit", async () => {
    const root = await mkdtemp(join(tmpdir(), "bootcamp-null-deps-"));
    const compute = vi.spyOn(deps, "extractDependencies");
    try {
      await writePhaseCache("deps", "phase-recovery/null", "sha", null);
      const result = await runParallelAnalysis(root, await scanRepo(root, 100), undefined, {
        repoFullName: "phase-recovery/null",
        commitSha: "sha",
      });
      expect(result.deps).toBeNull();
      expect(compute).not.toHaveBeenCalled();
      expect(isValidAnalysisCacheValue("deps", null)).toBe(true);
      expect(isValidAnalysisCacheValue("deps", {})).toBe(false);
    } finally {
      compute.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
