import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, it } from "vitest";
import { runCli } from "./helpers.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("offers complete public Taskfile commands in reports and getting-started guidance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-taskfile-e2e-"));
  dirs.push(dir);
  await writeFile(
    join(dir, "Taskfile.yml"),
    `version: '3'
tasks:
  app:build:
    desc: Build the application
    cmds: [echo built]
  "test:unit":
    desc: Run unit tests
    cmds: [echo tested]
  helper:
    internal: true
    cmds: [echo private]
  flow-helper: &private {internal: true, cmds: [echo private]}
  inherited-helper: {<<: *private}
  legacy-helper: {internal: yes, cmds: [echo private]}
  "--version": echo unintended
`
  );
  const json = await runCli(["tasks", dir, "--json"]);
  expect(json.exitCode).toBe(0);
  const payload = JSON.parse(json.stdout);
  expect(payload.tasks.map((task: { command: string }) => task.command)).toEqual([
    "task app:build",
    "task test:unit",
  ]);
  expect(payload.gettingStarted).toEqual(["task app:build", "task test:unit"]);
  const report = await runCli(["tasks", dir]);
  expect(report.exitCode).toBe(0);
  expect(report.stdout).toContain("task app:build");
  expect(report.stdout).toContain("task test:unit");
  expect(report.stdout).not.toContain("task helper");
  expect(report.stdout).not.toContain("task flow-helper");
}, 60_000);
