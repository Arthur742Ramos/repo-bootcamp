import { execFileSync } from "child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runPublishCommand } from "../src/commands/publish-command.js";

const temporaryDirectories: string[] = [];

async function createGitRepo(): Promise<{ repo: string; kit: string }> {
  const root = await mkdtemp(join(tmpdir(), "bootcamp-publish-"));
  temporaryDirectories.push(root);
  const repo = join(root, "repo");
  const kit = join(root, "kit");
  await mkdir(repo, { recursive: true });
  await mkdir(kit, { recursive: true });
  await writeFile(join(repo, "README.md"), "# Existing repository\n", "utf8");
  await writeFile(join(kit, "BOOTCAMP.md"), "# Generated onboarding\n", "utf8");
  await writeFile(join(kit, "ANALYSIS_MANIFEST.json"), '{"schemaVersion":1}\n', "utf8");
  await writeFile(join(kit, "notes.txt"), "This file is intentionally not publishable.\n", "utf8");

  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Repo Bootcamp Test"], { cwd: repo });
  execFileSync("git", ["add", "README.md"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], { cwd: repo, stdio: "ignore" });
  return { repo, kit };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("publish command", () => {
  it("previews by default and applies a kit only with an explicit branch action", async () => {
    const { repo, kit } = await createGitRepo();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runPublishCommand(repo, kit);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Dry run only"));
    expect(
      execFileSync("git", ["branch", "--show-current"], { cwd: repo, encoding: "utf8" }).trim()
    ).toBe("main");
    await expect(readFile(join(repo, "BOOTCAMP.md"), "utf8")).rejects.toThrow();

    await runPublishCommand(repo, kit, { apply: true, branch: "bootcamp/test-kit" });

    expect(
      execFileSync("git", ["branch", "--show-current"], { cwd: repo, encoding: "utf8" }).trim()
    ).toBe("bootcamp/test-kit");
    expect(await readFile(join(repo, "BOOTCAMP.md"), "utf8")).toContain("Generated onboarding");
    expect(await readFile(join(repo, "ANALYSIS_MANIFEST.json"), "utf8")).toContain("schemaVersion");
    expect(
      execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: repo, encoding: "utf8" }).trim()
    ).toBe("docs: refresh Repo Bootcamp onboarding kit");
    expect(await readFile(join(kit, "notes.txt"), "utf8")).toContain("not publishable");
  });

  it("refuses to apply into a dirty checkout", async () => {
    const { repo, kit } = await createGitRepo();
    await writeFile(join(repo, "README.md"), "# Local edits\n", "utf8");

    await expect(
      runPublishCommand(repo, kit, { apply: true, branch: "bootcamp/dirty" })
    ).rejects.toThrow("uncommitted changes");
    expect(
      execFileSync("git", ["branch", "--show-current"], { cwd: repo, encoding: "utf8" }).trim()
    ).toBe("main");
  });
});
