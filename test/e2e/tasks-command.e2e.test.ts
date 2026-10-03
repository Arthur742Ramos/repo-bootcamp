import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./helpers.js";

const dirs: string[] = [];
async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-tasks-e2e-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("task discovery commands", () => {
  it.each(["src/lib.rs", "src/main.rs", "src/bin/one.rs"])(
    "reports native Cargo build/test defaults for ordinary target %s",
    async (target) => {
      const dir = await repoWith({
        "Cargo.toml": '[package]\nname="owned"\nversion="0.1.0"\nedition="2021"\n',
        [target]: "// Owned source; never executed\n",
      });
      const result = await runCli(["tasks", dir, "--json"]);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.gettingStarted).toEqual(["cargo build", "cargo test"]);
      expect(payload.tasks).toEqual([
        { name: "build", command: "cargo build", source: "Cargo.toml", category: "build" },
        { name: "test", command: "cargo test", source: "Cargo.toml", category: "test" },
      ]);
      const tests = await runCli(["tasks", dir, "--json", "--category", "test"]);
      expect(
        JSON.parse(tests.stdout).tasks.map((task: { command: string }) => task.command)
      ).toEqual(["cargo test"]);
    },
    60_000
  );
  it("discovers quoted Python declarations without advertising example text or nested metadata", async () => {
    const dir = await repoWith({
      "pyproject.toml": String.raw`[tool.fixture]
example = """
[project.scripts]
dev = "fixture:main"
"""
["project" . 'scripts'] # console scripts
"tool\u002Ename" = "fixture:main"
test = "fixture:main"
bad = false
nested.name = "fixture:main"
`,
    });
    const result = await runCli(["tasks", dir, "--json"]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.tasks.map((task: { command: string }) => task.command)).toEqual([
      "tool.name",
      "test",
    ]);
    expect(payload.gettingStarted).toEqual(["test"]);
  }, 60_000);

  it("retains documented Poetry console and file declarations while shielding literal examples", async () => {
    const dir = await repoWith({
      "pyproject.toml": `[tool.fixture]
example = '''
[tool.poetry.scripts]
test = 'fixture:main'
'''
['tool' . "poetry" . scripts]
serve = { reference = "fixture:main", type = "console" }
legacy = { reference = "some_binary.exe", type = "file" }
optional = { reference = "fixture:main", type = "console", extras = ["feature"] }
old = { callable = "fixture:main", extras = [] }
`,
    });
    const result = await runCli(["tasks", dir, "--json"]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.tasks.map((task: { command: string }) => task.command)).toEqual([
      "poetry run serve",
      "poetry run legacy",
      "poetry run optional",
      "poetry run old",
    ]);
    expect(payload.gettingStarted).toEqual(["poetry run serve"]);
  }, 60_000);

  it("advertises public zero-argument Just recipes and omits required/private helpers", async () => {
    const dir = await repoWith({
      justfile: `set unstable
set lists
example := (
  '''
fake:
'''
)
dev target:
    @echo {{target}}
[no-cd,
private]
setup:
    @echo helper
_helper:
    @echo helper
# Build with the local default
[ no-cd ]
build mode='debug':
    @echo {{mode}}
test *FILES:
    @echo {{FILES}}
required +FILES:
    @echo {{FILES}}
[arg(
  'FILES',
  min='2'
)]
check *FILES:
    @echo {{FILES}}
`,
    });
    const result = await runCli(["tasks", dir, "--json"]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.tasks.map((task: { command: string }) => task.command)).toEqual([
      "just build",
      "just test",
    ]);
    expect(payload.tasks[0].description).toBe("Build with the local default");
    expect(payload.gettingStarted).toEqual(["just build", "just test"]);
  }, 60_000);

  it("omits ambiguous Just sources while retaining independent ecosystem commands", async () => {
    const dir = await repoWith({
      justfile: "build:\n    @echo build\n",
      ".justfile": "test:\n    @echo test\n",
      Makefile: "verify:\n\t@echo verify\n",
    });
    const result = await runCli(["tasks", dir, "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).gettingStarted).toEqual(["make verify"]);
    expect(
      JSON.parse(result.stdout).tasks.map((task: { command: string }) => task.command)
    ).toEqual(["make verify"]);
  }, 60_000);

  it.each(["justfile", "Justfile", ".justfile"])(
    "does not confuse one %s entry with multiple default sources",
    async (name) => {
      const dir = await repoWith({ [name]: "build mode='debug':\n    @echo {{mode}}\n" });
      const result = await runCli(["tasks", dir, "--json"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).gettingStarted).toEqual(["just build"]);
    },
    60_000
  );

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("reports canonical local Task namespaces, included defaults and the runnable getting-started sequence", async () => {
    const dir = await repoWith({
      "Taskfile.dist.yml":
        "version: '3'\nincludes:\n  app: ./app\n  other: ./app\n  hidden: {taskfile: ./app, internal: true}\ntasks:\n  default: {cmds: ['echo root']}\n",
      "app/Taskfile.dist.yml":
        "version: '3'\ntasks:\n  build: {desc: Build app, cmds: ['echo build']}\n  test: {desc: Test app, cmds: ['echo test']}\n  default: {desc: Default workflow, cmds: ['echo default']}\n  helper: {internal: true, cmds: ['echo hidden']}\n",
    });
    const result = await runCli(["tasks", dir, "--json"]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.tasks.map((task: { command: string }) => task.command)).toEqual([
      "task app:build",
      "task app:test",
      "task app:default",
      "task other:build",
      "task other:test",
      "task other:default",
    ]);
    expect(payload.gettingStarted).toEqual(["task app:build", "task app:test"]);
    const report = await runCli(["tasks", dir, "--category", "test"]);
    expect(report.exitCode).toBe(0);
    expect(report.stdout).toContain("task app:test");
    expect(report.stdout).toContain("task other:test");
    expect(report.stdout).not.toContain("task app:build");
  }, 60_000);

  it("does not advertise commands for missing required or colliding Task graphs", async () => {
    const dir = await repoWith({
      "Taskfile.yml":
        "version: '3'\nincludes: {app: './missing.yml'}\ntasks: {public: 'echo public'}",
    });
    const missing = await runCli(["tasks", dir, "--json"]);
    expect(missing.exitCode).toBe(0);
    expect(JSON.parse(missing.stdout).tasks).toEqual([]);
    await writeFile(
      join(dir, "Taskfile.yml"),
      "version: '3'\nincludes: {app: './child.yml'}\ntasks: {'app:test': 'echo root'}"
    );
    await writeFile(join(dir, "child.yml"), "version: '3'\ntasks: {test: 'echo child'}");
    const collision = await runCli(["tasks", dir, "--json"]);
    expect(collision.exitCode).toBe(0);
    expect(JSON.parse(collision.stdout).tasks).toEqual([]);
  }, 60_000);

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

  it("reports literal Make goals in file order and omits variable-only goals", async () => {
    const dir = await repoWith({
      Makefile: "ignored:\n",
      GNUmakefile: [
        ".PHONY: build test lint test.unit empty configured",
        "build test lint: ; @:",
        "test.unit: ; @:",
        "prepare: MODE=debug",
        "configured: MODE := debug",
        "empty:",
        "configured:",
        "lint.types:: ; @:",
        "define HELP",
        "test.fake: text inside a variable",
        "endef",
        "",
      ].join("\n"),
    });
    const result = await runCli(["tasks", dir, "--json"]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.tasks.map((task: { command: string }) => task.command)).toEqual([
      "make build",
      "make test",
      "make lint",
      "make test.unit",
      "make empty",
      "make configured",
      "make lint.types",
    ]);
    expect(payload.gettingStarted).toEqual(["make build", "make test"]);
    const report = await runCli(["tasks", dir]);
    expect(report.exitCode).toBe(0);
    expect(report.stdout).toContain("make test.unit");
    expect(report.stdout).toContain("make lint.types");
    expect(report.stdout).not.toContain("make prepare");
    expect(report.stdout).not.toContain("make test.fake");
    expect(report.stdout).not.toContain("make ignored");
  }, 60_000);

  it("does not suggest setup/build/test goals declared only by target-specific assignments", async () => {
    const dir = await repoWith({
      Makefile:
        "all: ; @:\nsetup: MODE += debug\nbuild: override MODE=debug\ntest: MODE ?= debug\n",
    });
    const result = await runCli(["tasks", dir, "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      tasks: [{ name: "all", command: "make all" }],
      gettingStarted: [],
    });
  }, 60_000);

  it.each([
    ["assignment-like comment", "build: #MODE=debug\n", ["make build"]],
    ["multi-target comment", "one two: #MODE = debug\n", ["make one", "make two"]],
    ["continued variable", "HELP = text \\\nbuild fake: text\nall: ; @:\n", ["make all"]],
    ["continued assignment", "setup: FLAGS = -O \\\nbuild.fake: ; @:\nall: ; @:\n", ["make all"]],
    ["continued inline recipe", "all: ; @printf hello \\\nbuild fake: text\n", ["make all"]],
    ["continued recipe", "all:\n\t@printf hello \\\nbuild fake: text\n", ["make all"]],
    ["continued targets", "build \\\ntest: ; @:\n", ["make build", "make test"]],
    ["continued comment", "# task examples \\\nbuild fake: text\nall: ; @:\n", ["make all"]],
  ] satisfies Array<[string, string, string[]]>)(
    "uses logical Make rules for %s",
    async (_name, content, commands) => {
      const dir = await repoWith({ Makefile: content });
      const result = await runCli(["tasks", dir, "--json"]);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.tasks.map((task: { command: string }) => task.command)).toEqual(commands);
      expect(payload.gettingStarted.every((command: string) => commands.includes(command))).toBe(
        true
      );
    },
    60_000
  );

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
