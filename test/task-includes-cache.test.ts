import { afterAll, describe, expect, it, vi } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
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

describe("local Task includes with the real disk cache", () => {
  it("reuses unchanged/scoped facts, invalidates same-length recipe edits and all phase identities, and preserves raw empty cache facts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bootcamp-task-cache-repo-"));
    const selected = join(dir, "packages", "app");
    const copy = `${dir}-copy`;
    try {
      await mkdir(selected, { recursive: true });
      await writeFile(join(dir, "Taskfile.yml"), "tasks: {outer: 'echo outer'}");
      await writeFile(
        join(selected, "Taskfile.yml"),
        "includes: {app: './child.yml', hidden: './hidden.yml'}"
      );
      await writeFile(join(selected, "child.yml"), "tasks: {test: 'echo test'}");
      await writeFile(join(selected, "hidden.yml"), "tasks: {private: 'echo private'}");
      const options: BootcampOptions = {
        branch: "main",
        focus: "all",
        audience: "all",
        output: "out",
        maxFiles: 100,
        noClone: true,
        verbose: false,
        subdir: "packages/app",
        exclude: ["hidden.yml"],
      };
      const repoInfo = {
        fullName: "task/cache",
        commitSha: "unchanged-sha",
        repo: "cache",
        owner: "task",
        url: "https://github.com/task/cache",
        branch: "main",
      } as RepoInfo;
      const facts = {
        repoName: "task/cache",
        firstTasks: [],
        quickstart: {
          prerequisites: ["Task 3"],
          steps: ["Read setup docs"],
          commands: [],
          commonErrors: [],
          sources: ["README.md"],
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
      const firstScan = await scan();
      const cold = await run(firstScan);
      expect(cold.model).toBe("offline-fixture");
      expect(cold.facts.quickstart.commands.map((command) => command.command)).toEqual([
        "task app:test",
      ]);
      const repeatedScan = await scan();
      expect(repeatedScan.taskfileFingerprint).toBe(firstScan.taskfileFingerprint);
      expect((await run(repeatedScan)).model).toBe("cache");
      expect(analyzeRepoMock).toHaveBeenCalledTimes(1);
      const entry = (await listCacheEntries()).find(
        (item) => item.entry?.repoFullName === "task/cache"
      )!;
      const originalIdentity = entry.entry!.generationOptions;
      expect(JSON.parse(await readFile(entry.path, "utf8")).value.quickstart.commands).toEqual([]);
      const phases: AnalysisPhase[] = ["deps", "security", "impact", "cycles"];
      for (const phase of phases) {
        await writePhaseCache(
          phase,
          "task/cache",
          "unchanged-sha",
          { fixture: phase },
          originalIdentity
        );
        expect(
          (await readPhaseCache(phase, "task/cache", "unchanged-sha", originalIdentity)).hit
        ).toBe(true);
      }
      await writeFile(join(selected, "child.yml"), "tasks: {test: 'echo best'}");
      const changedScan = await scan();
      expect(changedScan.commands).toEqual(firstScan.commands);
      expect(changedScan.files).toEqual(firstScan.files);
      expect(changedScan.taskfileFingerprint).not.toBe(firstScan.taskfileFingerprint);
      expect((await run(changedScan)).model).toBe("offline-fixture");
      expect(analyzeRepoMock).toHaveBeenCalledTimes(2);
      const changedIdentity = (await listCacheEntries()).find(
        (item) =>
          item.entry?.phase === "facts" &&
          item.entry.generationOptions.scanFingerprint !== originalIdentity.scanFingerprint
      )!.entry!.generationOptions;
      for (const phase of phases)
        expect(
          (await readPhaseCache(phase, "task/cache", "unchanged-sha", changedIdentity)).hit
        ).toBe(false);
      await writeFile(join(selected, "hidden.yml"), "tasks: {hidden: 'echo changed'}");
      await writeFile(join(dir, "Taskfile.yml"), "tasks: {parent: 'echo changed'}");
      const hiddenEdit = await scan();
      expect(hiddenEdit.taskfileFingerprint).toBe(changedScan.taskfileFingerprint);
      expect((await run(hiddenEdit)).model).toBe("cache");
      await cp(dir, copy, { recursive: true });
      const copiedScan = await scanRepo(copy, 100, options);
      expect(copiedScan.taskfileFingerprint).toBe(hiddenEdit.taskfileFingerprint);
      expect((await run(copiedScan)).model).toBe("cache");
      expect(analyzeRepoMock).toHaveBeenCalledTimes(2);
      expect(facts.quickstart.commands).toEqual([]);
    } finally {
      await Promise.all([dir, copy].map((path) => rm(path, { recursive: true, force: true })));
    }
  });
});
