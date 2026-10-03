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

describe("task discovery commands", () => {
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("reports commands from the selected Make and Compose files and commented Python headers", async () => {
    const dir = await repoWith({
      Makefile: "build:\n\t@echo wrong-file\n",
      GNUmakefile: "test:\n\t@echo selected-file\n",
      "docker-compose.yml": "services: {legacy: {image: nginx}}",
      "compose.yaml":
        'services: # local services\n  "web-app": {image: nginx, init: !!bool true, scale: !!int 2, command: !!binary ZWNobyBvaw==, x-date: !!timestamp 2026-01-01}\n',
      "pyproject.toml": '[project.scripts] # installed entry points\nserve = "app:main"\n',
    });
    const result = await runCli(["tasks", dir, "--json"]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.tasks.map((task: { command: string }) => task.command)).toEqual([
      "make test",
      "docker compose up web-app",
      "serve",
    ]);
    expect(payload.gettingStarted).toEqual(["make test", "serve"]);
    const report = await runCli(["tasks", dir]);
    expect(report.exitCode).toBe(0);
    expect(report.stdout).toContain("make test");
    expect(report.stdout).toContain("docker compose up web-app");
    expect(report.stdout).not.toContain("make build");
    expect(report.stdout).not.toContain("docker compose up legacy");
  }, 60_000);

  it("does not suggest fallback services when the selected Compose document is invalid", async () => {
    const dir = await repoWith({
      "compose.yaml": "services: [",
      "docker-compose.yml": "services: {legacy: {image: nginx}}",
    });
    const result = await runCli(["tasks", dir, "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ tasks: [], gettingStarted: [] });
  }, 60_000);

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
