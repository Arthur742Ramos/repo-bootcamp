import { afterAll, describe, expect, it, vi } from "vitest";
import { cp, mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";
import type { BootcampOptions, RepoFacts, RepoInfo, ScanResult } from "../src/types.js";
import type { StyleConfig } from "../src/plugins.js";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const { mkdtemp } = await import("fs/promises");
  const { join } = await import("path");
  const home = await mkdtemp(join(actual.tmpdir(), "bootcamp-task-cache-home-"));
  return { ...actual, homedir: () => home };
});
const { analyzeRepoMock } = vi.hoisted(() => ({ analyzeRepoMock: vi.fn() }));
vi.mock("../src/agent.js", () => ({ analyzeRepo: analyzeRepoMock }));
import { orchestrateAnalysis } from "../src/services/analysis-orchestration.js";
import { scanRepo } from "../src/ingest.js";
import {
  getCacheDir,
  listCacheEntries,
  readPhaseCache,
  writePhaseCache,
  type AnalysisPhase,
} from "../src/cache.js";

afterAll(async () => {
  await rm(dirname(dirname(getCacheDir())), { recursive: true, force: true });
});

describe("pnpm workspace context with the real disk cache", () => {
  it("misses old selected-only facts and relevant workspace edits, then warms; excludes unrelated fields and temporary roots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pnpm-cache-repo-")),
      selected = join(dir, "packages/app"),
      copy = `${dir}-copy`;
    try {
      await mkdir(selected, { recursive: true });
      await writeFile(join(dir, "package.json"), '{"packageManager":"pnpm@11"}');
      await writeFile(join(selected, "package.json"), '{"scripts":{"test":"NEVER_RUN"}}');
      const options = {
        branch: "main",
        focus: "all",
        audience: "all",
        output: "out",
        maxFiles: 100,
        subdir: "packages/app",
        noClone: true,
        verbose: false,
      } as BootcampOptions;
      const repoInfo = {
        fullName: "owned/pnpm",
        commitSha: "same-sha",
        repo: "pnpm",
        owner: "owned",
        url: "https://github.com/owned/pnpm",
        branch: "main",
      } as RepoInfo;
      const facts = {
        quickstart: {
          commands: [],
          prerequisites: ["Keep"],
          steps: ["Keep"],
          commonErrors: [],
          sources: [],
        },
      } as unknown as RepoFacts;
      analyzeRepoMock.mockImplementation(async () => ({
        facts: structuredClone(facts),
        stats: { model: "offline-fixture", toolCalls: [] },
      }));
      const run = (scanResult: ScanResult) =>
        orchestrateAnalysis({
          repoPath: selected,
          repoInfo,
          scanResult,
          options,
          styleConfig: {} as StyleConfig,
          progress: { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any,
          analysisStart: Date.now(),
        });
      const scan = () => scanRepo(dir, 100, options);
      expect((await run(await scan())).model).toBe("offline-fixture"); // actual old selected-only cache
      expect((await run(await scan())).model).toBe("cache");
      const oldIdentity = (await listCacheEntries()).find(
        (entry) => entry.entry?.phase === "facts"
      )!.entry!.generationOptions;
      const phases: AnalysisPhase[] = ["deps", "security", "impact", "cycles"];
      for (const phase of phases)
        await writePhaseCache(
          phase,
          repoInfo.fullName,
          repoInfo.commitSha!,
          { old: phase },
          oldIdentity
        );
      await writeFile(join(dir, "pnpm-workspace.yaml"), "packages: ['packages/*']\n");
      const qualified = await scan();
      expect(qualified.stack.packageManager).toBe("pnpm");
      const fresh = await run(qualified);
      expect(fresh.model).toBe("offline-fixture");
      expect(fresh.facts.quickstart.commands[0].command).toBe("pnpm run test");
      expect(fresh.facts.quickstart.prerequisites).toEqual(["Keep"]);
      expect((await run(await scan())).model).toBe("cache");
      const newIdentity = (await listCacheEntries()).find(
        (entry) =>
          entry.entry?.phase === "facts" &&
          entry.entry.generationOptions.scanFingerprint !== oldIdentity.scanFingerprint
      )!.entry!.generationOptions;
      for (const phase of phases) {
        expect(
          (await readPhaseCache(phase, repoInfo.fullName, repoInfo.commitSha!, oldIdentity)).hit
        ).toBe(true);
        expect(
          (await readPhaseCache(phase, repoInfo.fullName, repoInfo.commitSha!, newIdentity)).hit
        ).toBe(false);
      }
      await writeFile(join(dir, "pnpm-workspace.yaml"), "packages: ['packages/*', 'apps/*']\n");
      const edited = await scan();
      expect(edited.commands).toEqual(qualified.commands);
      expect(edited.packageManagerContextFingerprint).not.toBe(
        qualified.packageManagerContextFingerprint
      );
      expect((await run(edited)).model).toBe("offline-fixture");
      expect((await run(await scan())).model).toBe("cache");
      await writeFile(
        join(dir, "package.json"),
        '{"packageManager":"pnpm@11","scripts":{"outside":"CHANGED"},"dependencies":{"outside":"1"}}'
      );
      await writeFile(
        join(dir, "pnpm-workspace.yaml"),
        "packages: ['packages/*', 'apps/*']\nregistry: https://example.invalid\n"
      );
      const unrelated = await scan();
      expect(unrelated.packageManagerContextFingerprint).toBe(
        edited.packageManagerContextFingerprint
      );
      expect((await run(unrelated)).model).toBe("cache");
      await cp(dir, copy, { recursive: true });
      expect((await scanRepo(copy, 100, options)).packageManagerContextFingerprint).toBe(
        edited.packageManagerContextFingerprint
      );
      expect((await run(await scanRepo(copy, 100, options))).model).toBe("cache");
      const excludedOptions = { ...options, exclude: ["pnpm-workspace.yaml"] };
      const excludedRun = async () =>
        orchestrateAnalysis({
          repoPath: selected,
          repoInfo,
          scanResult: await scanRepo(dir, 100, excludedOptions),
          options: excludedOptions,
          styleConfig: {} as StyleConfig,
          progress: { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any,
          analysisStart: Date.now(),
        });
      expect((await excludedRun()).model).toBe("offline-fixture");
      expect((await excludedRun()).model).toBe("cache");
      await writeFile(join(dir, "pnpm-workspace.yaml"), "packages: ['not-the-selected-package']\n");
      expect((await excludedRun()).model).toBe("cache");
      const explicit = {
        ...facts,
        quickstart: {
          ...facts.quickstart,
          commands: [{ name: "manual", command: "keep explicit", source: "README" }],
        },
      };
      analyzeRepoMock.mockResolvedValue({
        facts: explicit,
        stats: { model: "offline-fixture", toolCalls: [] },
      });
      const uncached = await orchestrateAnalysis({
        repoPath: selected,
        repoInfo,
        scanResult: edited,
        options: { ...options, noCache: true },
        styleConfig: {} as StyleConfig,
        progress: { update: vi.fn(), succeed: vi.fn(), recordToolCall: vi.fn() } as any,
        analysisStart: Date.now(),
      });
      expect(uncached.facts.quickstart.commands).toEqual(explicit.quickstart.commands);
    } finally {
      await Promise.all([dir, copy].map((path) => rm(path, { recursive: true, force: true })));
    }
  });
});
