import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoFacts } from "../../src/types.js";
import { runCli } from "./helpers.js";
const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const facts: RepoFacts = {
  repoName: "owned/plugin-fixture",
  purpose: "Owned plugin path fixture",
  description: "Local plugin loading",
  confidence: "high",
  sources: ["README.md"],
  stack: {
    languages: ["TypeScript"],
    frameworks: [],
    buildSystem: "npm",
    packageManager: "npm",
    hasDocker: false,
    hasCi: false,
  },
  quickstart: {
    prerequisites: ["Node.js 20+"],
    steps: ["npm test"],
    commands: [{ name: "test", command: "npm test", source: "package.json" }],
    commonErrors: [],
    sources: ["README.md"],
  },
  structure: {
    keyDirs: [{ path: "src", purpose: "Source", keyFiles: ["src/app.ts"] }],
    entrypoints: [{ path: "src/app.ts", type: "main", description: "Fixture" }],
    testDirs: [],
    docsDirs: [],
    sources: ["src/app.ts"],
  },
  ci: { workflows: [], mainChecks: [], sources: [] },
  contrib: { howToAddFeature: [], howToAddTest: [], codeStyle: "TypeScript", sources: [] },
  architecture: {
    overview: "Owned fixture",
    components: [],
    dataFlow: "Fixture",
    keyAbstractions: [],
    codeExamples: [],
    sources: ["src/app.ts"],
  },
  firstTasks: [],
  runbook: { applicable: false, deploySteps: [], observability: [], incidents: [], sources: [] },
};
const formatter = (name: string) =>
  `export default {type:'formatter',name:${JSON.stringify(name)},formatDocuments:async docs=>[...docs,{name:'PLUGIN.md',content:${JSON.stringify(name)}}]};`;
describe("local plugin paths in the actual CLI", () => {
  it.each(["absolute", "relative", "file-url"])(
    "loads exact space/hash/percent formatter paths from %s configuration",
    async (kind) => {
      const root = await mkdtemp(join(tmpdir(), "bootcamp-plugin-cli-"));
      tempDirs.push(root);
      const repo = join(root, "repository");
      await mkdir(join(repo, "src"), { recursive: true });
      await writeFile(join(repo, "src", "app.ts"), "export const fixture = true;\n");
      await writeFile(join(repo, "README.md"), "# Owned plugin fixture\n");
      await writeFile(
        join(repo, "package.json"),
        JSON.stringify({ name: "owned-plugin-fixture", scripts: { test: "echo owned" } })
      );
      const response = join(root, "response.json");
      await writeFile(response, JSON.stringify(facts));
      // A raw URL fragment would incorrectly import this existing neighbor.
      await writeFile(join(root, "formatter.mjs"), formatter("wrong-prefix-plugin"));
      const intended = join(root, "formatter.mjs#copy %.mjs");
      await writeFile(intended, formatter("intended-literal-plugin"));
      const specifier =
        kind === "absolute"
          ? intended
          : kind === "relative"
            ? "./formatter.mjs#copy %.mjs"
            : pathToFileURL(intended).href;
      await writeFile(join(root, ".bootcamprc.json"), JSON.stringify({ plugins: [specifier] }));
      const output = join(root, "output");
      const result = await runCli(
        [repo, "--no-clone", "--no-cache", "--quiet", "--output", output],
        { NODE_ENV: "test", REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response },
        60_000,
        root
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Loaded plugin: intended-literal-plugin");
      expect(result.stdout).not.toContain("wrong-prefix-plugin");
      expect(result.stderr).not.toContain("Failed to load plugin");
      expect(await readFile(join(output, "PLUGIN.md"), "utf8")).toBe("intended-literal-plugin");
      expect(await readdir(output)).toEqual(
        expect.arrayContaining(["BOOTCAMP.md", "ONBOARDING.md", "repo_facts.json"])
      );
      expect(await readFile(join(output, "ONBOARDING.md"), "utf8")).toContain("npm test");
    }
  );
});
