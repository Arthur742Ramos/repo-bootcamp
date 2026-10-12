import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers.js";
import { makeRepoFacts } from "../helpers/fixtures.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bootcamp-effective-cli-"));
  roots.push(root);
  const repo = join(root, "repo"),
    output = join(root, "output"),
    home = join(root, "home");
  await mkdir(repo);
  await mkdir(home);
  await writeFile(join(repo, "README.md"), "# Clean owned cache fixture\n");
  const git = (args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git(["init", "-b", "main"]);
  git(["add", "README.md"]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "-m",
    "Fixture",
    "--no-gpg-sign",
  ]);
  const response = join(root, "response.json"),
    missing = join(root, "missing-response.json");
  await writeFile(response, JSON.stringify(makeRepoFacts({ purpose: "initial" })));
  const env = { NODE_ENV: "test", HOME: home, REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response };
  const run = (args: string[] = [], responsePath = response, fast = true) =>
    runCli(
      [
        repo,
        "--no-clone",
        "--output",
        output,
        ...(args.includes("--verbose") ? [] : ["--quiet"]),
        ...(fast ? ["--fast"] : []),
        ...args,
      ],
      { ...env, REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: responsePath },
      60_000,
      root
    );
  const facts = async () => JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8"));
  const configure = (config: unknown) =>
    writeFile(join(root, ".bootcamprc.json"), JSON.stringify(config));
  return { root, repo, output, home, response, missing, run, facts, configure };
}

describe("actual CLI effective facts reuse", () => {
  it("recovers from malformed cached facts", async () => {
    const { home, response, run, facts } = await fixture();
    expect((await run()).exitCode).toBe(0);
    const cache = join(home, ".cache", "repo-bootcamp");
    for (const name of await readdir(cache)) {
      const path = join(cache, name);
      const entry = JSON.parse(await readFile(path, "utf8"));
      if (entry.phase !== "facts") continue;
      entry.value = { repoName: "malformed-cache-payload" };
      await writeFile(path, JSON.stringify(entry));
    }
    await writeFile(response, JSON.stringify(makeRepoFacts({ purpose: "recovered" })));
    const result = await run();
    expect(result.exitCode, result.stderr).toBe(0);
    expect((await facts()).purpose).toBe("recovered");
  });

  it("returns successful CLI output when cache mkdir fails, and retains real output failures", async () => {
    const { home, output, run, facts } = await fixture();
    await writeFile(join(home, ".cache"), "owned regular-file cache blocker");
    const result = await run(["--verbose"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect((await facts()).purpose).toBe("initial");
    expect(result.stderr).toContain("[cache] Could not persist analysis cache");
    expect(result.stderr).not.toContain("copilot auth");
    await rm(output, { recursive: true });
    await writeFile(output, "owned regular-file output blocker");
    const failedOutput = await run();
    expect(failedOutput.exitCode).toBe(1);
  });

  it("hits identical/format-only runs and misses mode, system, custom style and same-path external edits", async () => {
    const { root, response, missing, run, facts, configure } = await fixture();
    expect((await run()).exitCode).toBe(0);
    expect((await facts()).purpose).toBe("initial");
    const hit = await run(["--format", "html"], missing);
    expect(hit.exitCode, hit.stderr).toBe(0);
    expect((await facts()).purpose).toBe("initial");
    const mode = await run([], missing, false);
    expect(mode.exitCode).toBe(1);
    expect(mode.stderr).toContain("REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE");
    await configure({ prompts: { system: "New system prompt" } });
    const system = await run([], missing);
    expect(system.exitCode).toBe(1);
    expect(system.stderr).toContain("REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE");
    await configure({ customStyle: { tone: "formal" } });
    const style = await run([], missing);
    expect(style.exitCode).toBe(1);
    expect(style.stderr).toContain("REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE");
    await configure({});
    const prompt = join(root, "external.md"),
      equivalent = join(root, "equivalent.md");
    await writeFile(prompt, "External one");
    await writeFile(equivalent, "External one");
    expect((await run(["--repo-prompts", prompt], missing)).exitCode).toBe(1);
    await writeFile(response, JSON.stringify(makeRepoFacts({ purpose: "external-one" })));
    expect((await run(["--repo-prompts", prompt])).exitCode).toBe(0);
    expect((await facts()).purpose).toBe("external-one");
    expect((await run(["--repo-prompts", equivalent], missing)).exitCode).toBe(0);
    await writeFile(prompt, "External two");
    const edited = await run(["--repo-prompts", prompt], missing);
    expect(edited.exitCode).toBe(1);
    expect(edited.stderr).toContain("REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE");
    expect((await run(["--no-cache"], missing)).exitCode).toBe(1);
  });
});
