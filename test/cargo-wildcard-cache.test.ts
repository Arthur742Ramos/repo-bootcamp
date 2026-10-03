import { mkdir, mkdtemp, rename, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { expect, it, vi } from "vitest";
import type { BootcampOptions, RepoFacts, RepoInfo } from "../src/types.js";
import type { StyleConfig } from "../src/plugins.js";
import type { ProgressTracker } from "../src/progress.js";
const mocks = vi.hoisted(() => ({ analyze: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("../src/agent.js", () => ({ analyzeRepo: mocks.analyze }));
vi.mock("../src/analysis.js", () => ({ runParallelAnalysis: vi.fn() }));
vi.mock("../src/cache.js", () => ({ readCache: mocks.read, writeCache: mocks.write }));
import { scanRepo } from "../src/ingest.js";
import { orchestrateAnalysis } from "../src/services/analysis-orchestration.js";
it("uses topology-only negative changes in the real orchestration cache key and preserves warm facts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cargo-cache-topology-owned-"));
  try {
    await mkdir(join(dir, "crates/a/src"), { recursive: true });
    await mkdir(join(dir, "crates/b"));
    await writeFile(join(dir, "Cargo.toml"), '[workspace]\nmembers=["crates/*"]\n');
    await writeFile(
      join(dir, "crates/a/Cargo.toml"),
      '[package]\nname="owned_a"\nversion="0.1.0"\n'
    );
    await writeFile(join(dir, "crates/a/src/lib.rs"), "pub fn owned() {}\n");
    const options = {
      branch: "main",
      focus: "all",
      audience: "all",
      output: "out",
      maxFiles: 100,
      noClone: true,
      verbose: false,
      format: "markdown",
      exclude: ["crates/b/**", "crates/c/**"],
    } as BootcampOptions;
    const facts = { quickstart: { commands: [] } } as unknown as RepoFacts,
      entries = new Map<string, RepoFacts>();
    mocks.analyze.mockResolvedValue({ facts, stats: { toolCalls: [], model: "owned" } });
    mocks.read.mockImplementation(
      async (_repo, _sha, opts) => entries.get(opts.scanFingerprint) ?? null
    );
    mocks.write.mockImplementation(async (_repo, _sha, data, opts) => {
      entries.set(opts.scanFingerprint, data);
    });
    const progress = {
      succeed: vi.fn(),
      update: vi.fn(),
      recordToolCall: vi.fn(),
    } as unknown as ProgressTracker;
    const run = async () => {
      const scanResult = await scanRepo(dir, 100, { exclude: options.exclude });
      const result = await orchestrateAnalysis({
        repoPath: dir,
        repoInfo: { fullName: "owned/fixture", commitSha: "1".repeat(40) } as RepoInfo,
        scanResult,
        options,
        styleConfig: {} as StyleConfig,
        progress,
        analysisStart: Date.now(),
      });
      return { scanResult, result };
    };
    const first = await run(),
      warm = await run();
    expect(warm.result.model).toBe("cache");
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(warm.scanResult.cargoWorkspaceFingerprint).toBe(
      first.scanResult.cargoWorkspaceFingerprint
    );
    await rename(join(dir, "crates/b"), join(dir, "crates/c"));
    const changed = await run();
    expect(changed.scanResult.files).toEqual(first.scanResult.files);
    expect(changed.scanResult.cargoFingerprint).toBe(first.scanResult.cargoFingerprint);
    expect(changed.scanResult.commands).toEqual(first.scanResult.commands);
    expect(changed.scanResult.cargoWorkspaceFingerprint).not.toBe(
      first.scanResult.cargoWorkspaceFingerprint
    );
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(mocks.read.mock.calls[0][2].scanFingerprint).not.toBe(
      mocks.read.mock.calls[2][2].scanFingerprint
    );
    entries.set(mocks.read.mock.calls[2][2].scanFingerprint, {
      quickstart: {
        commands: [{ name: "documented", command: "cargo test --workspace", source: "README.md" }],
      },
    } as unknown as RepoFacts);
    const explicit = await run();
    expect(explicit.result.model).toBe("cache");
    expect(explicit.result.facts.quickstart.commands.map((t) => t.command)).toEqual([
      "cargo test --workspace",
    ]);
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
