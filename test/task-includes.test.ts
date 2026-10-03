import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fsSafe from "../src/fs-safe.js";
import { scanRepo } from "../src/ingest.js";
import { discoverTasks, parseTaskfile } from "../src/tasks.js";

const dirs: string[] = [];
async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-task-includes-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}
const child =
  "version: '3'\ntasks:\n  build: {desc: Build app, cmds: [echo build]}\n  test: {desc: Test app, cmds: [echo test]}\n  default: {desc: Default workflow, cmds: [echo default]}\n  helper: {internal: true, cmds: [echo hidden]}\n";
const commands = async (dir: string) => (await discoverTasks(dir)).map((task) => task.command);
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("bounded local Taskfile discovery", () => {
  it("discovers nested canonical namespaces, defaults, and descriptions without changing the pure parser", async () => {
    const root =
      "version: '3'\nincludes:\n  app: ./task files/app.yml\n  private: {taskfile: ./private.yml, internal: yes}\ntasks:\n  default: {cmds: [echo root]}\n  public: {desc: Public root, cmds: [echo public]}\n";
    const dir = await fixture({
      "Taskfile.yml": root,
      "task files/app.yml": child + "includes:\n  tools: ../shared.yml\n",
      "shared.yml": "tasks:\n  lint: {desc: Shared lint, cmds: [echo lint]}\n",
      "private.yml": "tasks: {hidden: 'echo private'}",
    });
    expect(parseTaskfile(root).map((task) => task.command)).toEqual(["task public"]);
    expect(await commands(dir)).toEqual([
      "task public",
      "task app:build",
      "task app:test",
      "task app:default",
      "task app:tools:lint",
    ]);
    expect((await discoverTasks(dir)).find((task) => task.name === "app:test")).toMatchObject({
      description: "Test app",
      category: "test",
      source: "Taskfile",
    });
  });

  it("parses a shared physical file once and expands both namespace contexts", async () => {
    const dir = await fixture({
      "Taskfile.yml":
        "includes:\n  app: ./child.yml\n  other: {taskfile: ./child.yml, aliases: [backend]}\n",
      "child.yml": child,
    });
    const read = vi.spyOn(fsSafe, "readContainedFile");
    expect(await commands(dir)).toEqual([
      "task app:build",
      "task app:test",
      "task app:default",
      "task other:build",
      "task other:test",
      "task other:default",
    ]);
    expect(read.mock.calls.filter(([, path]) => path === "child.yml")).toHaveLength(1);
  });

  it("uses the shared default-file order for roots and directory includes, including .dist fallbacks", async () => {
    const dir = await fixture({
      "Taskfile.dist.yml": "includes:\n  app: ./app\ntasks: {root: 'echo root'}\n",
      "app/Taskfile.dist.yaml": child,
      "app/Taskfile.yaml": "tasks: {selected: 'echo selected'}",
    });
    expect(await commands(dir)).toEqual(["task root", "task app:selected"]);
    await rm(join(dir, "app/Taskfile.yaml"));
    expect(await commands(dir)).toEqual([
      "task root",
      "task app:build",
      "task app:test",
      "task app:default",
    ]);
  });

  it("fails closed on ancestry cycles while retaining unrelated ecosystem tasks", async () => {
    const dir = await fixture({
      "Taskfile.yml": "includes: {app: './child.yml'}\ntasks: {root: 'echo root'}",
      "child.yml": "includes: {parent: './Taskfile.yml'}\ntasks: {test: 'echo test'}",
      Makefile: "build:\n\t@echo build\n",
    });
    const read = vi.spyOn(fsSafe, "readContainedFile");
    expect(await commands(dir)).toEqual(["make build"]);
    expect(
      read.mock.calls.filter(([, path]) => ["Taskfile.yml", "child.yml"].includes(path))
    ).toHaveLength(2);
  });

  it("does not read escaped or symlinked-outside includes, remote URLs, templates, or unsupported graph options", async () => {
    const outside = await fixture({ "external.yml": child });
    const dir = await fixture({
      "Taskfile.yml": `includes:\n  escaped: ${JSON.stringify(join(outside, "external.yml"))}\n  link: ./outside.yml\n  remote: https://example.invalid/Taskfile.yml\n  template: '{{.TASKFILE}}'\n  flat: {taskfile: ./child.yml, flatten: true}\n  variable: {taskfile: ./child.yml, vars: {MODE: dev}}\n  optional: {taskfile: ./missing.yml, optional: true}\ntasks: {public: 'echo public'}\n`,
      "child.yml": child,
    });
    await symlink(join(outside, "external.yml"), join(dir, "outside.yml"), "file");
    const read = vi.spyOn(fsSafe, "readContainedFile");
    expect(await commands(dir)).toEqual(["task public"]);
    expect(
      read.mock.calls.filter(([, path]) => /external|outside|child|missing/.test(path))
    ).toEqual([]);
  });

  it("ignores excluded primary includes without borrowing lower-precedence directory files", async () => {
    const dir = await fixture({
      "Taskfile.yml": "includes: {app: './app'}\ntasks: {root: 'echo root'}",
      "app/Taskfile.yml": child,
      "app/Taskfile.dist.yml": "tasks: {wrong: 'echo wrong'}",
    });
    const read = vi.spyOn(fsSafe, "readContainedFile");
    const result = await scanRepo(dir, 100, { exclude: ["app/Taskfile.yml"] });
    expect(result.commands.map((task) => task.command)).toEqual(["task root"]);
    expect(read.mock.calls.filter(([, path]) => path === "app/Taskfile.yml")).toEqual([]);
  });

  it("does not substitute a fallback or advertise root tasks when the primary directory Taskfile is a directory", async () => {
    const dir = await fixture({
      "Taskfile.yml": "includes: {app: './app'}\ntasks: {public: 'echo public'}",
      "app/Taskfile.dist.yml": child,
    });
    await mkdir(join(dir, "app", "Taskfile.yml"));
    expect(await commands(dir)).toEqual([]);
  });

  it("uses selected-root files and does not borrow parent includes or files omitted by the walk limit", async () => {
    const dir = await fixture({
      "Taskfile.yml": "tasks: {outer: 'echo outer'}",
      "shared.yml": child,
      "packages/app/Taskfile.yml":
        "includes: {outside: '../../shared.yml', local: './child.yml'}\ntasks: {root: 'echo root'}",
      "packages/app/child.yml": child,
    });
    const selected = await scanRepo(dir, 100, { subdir: "packages/app" });
    expect(selected.commands.map((task) => task.command)).toEqual([
      "task root",
      "task local:build",
      "task local:test",
      "task local:default",
    ]);
    const limited = await scanRepo(dir, 1, { subdir: "packages/app" });
    expect(limited.files).toHaveLength(1);
    const childSelected = limited.files.some((file) => file.path === "child.yml");
    expect(limited.commands.some((task) => task.name === "local:test")).toBe(childSelected);
    const excluded = await scanRepo(dir, 100, { subdir: "packages/app", exclude: ["child.yml"] });
    expect(excluded.commands.map((task) => task.command)).toEqual(["task root"]);
  });

  it("does not interpret malformed included YAML or arbitrary tag types", async () => {
    const dir = await fixture({
      "Taskfile.yml": "includes: {app: './child.yml'}\ntasks: {root: 'echo root'}",
      "child.yml": "tasks: [",
    });
    expect(await commands(dir)).toEqual([]);
    await writeFile(join(dir, "child.yml"), "tasks: !!js/function 'function () {}'");
    expect(await commands(dir)).toEqual([]);
  });

  it("rejects missing required includes and canonical task collisions, but permits optional missing files", async () => {
    const dir = await fixture({
      "Taskfile.yml": "includes: {app: './missing.yml'}\ntasks: {public: 'echo public'}",
    });
    expect(await commands(dir)).toEqual([]);
    await writeFile(
      join(dir, "Taskfile.yml"),
      "includes: {app: {taskfile: './missing.yml', optional: true}}\ntasks: {public: 'echo public'}"
    );
    expect(await commands(dir)).toEqual(["task public"]);
    await writeFile(
      join(dir, "Taskfile.yml"),
      "includes: {app: './child.yml'}\ntasks: {'app:build': 'echo root'}"
    );
    await writeFile(join(dir, "child.yml"), child);
    expect(await commands(dir)).toEqual([]);
  });

  it("validates hidden local graphs and reserves internal task names before filtering", async () => {
    const dir = await fixture({
      "Taskfile.yml":
        "includes: {hidden: {taskfile: './child.yml', internal: true}}\ntasks: {public: 'echo public'}",
    });
    expect(await commands(dir)).toEqual([]);
    await writeFile(join(dir, "child.yml"), "tasks: [");
    expect(await commands(dir)).toEqual([]);
    await writeFile(join(dir, "child.yml"), "includes: {parent: './Taskfile.yml'}");
    expect(await commands(dir)).toEqual([]);
    await writeFile(join(dir, "child.yml"), child);
    expect(await commands(dir)).toEqual(["task public"]);
    await writeFile(
      join(dir, "Taskfile.yml"),
      "includes: {app: './child.yml'}\ntasks: {'app:build': {internal: true, cmds: ['echo root']}}"
    );
    expect(await commands(dir)).toEqual([]);
  });

  it("bounds physical reads and namespace work before an unbounded graph can produce output", async () => {
    const files: Record<string, string> = {};
    const includes = Array.from({ length: 65 }, (_, index) => {
      files[`child${index}.yml`] = child;
      return `  app${index}: ./child${index}.yml`;
    });
    files["Taskfile.yml"] = `includes:\n${includes.join("\n")}\n`;
    const dir = await fixture(files);
    const read = vi.spyOn(fsSafe, "readContainedFile");
    expect(await commands(dir)).toEqual([]);
    expect(
      read.mock.calls.filter(([, path]) => /^(Taskfile|child\d+)\.yml$/.test(path)).length
    ).toBeLessThanOrEqual(64);
    await writeFile(
      join(dir, "Taskfile.yml"),
      `includes:\n${Array.from({ length: 129 }, (_, index) => `  bad${index}: https://example.invalid/task.yml`).join("\n")}\ntasks: {root: 'echo root'}`
    );
    expect(await commands(dir)).toEqual([]);
  });

  it("bounds ancestry depth without reading the next file", async () => {
    const files: Record<string, string> = { "Taskfile.yml": "includes: {app: './depth1.yml'}" };
    for (let depth = 1; depth <= 18; depth++)
      files[`depth${depth}.yml`] =
        `includes: {app: './depth${depth + 1}.yml'}\ntasks: {test: 'echo test'}`;
    const dir = await fixture(files);
    const read = vi.spyOn(fsSafe, "readContainedFile");
    expect(await commands(dir)).toEqual([]);
    expect(read.mock.calls.some(([, path]) => path === "depth17.yml")).toBe(false);
  });

  it("rejects oversized physical input before reading and excessive aggregate input/output", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 10; index++)
      files[`child${index}.yml`] = `#${"x".repeat(900_000)}\ntasks: {test: 'echo test'}`;
    files["Taskfile.yml"] =
      `includes:\n${Array.from({ length: 10 }, (_, index) => `  app${index}: ./child${index}.yml`).join("\n")}`;
    const dir = await fixture(files);
    const read = vi.spyOn(fsSafe, "readContainedFile");
    expect(await commands(dir)).toEqual([]);
    expect(read.mock.calls.some(([, path]) => path === "child9.yml")).toBe(false);
    await writeFile(
      join(dir, "Taskfile.yml"),
      `#${"x".repeat(1024 * 1024)}\ntasks: {test: 'echo test'}`
    );
    read.mockClear();
    expect(await commands(dir)).toEqual([]);
    expect(read.mock.calls.some(([, path]) => path === "Taskfile.yml")).toBe(false);
    await writeFile(
      join(dir, "Taskfile.yml"),
      `description: &long ${"x".repeat(400_000)}\ntasks:\n  build: {desc: *long}\n  test: {desc: *long}\n  serve: {desc: *long}`
    );
    expect(await commands(dir)).toEqual([]);
  });

  it("retains exactly the task limit and fails closed if one more command is declared", async () => {
    const content = (count: number) =>
      `tasks:\n${Array.from({ length: count }, (_, index) => `  task${index}: echo task`).join("\n")}`;
    const dir = await fixture({ "Taskfile.yml": content(2000) });
    expect(await commands(dir)).toHaveLength(2000);
    await writeFile(join(dir, "Taskfile.yml"), content(2001));
    expect(await commands(dir)).toEqual([]);
  });

  it("bounds hidden task/name expansion before presentation filtering", async () => {
    const dir = await fixture({
      "Taskfile.yml": `tasks:\n  public: echo public\n${Array.from({ length: 2000 }, (_, index) => `  hidden${index}: {internal: true}`).join("\n")}`,
    });
    expect(await commands(dir)).toEqual([]);
    await writeFile(
      join(dir, "Taskfile.yml"),
      "includes:\n  app: {taskfile: './child.yml', internal: true}\n  other: {taskfile: './child.yml', internal: true}\n  third: {taskfile: './child.yml', internal: true}\ntasks: {public: 'echo public'}"
    );
    await writeFile(
      join(dir, "child.yml"),
      `tasks:\n${Array.from({ length: 100 }, (_, index) => `  task${index}${"x".repeat(5000)}: echo hidden`).join("\n")}`
    );
    expect(await commands(dir)).toEqual([]);
  });
});
