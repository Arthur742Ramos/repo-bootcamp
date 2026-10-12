import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers.js";
import { runbookFacts } from "../helpers/runbook-facts.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bootcamp-metadata-cli-"));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  await writeFile(join(repo, "README.md"), "# Contained fixture\n");
  const response = join(root, "response.json");
  await writeFile(response, JSON.stringify(runbookFacts()));
  const env = {
    NODE_ENV: "test",
    HOME: join(root, "home"),
    REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response,
  };
  return { root, repo, env };
}

describe("actual CLI metadata containment", () => {
  it("does not project outside dependencies or security evidence", async () => {
    const { root, repo, env } = await fixture();
    await writeFile(join(root, "requirements.txt"), "outside_fixture_marker==9.8.7");
    await writeFile(join(root, "package.json"), '{"dependencies":{"helmet":"8"}}');
    await symlink(join(root, "requirements.txt"), join(repo, "requirements.txt"), "file");
    await symlink(join(root, "package.json"), join(repo, "package.json"), "file");
    const deps = await runCli(["deps", repo, "--json"], env);
    expect(deps.exitCode).toBe(0);
    expect(deps.stdout).not.toContain("outside_fixture_marker");
    for (const command of ["security", "scan", "radar"]) {
      const result = await runCli([command, repo, "--json"], env);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('"helmet"');
    }
    await rm(join(repo, "requirements.txt"));
    await writeFile(join(repo, "requirements.txt"), "inside_fixture_marker==1.2.3");
    const control = await runCli(["deps", repo, "--json"], env);
    expect(control.exitCode).toBe(0);
    expect(control.stdout).toContain("inside_fixture_marker");
  });

  it("generates saved-response output with rejected default guidance and honors explicit guidance", async () => {
    const { root, repo, env } = await fixture();
    const prompt = join(root, "guidance.md");
    await writeFile(prompt, "outside_fixture_marker");
    await symlink(prompt, join(repo, ".bootcamp-prompts.md"), "file");
    const output = join(root, "output");
    const base = [repo, "--no-clone", "--output", output, "--fast", "--no-cache"];
    const rejected = await runCli(base, env);
    expect(rejected.exitCode, rejected.stderr).toBe(0);
    expect(rejected.stdout).not.toContain("Custom prompts loaded");
    expect(JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8")).purpose).toBe(
      runbookFacts().purpose
    );
    const explicit = await runCli([...base, "--repo-prompts", prompt], env);
    expect(explicit.exitCode).toBe(0);
    expect(explicit.stdout).toContain("Custom prompts loaded");
    await rm(join(repo, ".bootcamp-prompts.md"));
    await writeFile(join(repo, ".bootcamp-prompts.md"), "inside guidance");
    const contained = await runCli(base, env);
    expect(contained.exitCode).toBe(0);
    expect(contained.stdout).toContain("Custom prompts loaded");
  });

  it("ignores outside CODEOWNERS and falls back to a contained location", async () => {
    const { root, repo, env } = await fixture();
    await mkdir(join(repo, ".github"));
    await writeFile(join(root, "owners"), "* @outside_fixture_marker\n");
    await symlink(join(root, "owners"), join(repo, ".github", "CODEOWNERS"), "file");
    await writeFile(join(repo, "CODEOWNERS"), "* @inside_fixture_control\n");
    const result = await runCli(["owners", repo, "--json"], env);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("outside_fixture_marker");
    expect(result.stdout).toContain("inside_fixture_control");
  });
});
