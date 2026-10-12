import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { analyzeFrameworkDocs, analyzeVersionMismatches } from "../src/docs-analyzer.js";
import { updateVersionNumbers } from "../src/docs-fixer.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeRepo, createFixtureLlmClient, readCustomPrompt } from "../src/agent.js";
import type { BootcampOptions, LlmClient } from "../src/types.js";
import { runbookFacts } from "./helpers/runbook-facts.js";
import { gatherRequirements } from "../src/commands/preflight-command.js";
import { extractDependencies } from "../src/deps.js";
import { runParallelAnalysis } from "../src/analysis.js";
import { scanRepo } from "../src/ingest.js";
import {
  MAX_CONTAINED_FILE_BYTES,
  readContainedFile,
  readContainedFileSync,
} from "../src/fs-safe.js";

const manifests = [
  ["package.json", '{"dependencies":{"outside_fixture_marker":"9.8.7","helmet":"8"}}'],
  ["Cargo.toml", '[dependencies]\noutside_fixture_marker = "9.8.7"'],
  ["pyproject.toml", '[project]\ndependencies = ["outside_fixture_marker==9.8.7"]'],
  ["requirements.txt", "outside_fixture_marker==9.8.7"],
  ["go.mod", "module fixture\nrequire outside_fixture_marker v9.8.7"],
] as const;
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bootcamp-contained-metadata-"));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  return { root, repo };
}

describe("implicit manifest containment", () => {
  it.each(manifests)(
    "rejects outside %s links, including selected subdirectories",
    async (name, text) => {
      const { root, repo } = await fixture();
      await writeFile(join(root, name), text);
      await symlink(join(root, name), join(repo, name), "file");
      expect(await extractDependencies(repo)).toBeNull();
      const selected = join(repo, "selected");
      await mkdir(selected);
      await symlink(join(root, name), join(selected, name), "file");
      expect(await extractDependencies(selected)).toBeNull();
      await rm(join(selected, name));
      await writeFile(join(repo, "sibling-manifest"), text);
      await symlink(join(repo, "sibling-manifest"), join(selected, name), "file");
      expect(await extractDependencies(selected)).toBeNull();
    }
  );

  it.each(manifests)("accepts contained %s aliases and a symlinked root", async (name, text) => {
    const { root, repo } = await fixture();
    await writeFile(join(repo, "metadata"), text);
    await symlink(join(repo, "metadata"), join(repo, name), "file");
    expect((await extractDependencies(repo))?.runtime[0].name).toBe("outside_fixture_marker");
    const alias = join(root, "alias");
    await symlink(repo, alias, process.platform === "win32" ? "junction" : "dir");
    expect(await extractDependencies(alias)).toEqual(await extractDependencies(repo));
  });

  it.each(manifests)("rejects broken, nonregular and oversized %s metadata", async (name) => {
    const { root, repo } = await fixture();
    const path = join(repo, name);
    await symlink(join(root, "missing"), path, "file");
    expect(await extractDependencies(repo)).toBeNull();
    await rm(path);
    await mkdir(path);
    expect(await extractDependencies(repo)).toBeNull();
    await rm(path, { recursive: true });
    const file = await open(path, "w");
    await file.truncate(MAX_CONTAINED_FILE_BYTES + 1);
    await file.close();
    expect(await extractDependencies(repo)).toBeNull();
    await expect(readContainedFile(repo, name)).rejects.toThrow(/cap/);
    expect(() => readContainedFileSync(repo, name)).toThrow(/cap/);
  });

  it("does not retain outside package security evidence in parallel analysis", async () => {
    const { root, repo } = await fixture();
    await writeFile(join(root, "package.json"), manifests[0][1]);
    await symlink(join(root, "package.json"), join(repo, "package.json"), "file");
    const result = await runParallelAnalysis(repo, await scanRepo(repo, 100));
    expect(result.deps).toBeNull();
    expect(result.security.securityDeps).toEqual([]);
  });

  it("retains Python precedence and safe fallback after rejecting an outside pyproject", async () => {
    const { root, repo } = await fixture();
    await writeFile(join(root, "pyproject.toml"), manifests[2][1]);
    await symlink(join(root, "pyproject.toml"), join(repo, "pyproject.toml"), "file");
    await writeFile(join(repo, "requirements.txt"), "inside_fixture_marker==1.2.3");
    expect((await extractDependencies(repo))?.runtime).toEqual([
      { name: "inside_fixture_marker", version: "1.2.3", type: "runtime" },
    ]);
  });

  it("bounds workspace manifest reads while retaining directory-name fallback", async () => {
    const { repo } = await fixture();
    await mkdir(join(repo, "packages", "a"), { recursive: true });
    await writeFile(join(repo, "package.json"), '{"workspaces":["packages/*"]}');
    const path = join(repo, "packages", "a", "package.json");
    await writeFile(path, '{"name":"oversized_fixture_marker"}');
    const file = await open(path, "r+");
    await file.truncate(MAX_CONTAINED_FILE_BYTES + 1);
    await file.close();
    expect((await scanRepo(repo, 100)).monorepo?.workspacePackages).toEqual([
      { name: "a", path: "packages/a" },
    ]);
  });

  it("contains documentation manifest and README lookups, retaining safe README fallback", async () => {
    const { root, repo } = await fixture();
    const outside = join(root, "README.md");
    const bytes = "# Outside fixture\nNode.js 18\n";
    await writeFile(outside, bytes);
    await writeFile(
      join(root, "package.json"),
      '{"engines":{"node":">=24"},"dependencies":{"express":"5"}}'
    );
    await symlink(outside, join(repo, "README.md"), "file");
    await symlink(join(root, "package.json"), join(repo, "package.json"), "file");
    expect(await analyzeVersionMismatches(repo)).toEqual([]);
    expect(await analyzeFrameworkDocs(repo)).toEqual([]);
    const mismatches = [
      { type: "node" as const, documented: "18", actual: ">=24", location: "README.md" },
    ];
    expect((await updateVersionNumbers(repo, mismatches)).success).toBe(false);
    expect(await readFile(outside, "utf8")).toBe(bytes);
    // Case variants are the same entry on Windows; replace the refused link
    // for the legitimate control there, while Linux exercises fallback order.
    if (process.platform === "win32") await rm(join(repo, "README.md"));
    await writeFile(join(repo, "readme.md"), "# Inside fixture\nNode.js 18\n");
    expect((await updateVersionNumbers(repo, mismatches)).success).toBe(true);
    expect(await readFile(join(repo, "readme.md"), "utf8")).toContain("Node.js 24");
    expect(await readFile(outside, "utf8")).toBe(bytes);
  });
});

describe("default repository prompt containment", () => {
  it.each([true, false])(
    "keeps outside metadata out of actual model input (fast=%s)",
    async (fast) => {
      const { root, repo } = await fixture();
      await writeFile(join(root, "package.json"), manifests[0][1]);
      await writeFile(join(root, "entry.ts"), "outside_fixture_marker");
      await writeFile(join(root, "guidance.md"), "outside_fixture_marker");
      await symlink(join(root, "package.json"), join(repo, "package.json"), "file");
      await symlink(join(root, "entry.ts"), join(repo, "index.ts"), "file");
      await symlink(join(root, "guidance.md"), join(repo, ".bootcamp-prompts.md"), "file");
      await writeFile(join(repo, "README.md"), "inside_fixture_control");
      const inputs: string[] = [];
      const fixtureClient = createFixtureLlmClient(JSON.stringify(runbookFacts()));
      const client: LlmClient = {
        async createSession(config) {
          inputs.push(config.systemMessage?.content ?? "");
          const session = await fixtureClient.createSession(config);
          return {
            ...session,
            async sendAndWait(input, timeout) {
              inputs.push(input.prompt);
              return session.sendAndWait(input, timeout);
            },
          };
        },
        stop: () => fixtureClient.stop(),
      };
      const options: BootcampOptions = {
        branch: "main",
        focus: "all",
        audience: "all",
        output: "unused",
        maxFiles: 100,
        noClone: true,
        verbose: false,
        quiet: true,
        fast,
      };
      const repoInfo = {
        owner: "local",
        repo: "fixture",
        fullName: "local/fixture",
        url: "file://fixture",
        branch: "main",
      };
      await analyzeRepo(repo, repoInfo, await scanRepo(repo, 100), options, undefined, undefined, {
        client,
      });
      expect(inputs.join("\n")).not.toContain("outside_fixture_marker");
      if (fast) expect(inputs.join("\n")).toContain("inside_fixture_control");
      inputs.length = 0;
      await analyzeRepo(
        repo,
        repoInfo,
        await scanRepo(repo, 100),
        { ...options, repoPrompts: join(root, "guidance.md") },
        undefined,
        undefined,
        { client }
      );
      expect(inputs.join("\n")).toContain("outside_fixture_marker");
    }
  );

  it("rejects outside guidance but preserves an explicit outside override", async () => {
    const { root, repo } = await fixture();
    const outside = join(root, "guidance.md");
    await writeFile(outside, " outside_fixture_marker ");
    await symlink(outside, join(repo, ".bootcamp-prompts.md"), "file");
    expect(readCustomPrompt(repo)).toBeNull();
    expect(readCustomPrompt(repo, outside)).toBe("outside_fixture_marker");
  });

  it("preserves trim, contained aliases, empty and 8000-character limits", async () => {
    const { repo } = await fixture();
    const metadata = join(repo, "guidance.md");
    await writeFile(metadata, "  inside guidance  ");
    await symlink(metadata, join(repo, ".bootcamp-prompts.md"), "file");
    expect(readCustomPrompt(repo)).toBe("inside guidance");
    await writeFile(metadata, " ");
    expect(readCustomPrompt(repo)).toBeNull();
    await writeFile(metadata, "x".repeat(9000));
    expect(readCustomPrompt(repo)).toBe("x".repeat(8000));
  });

  it("rejects broken, nonregular and oversized default guidance", async () => {
    const { root, repo } = await fixture();
    const path = join(repo, ".bootcamp-prompts.md");
    await symlink(join(root, "missing"), path, "file");
    expect(readCustomPrompt(repo)).toBeNull();
    await rm(path);
    await mkdir(path);
    expect(readCustomPrompt(repo)).toBeNull();
    await rm(path, { recursive: true });
    const file = await open(path, "w");
    await file.truncate(MAX_CONTAINED_FILE_BYTES + 1);
    await file.close();
    expect(readCustomPrompt(repo)).toBeNull();
  });

  it("does not infer preflight or security settings from outside fixed metadata", async () => {
    const { root, repo } = await fixture();
    await writeFile(join(root, "package.json"), '{"engines":{"node":"9.8.7"}}');
    await writeFile(join(root, ".gitignore"), ".env\n*.pem\n");
    await symlink(join(root, "package.json"), join(repo, "package.json"), "file");
    await symlink(join(root, ".gitignore"), join(repo, ".gitignore"), "file");
    expect(await gatherRequirements(repo)).toEqual([]);
    const result = await runParallelAnalysis(repo, await scanRepo(repo, 100));
    expect(result.security.secretsHandling.gitignoreSecrets).toBe(false);
  });
});
