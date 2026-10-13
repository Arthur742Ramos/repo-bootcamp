import { afterAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const { mkdtemp } = await import("node:fs/promises");
  const home = await mkdtemp(join(actual.tmpdir(), "bootcamp-metadata-cache-"));
  return { ...actual, homedir: () => home };
});
import { getCacheDir, listCacheEntries, readPhaseCache, writePhaseCache } from "../src/cache.js";
afterAll(async () => {
  await rm(dirname(dirname(getCacheDir())), { recursive: true, force: true });
});

describe("contained metadata cache migration", () => {
  it.each(["facts", "deps", "security"] as const)(
    "misses pre-containment %s entries without altering old bytes",
    async (phase) => {
      const repo = `containment/${phase}`;
      const sha = "same-commit";
      const stale = { marker: "outside_fixture_marker" };
      await writePhaseCache(phase, repo, sha, stale);
      const current = (await listCacheEntries()).find(
        (entry) => entry.entry?.repoFullName === repo
      )!;
      const oldSeed = `${repo}@${sha}${phase === "facts" ? "" : `|phase=${phase}`}${phase === "deps" ? "|projection=mixed-ecosystems-v11-tooling-pyproject-fallback" : ""}`;
      const oldPath = join(
        getCacheDir(),
        `${repo.replaceAll("/", "-")}${phase === "facts" ? "" : `-${phase}`}-${createHash("sha256").update(oldSeed).digest("hex").slice(0, 16)}.json`
      );
      const bytes = await readFile(current.path);
      await writeFile(oldPath, bytes);
      await rm(current.path);
      expect(await readPhaseCache(phase, repo, sha)).toEqual({ hit: false });
      await writePhaseCache(phase, repo, sha, { marker: "contained" });
      expect(await readPhaseCache(phase, repo, sha)).toEqual({
        hit: true,
        value: { marker: "contained" },
      });
      expect(await readFile(oldPath)).toEqual(bytes);
    }
  );
});
