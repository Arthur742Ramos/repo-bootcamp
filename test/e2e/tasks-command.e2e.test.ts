import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./helpers.js";

const dirs: string[] = [];
async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-tasks-e2e-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("task discovery package managers", () => {
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it.each(["npm", "pnpm", "yarn", "bun"])(
    "uses declared %s for runnable and getting-started commands",
    async (manager) => {
      const dir = await repoWith({
        "package.json": JSON.stringify({
          name: "fixture",
          packageManager: `${manager}@1.0.0`,
          scripts: { build: "tsc", test: "vitest" },
        }),
        "yarn.lock": "stale lockfile",
        "pnpm-lock.yaml": "stale lockfile",
      });
      const result = await runCli(["tasks", dir, "--json"]);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.tasks.map((task: { command: string }) => task.command)).toEqual([
        `${manager} run build`,
        `${manager} run test`,
      ]);
      expect(payload.gettingStarted).toEqual([`${manager} run build`, `${manager} run test`]);
    },
    60_000
  );

  it.each(["bun.lock", "bun.lockb"])(
    "discovers Bun script commands from %s",
    async (lockfile) => {
      const dir = await repoWith({
        "package.json": JSON.stringify({ name: "fixture", scripts: { test: "bun test" } }),
        [lockfile]: "lockfile",
      });
      const result = await runCli(["tasks", dir, "--json"]);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.tasks[0]).toMatchObject({
        command: "bun run test",
        source: "package.json",
        category: "test",
      });
      expect(payload.gettingStarted).toEqual(["bun run test"]);
    },
    60_000
  );
});
