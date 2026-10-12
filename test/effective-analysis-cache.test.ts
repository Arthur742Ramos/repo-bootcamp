import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { BootcampOptions } from "../src/types.js";
import type { StyleConfig } from "../src/plugins.js";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const { mkdtemp } = await import("node:fs/promises");
  const home = await mkdtemp(join(actual.tmpdir(), "bootcamp-effective-cache-home-"));
  return { ...actual, homedir: () => home };
});
import { getCacheDir, listCacheEntries, readPhaseCache, writePhaseCache } from "../src/cache.js";
import { resolveAnalysisInputs } from "../src/agent.js";
import { orchestrateAnalysis } from "../src/services/analysis-orchestration.js";
import { ProgressTracker } from "../src/progress.js";
import {
  makeOptions,
  makeRepoFacts,
  makeRepoInfo,
  makeScanResult,
  makeStyleConfig,
} from "./helpers/fixtures.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
afterAll(async () => {
  await rm(dirname(dirname(getCacheDir())), { recursive: true, force: true });
});
async function fixture() {
  const repoPath = await mkdtemp(join(tmpdir(), "bootcamp-effective-inputs-"));
  roots.push(repoPath);
  const responsePath = join(repoPath, "response.json");
  await writeFile(responsePath, JSON.stringify(makeRepoFacts({ purpose: "initial" })));
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE", responsePath);
  const repoInfo = makeRepoInfo({
    fullName: `cache/${repoPath.split(/[\\/]/).at(-1)}`,
    commitSha: "same-sha",
  });
  const options = makeOptions({ fast: true });
  const style = makeStyleConfig();
  const scanResult = makeScanResult();
  const run = (opts: Partial<BootcampOptions> = {}, resolvedStyle: StyleConfig = style) =>
    orchestrateAnalysis({
      repoPath,
      repoInfo,
      scanResult,
      options: { ...options, ...opts },
      styleConfig: resolvedStyle,
      progress: new ProgressTracker(false, true),
      analysisStart: Date.now(),
    });
  const sentinel = () =>
    vi.stubEnv("REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE", join(repoPath, "missing-response.json"));
  return { repoPath, repoInfo, responsePath, options, style, run, sentinel };
}

describe("effective analysis inputs with real facts cache and saved responses", () => {
  it("reuses identical inputs and output formats, and no-cache invokes the fixture sentinel", async () => {
    const { run, sentinel } = await fixture();
    expect((await run()).model).not.toBe("cache");
    sentinel();
    expect((await run()).model).toBe("cache");
    expect((await run({ format: "html" })).model).toBe("cache");
    await expect(run({ noCache: true })).rejects.toThrow(
      /Failed to read.*REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE/
    );
  });

  it("treats malformed facts as a miss and recovers via a fresh saved response", async () => {
    const { run, responsePath, repoInfo } = await fixture();
    await run();
    const current = (await listCacheEntries()).find(
      (candidate) =>
        candidate.entry?.phase === "facts" && candidate.entry.repoFullName === repoInfo.fullName
    )!;
    const raw = JSON.parse(await readFile(current.path, "utf8"));
    raw.value = { repoName: "malformed-cache-payload" };
    await writeFile(current.path, JSON.stringify(raw));
    await writeFile(responsePath, JSON.stringify(makeRepoFacts({ purpose: "recovered" })));
    const result = await run();
    expect(result.model).not.toBe("cache");
    expect(result.facts.purpose).toBe("recovered");
    expect((await run()).model).toBe("cache");
  });

  it("preserves successful facts when the cache destination is a directory", async () => {
    const { run, responsePath, repoInfo } = await fixture();
    await run();
    const entries = await listCacheEntries();
    const current = entries.find(
      (candidate) =>
        candidate.entry?.phase === "facts" && candidate.entry.repoFullName === repoInfo.fullName
    )!;
    await rm(current.path);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(current.path);
    await writeFile(
      responsePath,
      JSON.stringify(makeRepoFacts({ purpose: "write-failure-success" }))
    );
    expect((await run()).facts.purpose).toBe("write-failure-success");
  });

  it.each([
    ["system prompt", { systemPrompt: "New system guidance" }],
    ["full mode", { fast: false }],
  ] as const)("misses when %s changes", async (_, change) => {
    const { run, sentinel } = await fixture();
    await run();
    sentinel();
    await expect(run(change)).rejects.toThrow(/Failed to read/);
  });

  it.each([
    { tone: "formal" },
    { sectionDepth: "deep" },
    { firstTasksCount: 8 },
    { introText: "New intro" },
    { name: "academic" },
  ] satisfies Partial<StyleConfig>[])(
    "misses for resolved prompt style changes: %j",
    async (change) => {
      const { run, sentinel, style } = await fixture();
      await run();
      sentinel();
      await expect(run({}, { ...style, ...change })).rejects.toThrow(/Failed to read/);
    }
  );

  it("misses for prompt section settings but reuses output-only style settings", async () => {
    const { run, sentinel, style } = await fixture();
    await run();
    sentinel();
    expect(
      (
        await run(
          {},
          {
            ...style,
            emoji: true,
            description: "New output description",
            badges: { style: "shields" },
            sections: { ...style.sections, showMetrics: false, showHealth: false },
          }
        )
      ).model
    ).toBe("cache");
    await expect(
      run({}, { ...style, sections: { ...style.sections, showRunbook: false } })
    ).rejects.toThrow(/Failed to read/);
  });

  it("hashes effective external content, including same-path edits and equivalent paths", async () => {
    const { repoPath, run, sentinel, responsePath } = await fixture();
    const first = join(repoPath, "first.md"),
      second = join(repoPath, "second.md");
    await writeFile(first, "  guidance one  ");
    await writeFile(second, "guidance one");
    await run({ repoPrompts: first, systemPrompt: "  configured system  " });
    sentinel();
    expect((await run({ repoPrompts: second, systemPrompt: "configured system" })).model).toBe(
      "cache"
    );
    await writeFile(first, "guidance two");
    await expect(run({ repoPrompts: first, systemPrompt: "configured system" })).rejects.toThrow(
      /Failed to read/
    );
    vi.stubEnv("REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE", responsePath);
    await writeFile(responsePath, JSON.stringify(makeRepoFacts({ purpose: "fresh" })));
    expect(
      (await run({ repoPrompts: first, systemPrompt: "configured system" })).facts.purpose
    ).toBe("fresh");
  });

  it("normalizes full mode and falls back from a whitespace-only system prompt", async () => {
    const { repoPath, options, style } = await fixture();
    expect(resolveAnalysisInputs(repoPath, { ...options, fast: false }, style).fingerprint).toBe(
      resolveAnalysisInputs(repoPath, { ...options, fast: undefined, systemPrompt: "  " }, style)
        .fingerprint
    );
  });

  it.each(["deps", "security", "impact", "cycles"] as const)(
    "keeps %s phase identity exact when only analysis inputs change",
    async (phase) => {
      const repo = `effective-phase/${phase}`,
        sha = "unchanged";
      const initial = { analysisFingerprint: "old" };
      await writePhaseCache(phase, repo, sha, null, initial);
      const entry = (await listCacheEntries()).find((entry) => entry.entry?.repoFullName === repo)!;
      const projection =
        phase === "deps"
          ? "|projection=mixed-ecosystems-v12-contained-metadata"
          : phase === "security"
            ? "|projection=security-v1-contained-metadata"
            : "";
      const hash = createHash("sha256")
        .update(`${repo}@${sha}|phase=${phase}${projection}`)
        .digest("hex")
        .slice(0, 16);
      expect(entry.file).toBe(`${repo.replaceAll("/", "-")}-${phase}-${hash}.json`);
      const bytes = await readFile(entry.path);
      expect(await readPhaseCache(phase, repo, sha, { analysisFingerprint: "new" })).toEqual({
        hit: true,
        value: null,
      });
      expect(await readFile(entry.path)).toEqual(bytes);
    }
  );
});
