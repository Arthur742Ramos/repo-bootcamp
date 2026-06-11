import { mkdtemp, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("init command", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("scaffolds a .bootcamprc.json and guards against overwrite", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-init-e2e-"));
    tempDirs.push(tempDir);

    const created = await runCli(["init"], {}, 60_000, tempDir);
    expect(created.exitCode).toBe(0);
    expect(created.stdout).toContain("Created");

    const configPath = join(tempDir, ".bootcamprc.json");
    expect(await exists(configPath)).toBe(true);
    const parsed = JSON.parse(await readFile(configPath, "utf-8"));
    expect(parsed).toHaveProperty("style");

    // Second run without --force must fail.
    const blocked = await runCli(["init"], {}, 60_000, tempDir);
    expect(blocked.exitCode).toBe(1);
    expect(`${blocked.stdout}\n${blocked.stderr}`).toContain("already exists");

    // With --force it succeeds again.
    const forced = await runCli(["init", "--force"], {}, 60_000, tempDir);
    expect(forced.exitCode).toBe(0);
  }, 90_000);

  it("prints config to stdout with --print without writing a file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-init-e2e-"));
    tempDirs.push(tempDir);

    const result = await runCli(["init", "--print"], {}, 60_000, tempDir);
    expect(result.exitCode).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(await exists(join(tempDir, ".bootcamprc.json"))).toBe(false);
  }, 60_000);

  it("presets the chosen style and writes to a custom path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-init-e2e-"));
    tempDirs.push(tempDir);

    const result = await runCli(
      ["init", "--style", "corporate", "--path", "bootcamp.config.json"],
      {},
      60_000,
      tempDir
    );
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(await readFile(join(tempDir, "bootcamp.config.json"), "utf-8"));
    expect(parsed.style).toBe("corporate");
  }, 60_000);

  it("rejects an invalid style", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bootcamp-init-e2e-"));
    tempDirs.push(tempDir);

    const result = await runCli(["init", "--style", "bogus"], {}, 60_000, tempDir);
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Invalid style");
  }, 60_000);
});
