import { afterAll, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const { mkdtemp } = await import("fs/promises");
  const home = await mkdtemp(join(actual.tmpdir(), "bootcamp-mixed-cache-home-"));
  return { ...actual, homedir: () => home };
});
import {
  getCacheDir,
  readPhaseCache,
  writePhaseCache,
  listCacheEntries,
  type CachePhase,
} from "../src/cache.js";
import { runParallelAnalysis } from "../src/analysis.js";
import { scanRepo } from "../src/ingest.js";
import * as depsModule from "../src/deps.js";
afterAll(async () => {
  await rm(dirname(dirname(getCacheDir())), { recursive: true, force: true });
});

describe("mixed dependency projection cache identity", () => {
  it("misses pre-direct-reference-fix deps entries and keeps complete direct URLs on a warm run", async () => {
    const repo = "references/cache";
    const sha = "unchanged-reference-commit";
    const dir = await mkdtemp(join(tmpdir(), "bootcamp-reference-cache-repo-"));
    const hash = (seed: string) => createHash("sha256").update(seed).digest("hex").slice(0, 16);
    try {
      await writeFile(
        join(dir, "pyproject.toml"),
        '[project]\ndependencies = ["sample @ https://example.invalid/package.whl;owned#sha256=abc", "flask>=2.0"]'
      );
      const oldValue = {
        packageManager: "pip",
        totalCount: 2,
        runtime: [
          { name: "sample", version: "@ https://example.invalid/package.whl", type: "runtime" },
          { name: "flask", version: ">=2.0", type: "runtime" },
        ],
        dev: [],
        peer: [],
        categories: [],
      };
      await writePhaseCache("deps", repo, sha, oldValue);
      const entry = (await listCacheEntries()).find(
        (entry) => entry.entry?.phase === "deps" && entry.entry.repoFullName === repo
      )!;
      const oldPath = join(
        getCacheDir(),
        `references-cache-deps-${hash(`${repo}@${sha}|phase=deps|projection=mixed-ecosystems-v3-toml-literals`)}.json`
      );
      const oldBytes = await readFile(entry.path);
      await writeFile(oldPath, oldBytes);
      if (entry.path !== oldPath) await rm(entry.path);
      expect((await readPhaseCache("deps", repo, sha)).hit).toBe(false);
      const spy = vi.spyOn(depsModule, "extractDependencies");
      try {
        const cold = await runParallelAnalysis(dir, await scanRepo(dir, 100), undefined, {
          repoFullName: repo,
          commitSha: sha,
        });
        expect(cold.deps?.totalCount).toBe(2);
        expect(cold.deps?.runtime).toEqual([
          {
            name: "sample",
            version: "@ https://example.invalid/package.whl;owned#sha256=abc",
            type: "runtime",
          },
          { name: "flask", version: ">=2.0", type: "runtime" },
        ]);
        const warm = await runParallelAnalysis(dir, await scanRepo(dir, 100), undefined, {
          repoFullName: repo,
          commitSha: sha,
        });
        expect(warm.deps).toEqual(cold.deps);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(await readFile(oldPath)).toEqual(oldBytes);
      } finally {
        spy.mockRestore();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("misses pre-literal-fix deps entries and keeps decoded counts on a warm run", async () => {
    const repo = "literals/cache";
    const sha = "unchanged-literal-commit";
    const dir = await mkdtemp(join(tmpdir(), "bootcamp-literal-cache-repo-"));
    const hash = (seed: string) => createHash("sha256").update(seed).digest("hex").slice(0, 16);
    try {
      await writeFile(
        join(dir, "pyproject.toml"),
        String.raw`[project]
dependencies = ["requests>=2.28; python_version >= \"3.10\" and platform_system == \"Windows\"", "flask>=2.0"]`
      );
      const oldValue = {
        packageManager: "pip",
        totalCount: 3,
        runtime: [
          { name: "requests", version: ">=2.28", type: "runtime" },
          { name: "and", version: "platform_system == \\", type: "runtime" },
          { name: "flask", version: ">=2.0", type: "runtime" },
        ],
        dev: [],
        peer: [],
        categories: [],
      };
      await writePhaseCache("deps", repo, sha, oldValue);
      const entry = (await listCacheEntries()).find(
        (entry) => entry.entry?.phase === "deps" && entry.entry.repoFullName === repo
      )!;
      const oldPath = join(
        getCacheDir(),
        `literals-cache-deps-${hash(`${repo}@${sha}|phase=deps|projection=mixed-ecosystems-v2-comments`)}.json`
      );
      const oldBytes = await readFile(entry.path);
      await writeFile(oldPath, oldBytes);
      if (entry.path !== oldPath) await rm(entry.path);
      expect((await readPhaseCache("deps", repo, sha)).hit).toBe(false);
      const spy = vi.spyOn(depsModule, "extractDependencies");
      try {
        const cold = await runParallelAnalysis(dir, await scanRepo(dir, 100), undefined, {
          repoFullName: repo,
          commitSha: sha,
        });
        expect(cold.deps?.totalCount).toBe(2);
        expect(cold.deps?.runtime.map((dep) => dep.name)).toEqual(["requests", "flask"]);
        const warm = await runParallelAnalysis(dir, await scanRepo(dir, 100), undefined, {
          repoFullName: repo,
          commitSha: sha,
        });
        expect(warm.deps).toEqual(cold.deps);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(await readFile(oldPath)).toEqual(oldBytes);
      } finally {
        spy.mockRestore();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("misses pre-comment-fix deps entries and keeps corrected counts on a warm run", async () => {
    const repo = "comments/cache";
    const sha = "unchanged-comment-commit";
    const dir = await mkdtemp(join(tmpdir(), "bootcamp-comment-cache-repo-"));
    const hash = (seed: string) => createHash("sha256").update(seed).digest("hex").slice(0, 16);
    try {
      await writeFile(
        join(dir, "pyproject.toml"),
        '[project]\ndependencies = [\n  "requests>=2.28", # "phantom>=99"\n  "flask>=2.0",\n]\n'
      );
      const oldValue = {
        packageManager: "pip",
        totalCount: 3,
        runtime: [
          { name: "requests", version: ">=2.28", type: "runtime" },
          { name: "phantom", version: ">=99", type: "runtime" },
          { name: "flask", version: ">=2.0", type: "runtime" },
        ],
        dev: [],
        peer: [],
        categories: [],
      };
      await writePhaseCache("deps", repo, sha, oldValue);
      const entry = (await listCacheEntries()).find(
        (entry) => entry.entry?.phase === "deps" && entry.entry.repoFullName === repo
      )!;
      const oldPath = join(
        getCacheDir(),
        `comments-cache-deps-${hash(`${repo}@${sha}|phase=deps|projection=mixed-ecosystems-v1`)}.json`
      );
      const oldBytes = await readFile(entry.path);
      await writeFile(oldPath, oldBytes);
      if (entry.path !== oldPath) await rm(entry.path);
      expect((await readPhaseCache("deps", repo, sha)).hit).toBe(false);
      const spy = vi.spyOn(depsModule, "extractDependencies");
      try {
        const cold = await runParallelAnalysis(dir, await scanRepo(dir, 100), undefined, {
          repoFullName: repo,
          commitSha: sha,
        });
        expect(cold.deps?.totalCount).toBe(2);
        expect(cold.deps?.runtime.map((dep) => dep.name)).toEqual(["requests", "flask"]);
        const warm = await runParallelAnalysis(dir, await scanRepo(dir, 100), undefined, {
          repoFullName: repo,
          commitSha: sha,
        });
        expect(warm.deps).toEqual(cold.deps);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(await readFile(oldPath)).toEqual(oldBytes);
      } finally {
        spy.mockRestore();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("misses a real old deps entry, computes complete records, then hits warm while other phase keys stay exact", async () => {
    const repo = "mixed/cache";
    const sha = "unchanged-commit";
    const dir = await mkdtemp(join(tmpdir(), "bootcamp-mixed-cache-repo-"));
    const hash = (seed: string) => createHash("sha256").update(seed).digest("hex").slice(0, 16);
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ devDependencies: { prettier: "3" } })
      );
      await writeFile(join(dir, "pyproject.toml"), '[project]\ndependencies = ["fastapi>=0.110"]');
      await mkdir(getCacheDir(), { recursive: true });
      const oldPath = join(
        getCacheDir(),
        `mixed-cache-deps-${hash(`${repo}@${sha}|phase=deps`)}.json`
      );
      // Use an actual current schema entry, changing only the pre-fix projection filename/value.
      await writePhaseCache("deps", repo, sha, {
        packageManager: "npm",
        totalCount: 1,
        runtime: [],
        dev: [{ name: "prettier", version: "3", type: "dev" }],
        peer: [],
        categories: [],
      });
      const entry = (await listCacheEntries()).find(
        (entry) => entry.entry?.phase === "deps" && entry.entry.repoFullName === repo
      )!;
      await writeFile(oldPath, await readFile(entry.path));
      await rm(entry.path);
      expect((await readPhaseCache("deps", repo, sha)).hit).toBe(false);
      for (const phase of ["facts", "security", "impact", "cycles"] as CachePhase[]) {
        const value = { preserved: phase };
        await writePhaseCache(phase, repo, sha, value);
        const seed = `${repo}@${sha}${phase === "facts" ? "" : `|phase=${phase}`}`;
        const file = `mixed-cache${phase === "facts" ? "" : `-${phase}`}-${hash(seed)}.json`;
        expect(JSON.parse(await readFile(join(getCacheDir(), file), "utf8")).value).toEqual(value);
        expect(await readPhaseCache(phase, repo, sha)).toEqual({ hit: true, value });
        await rm(join(getCacheDir(), file));
      }
      const spy = vi.spyOn(depsModule, "extractDependencies");
      const cold = await runParallelAnalysis(dir, await scanRepo(dir, 100), undefined, {
        repoFullName: repo,
        commitSha: sha,
      });
      expect(cold.deps?.totalCount).toBe(2);
      expect(cold.deps?.runtime[0]).toMatchObject({ name: "fastapi", ecosystem: "python" });
      const progress = { update: vi.fn() } as any;
      const warm = await runParallelAnalysis(dir, await scanRepo(dir, 100), progress, {
        repoFullName: repo,
        commitSha: sha,
      });
      expect(warm.deps).toEqual(cold.deps);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(progress.update).toHaveBeenCalledWith("deps ✓ (cache)");
      spy.mockRestore();
      expect(JSON.parse(await readFile(oldPath, "utf8")).value.runtime).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
