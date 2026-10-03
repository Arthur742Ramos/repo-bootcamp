import { afterAll, describe, expect, it, vi } from "vitest";
import { dirname } from "path";
import { readFile, rm, writeFile } from "fs/promises";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const { mkdtemp } = await import("fs/promises");
  const { join } = await import("path");
  const home = await mkdtemp(join(actual.tmpdir(), "bootcamp-scope-cache-"));
  return { ...actual, homedir: () => home };
});

import {
  getCacheDir,
  getCacheVersion,
  listCacheEntries,
  readPhaseCache,
  writePhaseCache,
  type CachePhase,
} from "../src/cache.js";

const phases: CachePhase[] = ["facts", "deps", "security", "impact", "cycles"];
const scope = { maxFiles: 200, subdir: "", exclude: [] as string[], scanFingerprint: "" };

afterAll(async () => {
  await rm(dirname(dirname(getCacheDir())), { recursive: true, force: true });
});

describe("scan scope cache isolation", () => {
  it.each(phases)(
    "keeps %s results separate for directories, limits and exclusions",
    async (phase) => {
      const repo = `scope/${phase}`;
      await writePhaseCache(phase, repo, "same-sha", { source: "root" }, scope);
      const variants = [
        { ...scope, subdir: "packages/web" },
        { ...scope, maxFiles: 10 },
        { ...scope, exclude: ["**/fixtures/**"] },
        { ...scope, scanFingerprint: "different-effective-files" },
      ];
      for (const [index, variant] of variants.entries()) {
        expect(await readPhaseCache(phase, repo, "same-sha", variant)).toEqual({ hit: false });
        await writePhaseCache(phase, repo, "same-sha", { source: index }, variant);
        expect(await readPhaseCache(phase, repo, "same-sha", variant)).toEqual({
          hit: true,
          value: { source: index },
        });
      }
      expect(await readPhaseCache(phase, repo, "same-sha", scope)).toEqual({
        hit: true,
        value: { source: "root" },
      });
    }
  );

  it("reuses equivalent exclusion unions while preserving literal glob escapes", async () => {
    const options = { ...scope, exclude: ["**/b/**", "**/a/**", "**/a/**"] };
    await writePhaseCache("facts", "scope/order", "sha", "value", options);
    expect(
      await readPhaseCache("facts", "scope/order", "sha", {
        ...scope,
        exclude: ["**/a/**", "**/b/**"],
      })
    ).toEqual({ hit: true, value: "value" });
    await writePhaseCache("facts", "scope/escapes", "sha", "literal", {
      ...scope,
      exclude: [String.raw`\[docs\]/**`],
    });
    expect(
      await readPhaseCache("facts", "scope/escapes", "sha", { ...scope, exclude: ["[docs]/**"] })
    ).toEqual({ hit: false });
  });

  it("preserves distinct directory spelling and avoids generation-option delimiter collisions", async () => {
    await writePhaseCache("facts", "scope/spelling", "sha", "literal", {
      ...scope,
      subdir: String.raw`packages\web`,
    });
    expect(
      await readPhaseCache("facts", "scope/spelling", "sha", { ...scope, subdir: "packages/web" })
    ).toEqual({ hit: false });
    await writePhaseCache("facts", "scope/delimiter", "sha", "one", {
      focus: "all|style=oss",
      style: "",
    });
    expect(
      await readPhaseCache("facts", "scope/delimiter", "sha", { focus: "all", style: "oss|style=" })
    ).toEqual({ hit: false });
  });

  it.each([
    undefined,
    {},
    { ...scope, focus: "", style: "", model: "", audience: "", maxFiles: 0 },
    { ...scope, focus: "", style: "", model: "", audience: "", exclude: [17] },
  ])("rejects incomplete or malformed current identity: %j", async (identity) => {
    const repo = `scope/malformed-${String(identity?.maxFiles)}`;
    await writePhaseCache("facts", repo, "sha", "value");
    const summary = (await listCacheEntries()).find((entry) => entry.entry?.repoFullName === repo)!;
    const entry = JSON.parse(await readFile(summary.path, "utf-8"));
    entry.generationOptions = identity;
    await writeFile(summary.path, JSON.stringify(entry));
    expect(await readPhaseCache("facts", repo, "sha")).toEqual({ hit: false });
    expect((await listCacheEntries()).find((item) => item.file === summary.file)?.problem).toBe(
      "malformed"
    );
    await rm(summary.path);
  });

  it("rejects schema 2 entries and lists them as legacy", async () => {
    await writePhaseCache("facts", "scope/legacy", "sha", "old");
    const summary = (await listCacheEntries()).find(
      (entry) => entry.entry?.repoFullName === "scope/legacy"
    )!;
    const entry = JSON.parse(await readFile(summary.path, "utf-8"));
    entry.version = 2;
    delete entry.generationOptions;
    await writeFile(summary.path, JSON.stringify(entry));
    expect(getCacheVersion()).toBeGreaterThan(2);
    expect(await readPhaseCache("facts", "scope/legacy", "sha")).toEqual({ hit: false });
    expect((await listCacheEntries()).find((item) => item.file === summary.file)?.problem).toBe(
      "legacy"
    );
  });

  it("validates file limits before writing a scoped entry", async () => {
    await expect(
      writePhaseCache("facts", "scope/invalid", "sha", "value", { maxFiles: -1 })
    ).rejects.toThrow(/positive safe integer/);
  });

  it("stores the full scan identity in valid listings", async () => {
    const options = { ...scope, subdir: "packages/api", exclude: ["**/generated/**"] };
    await writePhaseCache("deps", "scope/listing", "sha", {}, options);
    expect(
      (await listCacheEntries()).find((entry) => entry.entry?.repoFullName === "scope/listing")
        ?.entry?.generationOptions
    ).toEqual({ focus: "", style: "", model: "", audience: "", ...options });
  });
});
