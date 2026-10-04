import { afterAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const { mkdtemp } = await import("node:fs/promises");
  const home = await mkdtemp(join(actual.tmpdir(), "bootcamp-root-lines-cache-home-"));
  return { ...actual, homedir: () => home };
});
import { getCacheDir, readPhaseCache, writePhaseCache, listCacheEntries } from "../src/cache.js";
import { runParallelAnalysis } from "../src/analysis.js";
import { scanRepo } from "../src/ingest.js";
import * as depsModule from "../src/deps.js";

afterAll(async () => {
  await rm(dirname(dirname(getCacheDir())), { recursive: true, force: true });
});
const hash = (seed: string) => createHash("sha256").update(seed).digest("hex").slice(0, 16);

describe("root requirements projection cache migration", () => {
  it("misses synthetic v8 dependencies, recomputes once and preserves unrelated phases and old bytes", async () => {
    const repo = "root-lines/cache";
    const sha = "unchanged-root-lines-commit";
    const dir = await mkdtemp(join(tmpdir(), "bootcamp-root-lines-cache-repo-"));
    try {
      await writeFile(
        join(dir, "requirements.txt"),
        "--find-links \\\nwheels\nrequests>=2.28,\\\n<3"
      );
      const stale = {
        packageManager: "pip",
        totalCount: 2,
        runtime: [
          { name: "wheels", version: "*", type: "runtime" },
          { name: "requests", version: "2.28,\\", type: "runtime" },
        ],
        dev: [],
        peer: [],
        categories: [],
      };
      await writePhaseCache("deps", repo, sha, stale);
      const current = (await listCacheEntries()).find(
        (entry) => entry.entry?.phase === "deps" && entry.entry.repoFullName === repo
      )!;
      const oldPath = join(
        getCacheDir(),
        `root-lines-cache-deps-${hash(`${repo}@${sha}|phase=deps|projection=mixed-ecosystems-v8-go-literals`)}.json`
      );
      const oldBytes = await readFile(current.path);
      await writeFile(oldPath, oldBytes);
      await rm(current.path);
      expect(await readPhaseCache("deps", repo, sha)).toEqual({ hit: false });
      const reference = await runParallelAnalysis(dir, await scanRepo(dir, 100));
      const retained = [];
      for (const phase of ["facts", "security", "impact", "cycles"] as const) {
        const value =
          phase === "security"
            ? reference.security
            : phase === "impact"
              ? reference.impacts
              : phase === "cycles"
                ? reference.cycles
                : { marker: "owned-facts" };
        await writePhaseCache(phase, repo, sha, value);
        const seed = phase === "facts" ? `${repo}@${sha}` : `${repo}@${sha}|phase=${phase}`;
        const path = join(
          getCacheDir(),
          `root-lines-cache${phase === "facts" ? "" : `-${phase}`}-${hash(seed)}.json`
        );
        retained.push({ phase, value, path, bytes: await readFile(path) });
        expect(await readPhaseCache(phase, repo, sha)).toEqual({ hit: true, value });
      }
      const spy = vi.spyOn(depsModule, "extractDependencies");
      try {
        const options = { repoFullName: repo, commitSha: sha };
        const cold = await runParallelAnalysis(dir, await scanRepo(dir, 100), undefined, options);
        expect(cold.deps?.runtime).toEqual([
          { name: "requests", version: "2.28,<3", type: "runtime" },
        ]);
        expect(cold.deps?.totalCount).toBe(1);
        const warm = await runParallelAnalysis(dir, await scanRepo(dir, 100), undefined, options);
        expect(warm.deps).toEqual(cold.deps);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(await readFile(oldPath)).toEqual(oldBytes);
        for (const entry of retained) {
          expect(await readFile(entry.path)).toEqual(entry.bytes);
          expect(await readPhaseCache(entry.phase, repo, sha)).toEqual({
            hit: true,
            value: entry.value,
          });
        }
      } finally {
        spy.mockRestore();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
