import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";
import { MAX_CONTAINED_FILE_BYTES, readContainedFile } from "../src/fs-safe.js";

import {
  categorizeTask,
  detectPackageManager,
  discoverTasks,
  parseComposer,
  parseDockerCompose,
  parseJustfile,
  parseMakefile,
  parsePackageJsonScripts,
  parsePyproject,
  parseTaskfile,
  suggestGettingStarted,
  toCommands,
  type DiscoveredTask,
} from "../src/tasks.js";

const dirs: string[] = [];

async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-tasks-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf-8");
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs.length = 0;
});

describe("categorizeTask", () => {
  it("classifies install-family names", () => {
    expect(categorizeTask("install")).toBe("install");
    expect(categorizeTask("bootstrap")).toBe("install");
    expect(categorizeTask("setup")).toBe("install");
  });

  it("prefers lint over test so `typecheck` is not bucketed by `check`", () => {
    expect(categorizeTask("typecheck")).toBe("lint");
    expect(categorizeTask("lint")).toBe("lint");
    expect(categorizeTask("format")).toBe("lint");
  });

  it("classifies test-family names", () => {
    expect(categorizeTask("test")).toBe("test");
    expect(categorizeTask("test:e2e")).toBe("test");
    expect(categorizeTask("coverage")).toBe("test");
  });

  it("classifies build-family names", () => {
    expect(categorizeTask("build")).toBe("build");
    expect(categorizeTask("compile")).toBe("build");
    expect(categorizeTask("bundle")).toBe("build");
  });

  it("prefers dev over run so `serve`/`watch` read as development", () => {
    expect(categorizeTask("serve")).toBe("dev");
    expect(categorizeTask("watch")).toBe("dev");
    expect(categorizeTask("dev")).toBe("dev");
  });

  it("classifies run-family names", () => {
    expect(categorizeTask("start")).toBe("run");
    expect(categorizeTask("launch")).toBe("run");
  });

  it("classifies release-family names", () => {
    expect(categorizeTask("release")).toBe("release");
    expect(categorizeTask("publish")).toBe("release");
    expect(categorizeTask("deploy")).toBe("release");
  });

  it("falls back to `other` for unrecognized names", () => {
    expect(categorizeTask("frobnicate")).toBe("other");
    expect(categorizeTask("")).toBe("other");
  });
});

describe("parsePackageJsonScripts", () => {
  it("emits `npm run <name>` strings by default (byte-compatible)", () => {
    const tasks = parsePackageJsonScripts(
      JSON.stringify({ scripts: { build: "tsc", test: "vitest run" } })
    );
    expect(tasks).toEqual([
      {
        name: "build",
        command: "npm run build",
        source: "package.json",
        category: "build",
        description: "tsc",
      },
      {
        name: "test",
        command: "npm run test",
        source: "package.json",
        category: "test",
        description: "vitest run",
      },
    ]);
  });

  it("honours a non-npm package manager", () => {
    const tasks = parsePackageJsonScripts(JSON.stringify({ scripts: { build: "tsc" } }), "pnpm");
    expect(tasks[0].command).toBe("pnpm run build");
  });

  it("returns [] for invalid JSON or a missing scripts map", () => {
    expect(parsePackageJsonScripts("{not json")).toEqual([]);
    expect(parsePackageJsonScripts(JSON.stringify({ name: "x" }))).toEqual([]);
    expect(parsePackageJsonScripts(JSON.stringify({ scripts: "nope" }))).toEqual([]);
  });

  it("omits a description when the script body is not a string", () => {
    const tasks = parsePackageJsonScripts(JSON.stringify({ scripts: { weird: 42 } }));
    expect(tasks[0].description).toBeUndefined();
  });
});

describe("parseMakefile", () => {
  it("extracts targets but not `:=` assignments or indented recipe bodies", () => {
    const tasks = parseMakefile("CC := gcc\nbuild:\n\tgo build\ntest: build\n\tgo test\n");
    expect(tasks.map((t) => t.name)).toEqual(["build", "test"]);
    expect(tasks[0]).toEqual({
      name: "build",
      command: "make build",
      source: "Makefile",
      category: "build",
    });
    expect(tasks.find((t) => t.name === "CC")).toBeUndefined();
  });

  it("carries no description (byte-compatible with the legacy extractor)", () => {
    const tasks = parseMakefile("lint:\n\techo hi\n");
    expect(tasks[0].description).toBeUndefined();
  });

  it("preserves literal multi-target rule order and dotted public names", () => {
    const tasks = parseMakefile(
      ".PHONY: build test lint\nbuild test lint: ; @:\ntest.unit lint.types: ; @:\n"
    );
    expect(tasks.map((task) => task.name)).toEqual([
      "build",
      "test",
      "lint",
      "test.unit",
      "lint.types",
    ]);
    expect(tasks.map((task) => task.command)).toEqual([
      "make build",
      "make test",
      "make lint",
      "make test.unit",
      "make lint.types",
    ]);
    expect(tasks.map((task) => task.category)).toEqual(["build", "test", "lint", "test", "lint"]);
  });

  it.each(["=", ":=", "::=", ":::=", "?=", "+=", "!="])(
    "does not treat %s assignments as rules",
    (operator) => {
      const tasks = parseMakefile(
        `VALUE ${operator} data\nprepare inspect: MODE ${operator} debug\nsetup: override export MODE ${operator} debug\nbuild:\n`
      );
      expect(tasks.map((task) => task.name)).toEqual(["build"]);
    }
  );

  it("keeps later real rules, empty goals, and double-colon rules in their declared order", () => {
    const tasks = parseMakefile(
      "configured: MODE=debug\nempty:\nconfigured:\nlint:: ; @:\nbuild test:: ; @:\n"
    );
    expect(tasks.map((task) => task.name)).toEqual([
      "empty",
      "configured",
      "lint",
      "build",
      "test",
    ]);
  });

  it("ignores literal multiline variable bodies, including nested defines", () => {
    const tasks = parseMakefile(
      "override define HELP\ntest: help text\ndefine INNER\nbuild.fake: text\nendef\nendef\nall:\n\tdefine recipe-text\n\tendef\nlint:\n"
    );
    expect(tasks.map((task) => task.name)).toEqual(["all", "lint"]);
  });

  it("omits metadata, patterns, expansions, unsafe names, and indented recipe text", () => {
    const tasks = parseMakefile(
      ".PHONY: build\n.SUFFIXES:\n%.o: %.c\n$(TASK):\n-lint:\nbuild;echo:\n    hidden:\n\tpretend:\nvalid: # public rule\n"
    );
    expect(tasks.map((task) => task.name)).toEqual(["valid"]);
  });

  it("keeps real empty rules whose comments resemble assignments", () => {
    const tasks = parseMakefile(
      "build: #MODE=debug\none two: #MODE = debug\nlint: # MODE := text\n"
    );
    expect(tasks.map((task) => task.name)).toEqual(["build", "one", "two", "lint"]);
  });

  it("folds literal multi-target continuations before extracting rule names", () => {
    const tasks = parseMakefile("build \\\n  test \\\n\tlint: ; @:\n");
    expect(tasks.map((task) => task.name)).toEqual(["build", "test", "lint"]);
  });

  it.each([
    "HELP = text \\\nbuild fake: text\nall: ; @:\n",
    "setup: FLAGS = -O \\\nbuild.fake: ; @:\nall: ; @:\n",
    "all: ; @printf hello \\\nbuild fake: text\n",
    "all:\n\t@printf hello \\\nbuild fake: text\n",
    "# task examples \\\nbuild fake: text\nall: ; @:\n",
  ])("does not discover targets within a continued variable, recipe, or comment", (content) => {
    expect(parseMakefile(content).map((task) => task.name)).toEqual(["all"]);
  });

  it("does not interpret inline recipe assignments as target-specific variables", () => {
    const tasks = parseMakefile("build: ;MODE=debug :\ntest: ; #MODE=debug\n");
    expect(tasks.map((task) => task.name)).toEqual(["build", "test"]);
  });

  it("preserves escaped comment markers and even trailing backslashes", () => {
    expect(parseMakefile("prepare: \\#MODE=debug\n")).toEqual([]);
    expect(parseMakefile("HELP = text \\\\\nbuild: ; @:\n").map((task) => task.name)).toEqual([
      "build",
    ]);
  });

  it("keeps continued endef text inside a multiline variable until its real endef", () => {
    const tasks = parseMakefile("define HELP\nvalue \\\nendef\nendef\nbuild: ; @:\n");
    expect(tasks.map((task) => task.name)).toEqual(["build"]);
  });

  it("preserves rule and recipe boundaries across blank continuation segments", () => {
    expect(parseMakefile("build \\\n\\\ntest: ; @:\n").map((task) => task.name)).toEqual([
      "build",
      "test",
    ]);
    expect(parseMakefile("all:\n\t\\\nbuild fake: text\n").map((task) => task.name)).toEqual([
      "all",
    ]);
    expect(parseMakefile("\\\n\\\nbuild: ; @:\n")).toEqual([]);
  });

  it("handles long backslash runs according to terminal continuation parity", () => {
    const backslashes = "\\".repeat(32_000);
    expect(parseMakefile(`VALUE = ${backslashes}x\nall: ; @:\n`).map((task) => task.name)).toEqual([
      "all",
    ]);
    expect(
      parseMakefile(`HELP = ${backslashes.slice(1)}\nbuild.fake: text\nall: ; @:\n`).map(
        (task) => task.name
      )
    ).toEqual(["all"]);
    expect(parseMakefile(`HELP = ${backslashes}\nbuild: ; @:\n`).map((task) => task.name)).toEqual([
      "build",
    ]);
  });
});

describe("parseJustfile", () => {
  it("extracts recipes with preceding-comment descriptions", () => {
    const tasks = parseJustfile(
      "# Build the project\nbuild:\n    cargo build\n\ntest:\n    cargo test\n"
    );
    expect(tasks).toEqual([
      {
        name: "build",
        command: "just build",
        source: "justfile",
        category: "build",
        description: "Build the project",
      },
      {
        name: "test",
        command: "just test",
        source: "justfile",
        category: "test",
        description: undefined,
      },
    ]);
  });

  it("ignores reserved directives, indented bodies, and duplicates", () => {
    const tasks = parseJustfile(
      "set shell := ['bash']\nexport FOO := 'bar'\nalias b := build\n\nbuild:\n    echo one\nbuild:\n    echo dup\n"
    );
    const names = tasks.map((t) => t.name);
    expect(names).toEqual(["build"]);
    expect(names).not.toContain("set");
    expect(names).not.toContain("export");
    expect(names).not.toContain("alias");
  });

  it("handles recipes with parameters", () => {
    const tasks = parseJustfile("deploy env:\n    echo {{env}}\n");
    expect(tasks[0].name).toBe("deploy");
    expect(tasks[0].command).toBe("just deploy");
    expect(tasks[0].category).toBe("release");
  });
});

describe("parseTaskfile", () => {
  it("extracts go-task tasks with desc/summary, skipping `default`", () => {
    const yaml = [
      "version: '3'",
      "tasks:",
      "  default:",
      "    cmds: [task --list]",
      "  build:",
      "    desc: Compile the binary",
      "    cmds:",
      "      - go build",
      "  test:",
      "    summary: Run the tests",
      "    cmds:",
      "      - go test ./...",
      "",
    ].join("\n");
    const tasks = parseTaskfile(yaml);
    expect(tasks).toEqual([
      {
        name: "build",
        command: "task build",
        source: "Taskfile",
        category: "build",
        description: "Compile the binary",
      },
      {
        name: "test",
        command: "task test",
        source: "Taskfile",
        category: "test",
        description: "Run the tests",
      },
    ]);
  });

  it("preserves namespaced and quoted public task names", () => {
    const tasks = parseTaskfile(`version: '3'
"tasks": # public commands
  app:build:
    desc: Build app
  "test:unit":
    cmds: [echo tested]
  'lint:types': echo checked
`);
    expect(tasks.map(({ name, command, category }) => ({ name, command, category }))).toEqual([
      { name: "app:build", command: "task app:build", category: "build" },
      { name: "test:unit", command: "task test:unit", category: "test" },
      { name: "lint:types", command: "task lint:types", category: "lint" },
    ]);
  });

  it("omits private helpers in block and flow mappings", () => {
    const tasks = parseTaskfile(`tasks:
  build:
    desc: Public build
    cmds: [{task: helper}]
  helper:
    desc: Private helper
    internal: true
  hidden: {internal: true, cmds: [echo hidden]}
  visible: {internal: false, desc: Still public}
`);
    expect(tasks.map((task) => task.name)).toEqual(["build", "visible"]);
  });

  it("honors inherited private metadata and explicit public overrides", () => {
    const tasks = parseTaskfile(`tasks:
  private: &private
    internal: true
    desc: Inherited description
    cmds: [echo helper]
  helper:
    <<: *private
  public:
    <<: *private
    internal: false
    desc: Public override
`);
    expect(tasks.map(({ name, description }) => ({ name, description }))).toEqual([
      { name: "public", description: "Public override" },
    ]);
  });

  it("omits legacy YAML boolean forms that Task treats as internal", () => {
    for (const internal of [
      "y",
      "Y",
      "yes",
      "Yes",
      "YES",
      "true",
      "True",
      "TRUE",
      "on",
      "On",
      "ON",
    ]) {
      expect(parseTaskfile(`tasks:\n  helper:\n    internal: ${internal}\n`)).toEqual([]);
    }
  });

  it("reads only the task's own metadata, with folded and literal descriptions", () => {
    const tasks = parseTaskfile(`tasks:
  build:
    vars:
      internal: true
      desc: Nested value
    desc: >-
      Build the
      application
  test:
    summary: |-
      Run the tests.
      Check the results.
vars:
  desc: Unrelated root value
`);
    expect(tasks.map((task) => task.description)).toEqual([
      "Build the application",
      "Run the tests.\nCheck the results.",
    ]);
    expect(tasks.map((task) => task.name)).toEqual(["build", "test"]);
  });

  it("keeps scalar/list shorthand tasks using Task's string semantics", () => {
    const tasks = parseTaskfile(`tasks:
  build: echo built
  test: [echo tested]
  fail: false
  numeric: 123
`);
    expect(tasks.map((task) => task.command)).toEqual([
      "task build",
      "task test",
      "task fail",
      "task numeric",
    ]);
  });

  it("preserves scalar-looking names and description text", () => {
    const tasks = parseTaskfile(`tasks:
  on:
    desc: true
  2026-01-01:
    desc: 123
`);
    expect(tasks.map(({ name, description }) => ({ name, description }))).toEqual([
      { name: "on", description: "true" },
      { name: "2026-01-01", description: "123" },
    ]);
  });

  it("returns no commands for malformed, duplicate, or non-mapping YAML", () => {
    for (const content of [
      "tasks: [",
      "tasks: []",
      "tasks: null",
      "[]",
      "tasks:\n  build: echo first\n  build: echo second\n",
    ]) {
      expect(parseTaskfile(content)).toEqual([]);
    }
  });

  it("rejects custom YAML types and never emits shell syntax from task names", () => {
    expect(parseTaskfile("tasks: !!js/function 'function () {}'")).toEqual([]);
    for (const name of ["build; echo unintended", "--version", "-build", ":root"]) {
      expect(parseTaskfile(`tasks:\n  "${name}": echo nope\n`)).toEqual([]);
    }
  });

  it("returns [] when there is no tasks block", () => {
    expect(parseTaskfile("version: '3'\n")).toEqual([]);
  });
});

describe("parseDockerCompose", () => {
  it("accepts standard explicit data tags without changing implicit service names", () => {
    const tasks = parseDockerCompose(`services:
  on:
    image: nginx
    init: !!bool true
    scale: !!int 2
    cpus: !!float 1.5
    command: !!binary ZWNobyBvaw==
    entrypoint: !!null null
    x-date: !!timestamp 2026-01-01
    x-tags: !!set {development: null}
    x-pairs: !!pairs [{key: value}]
    x-ordered: !!omap [{key: value}]
  absent: !!null null
  scalar: !!bool true
  binary: !!binary aGVsbG8=
  date: !!timestamp 2026-01-01
  pairs: !!pairs [{image: nginx}]
  ordered: !!omap [{image: nginx}]
`);
    expect(tasks.map((task) => task.command)).toEqual(["docker compose up on"]);
    // This Compose compatibility extension does not expand Taskfile's tag set.
    expect(parseTaskfile("tasks: {helper: {internal: !!bool true}}")).toEqual([]);
  });

  it("maps services to `docker compose up <service>` run tasks", () => {
    const yaml = [
      "services:",
      "  web:",
      "    image: nginx",
      "  db:",
      "    image: postgres",
      "",
    ].join("\n");
    const tasks = parseDockerCompose(yaml);
    expect(tasks).toEqual([
      { name: "web", command: "docker compose up web", source: "docker-compose", category: "run" },
      { name: "db", command: "docker compose up db", source: "docker-compose", category: "run" },
    ]);
  });

  it("reads commented and quoted services without exposing nested properties", () => {
    const tasks = parseDockerCompose(`"services": # local development
  'web-app':
    image: nginx
    environment:
      nested: value
  "db.v2": {image: postgres}
volumes:
  data: {}
`);
    expect(tasks.map((task) => task.command)).toEqual([
      "docker compose up web-app",
      "docker compose up db.v2",
    ]);
  });

  it("supports flow mappings, aliases and standard YAML merges", () => {
    const tasks = parseDockerCompose(`x-services: &services
  db: {image: postgres}
x-web: &web {image: nginx}
services:
  <<: *services
  web:
    <<: *web
    ports: ["8080:80"]
`);
    expect(tasks.map((task) => task.command)).toEqual([
      "docker compose up db",
      "docker compose up web",
    ]);
    expect(parseDockerCompose("services: {web: {image: nginx}}")[0].name).toBe("web");
  });

  it("preserves scalar-looking service names and terminates options for leading hyphens", () => {
    const tasks = parseDockerCompose(`services:
  on: {image: nginx}
  123: {image: nginx}
  _worker: {image: nginx}
  .worker: {image: nginx}
  "--build": {image: nginx}
`);
    expect(tasks.map((task) => task.command)).toEqual([
      "docker compose up 123",
      "docker compose up on",
      "docker compose up _worker",
      "docker compose up .worker",
      "docker compose up -- --build",
    ]);
  });

  it("returns no tasks for malformed, duplicate, tagged or non-mapping YAML", () => {
    for (const content of [
      "services: [",
      "[]",
      "services: []",
      "services: null",
      "services: nginx",
      "services:\n  web: {}\n  web: {}\n",
      "services: !!js/function 'function () {}'",
      "services: {web: !custom {image: nginx}}",
      "services: {web: {init: !!bool invalid}}",
      "services: {web: !!int {image: nginx}}",
      "services: !!timestamp 2026-01-01",
      "services: !!binary aGVsbG8=",
      "services: !!omap [{web: {image: nginx}}]",
    ]) {
      expect(parseDockerCompose(content)).toEqual([]);
    }
  });

  it("omits invalid service definitions and names without losing valid siblings", () => {
    const tasks = parseDockerCompose(`services:
  web: {image: nginx}
  absent:
  scalar: nginx
  list: [nginx]
  "web; echo unintended": {image: nginx}
  "web app": {image: nginx}
  "$(echo unintended)": {image: nginx}
`);
    expect(tasks.map((task) => task.command)).toEqual(["docker compose up web"]);
  });
});

describe("parsePyproject", () => {
  it("preserves literal quoted names and decodes quoted table components and keys", () => {
    const tasks = parsePyproject(String.raw`["pr\u006Fject" . 'scripts'] # installed
"tool\u002Ename" = "pkg:main"
'quoted-tool' = 'pkg:main'
plain_name = "pkg:main"
"-dash" = "pkg:main"
["tool" . poetry . "scripts"]
"serve\U0000002Dtool" = "pkg:main"
`);
    expect(tasks.map((task) => task.command)).toEqual([
      "tool.name",
      "quoted-tool",
      "plain_name",
      "-dash",
      "poetry run serve-tool",
    ]);
  });

  it.each([
    '"""\n[project.scripts]\ndev = "pkg:main"\n"""',
    "'''\n[tool.poetry.scripts]\ntest = 'pkg:main'\n'''",
    '"""\n# sample\n\\"\\"\\"\n[project.scripts]\ndev = "pkg:main"\n"""',
    "'''\n[project.scripts]\ntest = 'pkg:main'\n''''",
    '"""\n[project.scripts]\ndev = "pkg:main"\n"""""',
    '[\n"""\n[project.scripts]\ndev = "pkg:main"\n""",\n"text # not comment"\n]',
    String.raw`"""\
      [project.scripts]
      dev = "pkg:main"
      """`,
  ])("shields declarations inside multiline data (%#)", (example) => {
    const content = `[tool.fixture]\nexample = ${example}\n[project.scripts]\nreal = "pkg:main"\n`;
    expect(parsePyproject(content).map((task) => task.command)).toEqual(["real"]);
    expect(parsePyproject(content.replaceAll("\n", "\r\n")).map((task) => task.command)).toEqual([
      "real",
    ]);
  });

  it("does not flatten nested keys or accept non-string PEP 621 script values", () => {
    const tasks = parsePyproject(`[project.scripts]
tool.name = "pkg:main"
bad = false
number = 1
array = ["pkg:main"]
object = { reference = "pkg:main", type = "console" }
'tool.name' = "pkg:main"
[project.scripts.nested]
dev = "pkg:main"
`);
    expect(tasks.map((task) => task.command)).toEqual(["tool.name"]);
  });

  it("preserves documented Poetry string, console-table and file-table scripts", () => {
    const tasks = parsePyproject(`[tool.poetry.scripts]
serve = { reference = "pkg:main", type = "console" }
legacy = { type = 'file', reference = 'some_binary.exe' }
normal = "pkg:main"
bad = false
wrong = { reference = "pkg:main", type = "other" }
missing = { reference = "pkg:main" }
`);
    expect(tasks.map((task) => task.command)).toEqual([
      "poetry run serve",
      "poetry run legacy",
      "poetry run normal",
    ]);
  });

  it("reads multiline script strings and leaves comments inside strings intact", () => {
    const tasks = parsePyproject(`[project.scripts] # actual section
"tool.name" = """pkg:main""" # entry point
real = '''pkg:main'''
[tool.fixture]
example = "[project.scripts] # text"
`);
    expect(tasks.map((task) => task.command)).toEqual(["tool.name", "real"]);
  });

  it("preserves schema-supported Poetry extras and legacy callable tables", () => {
    const tasks = parsePyproject(`[tool.poetry.scripts]
serve = { reference = "pkg:main", type = "console", extras = ["feature", 'second',] }
legacy = { callable = "pkg:main", extras = [] }
old = { callable = "pkg:main" }
bad = { reference = "pkg:main", type = "console", extras = [false] }
scalar = { callable = "pkg:main", extras = "feature" }
mixed = { callable = "pkg:main", reference = "pkg:main", type = "console" }
unknown = { reference = "pkg:main", type = "console", unrelated = "value" }
`);
    expect(tasks.map((task) => task.command)).toEqual([
      "poetry run serve",
      "poetry run legacy",
      "poetry run old",
    ]);
  });

  it("ignores unsafe names and does not expose declarations after incomplete strings", () => {
    expect(
      parsePyproject('[project.scripts]\n"bad name" = "pkg:main"\n"$(test)" = "pkg:main"\n')
    ).toEqual([]);
    expect(
      parsePyproject('[tool.fixture]\nexample = """\n[project.scripts]\ndev = "pkg:main"\n')
    ).toEqual([]);
  });

  it("handles large multiline examples and many declaration boundaries", () => {
    const sample = '[project.scripts]\ndev = "pkg:main"\n'.repeat(16_000);
    const content = `[tool.fixture]\nexample = '''${sample}'''\n[project.scripts]\nreal = "pkg:main"\n`;
    expect(parsePyproject(content).map((task) => task.command)).toEqual(["real"]);
  });

  it("emits `poetry run <name>` for poetry scripts and bare names for PEP 621", () => {
    const toml = [
      "[tool.poetry.scripts]",
      'serve = "app:main"',
      "",
      "[project.scripts]",
      'mycli = "pkg.cli:run"',
      "",
    ].join("\n");
    const tasks = parsePyproject(toml);
    expect(tasks).toEqual([
      { name: "serve", command: "poetry run serve", source: "pyproject.toml", category: "dev" },
      { name: "mycli", command: "mycli", source: "pyproject.toml", category: "other" },
    ]);
  });

  it("ignores keys outside a scripts section", () => {
    expect(parsePyproject("[tool.black]\nline-length = 88\n")).toEqual([]);
  });

  it("accepts trailing comments on supported headers and later section boundaries", () => {
    const tasks = parsePyproject(`[tool.poetry.scripts] # development tools
serve = "app:main" # entry point
[tool.poetry.dependencies] # not commands
python = "^3.12"
[project.scripts]# installed console scripts
mycli = "pkg.cli:run"
[tool.black] # not commands
line-length = 88
`);
    expect(tasks.map((task) => task.command)).toEqual(["poetry run serve", "mycli"]);
  });
});

describe("parseComposer", () => {
  it("extracts composer scripts, joining array bodies with ` && `", () => {
    const json = JSON.stringify({ scripts: { test: "phpunit", ci: ["phpstan", "phpunit"] } });
    const tasks = parseComposer(json);
    expect(tasks).toEqual([
      {
        name: "test",
        command: "composer run test",
        source: "composer.json",
        category: "test",
        description: "phpunit",
      },
      {
        name: "ci",
        command: "composer run ci",
        source: "composer.json",
        category: "other",
        description: "phpstan && phpunit",
      },
    ]);
  });

  it("returns [] for invalid JSON or missing scripts", () => {
    expect(parseComposer("nope")).toEqual([]);
    expect(parseComposer(JSON.stringify({ name: "acme/pkg" }))).toEqual([]);
  });
});

describe("detectPackageManager", () => {
  it("prefers the package.json `packageManager` field", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({ packageManager: "pnpm@9.0.0" }),
    });
    expect(await detectPackageManager(dir)).toBe("pnpm");
  });

  it("falls back to lockfiles", async () => {
    const yarnDir = await repoWith({ "yarn.lock": "" });
    expect(await detectPackageManager(yarnDir)).toBe("yarn");
  });

  it.each(["bun.lock", "bun.lockb"])("detects Bun from %s", async (lockfile) => {
    expect(await detectPackageManager(await repoWith({ [lockfile]: "lockfile" }))).toBe("bun");
  });

  it("does not mistake a package-manager name prefix for a supported manager", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({ packageManager: "pnpm-other@1.0.0" }),
      "yarn.lock": "",
    });
    expect(await detectPackageManager(dir)).toBe("yarn");
  });

  it("detects an oversized lockfile without reading it or relaxing the content-read cap", async () => {
    const dir = await repoWith({ "pnpm-lock.yaml": "" });
    await truncate(join(dir, "pnpm-lock.yaml"), MAX_CONTAINED_FILE_BYTES + 1);
    expect(await detectPackageManager(dir)).toBe("pnpm");
    await expect(readContainedFile(dir, "pnpm-lock.yaml")).rejects.toThrow("exceeds cap");
  });

  it("ignores directories masquerading as lockfiles", async () => {
    const dir = await repoWith({ "yarn.lock": "" });
    await mkdir(join(dir, "pnpm-lock.yaml"));
    expect(await detectPackageManager(dir)).toBe("yarn");
  });

  it("ignores lockfile symlinks that escape the repository", async () => {
    const external = await repoWith({ "pnpm-lock.yaml": "outside repository" });
    const dir = await repoWith({ "yarn.lock": "" });
    await symlink(external, join(dir, "pnpm-lock.yaml"), "junction");
    expect(await detectPackageManager(dir)).toBe("yarn");
  });

  it("defaults to npm when nothing indicates otherwise", async () => {
    const dir = await repoWith({ "README.md": "hi" });
    expect(await detectPackageManager(dir)).toBe("npm");
  });
});

describe("discoverTasks", () => {
  it.each(["Makefile", "makefile"])("prefers GNUmakefile over %s like GNU Make", async (name) => {
    const dir = await repoWith({
      [name]: "build:\n\t@echo wrong-file\n",
      GNUmakefile: "test:\n\t@echo selected-file\n",
    });
    expect((await discoverTasks(dir)).map((task) => task.command)).toEqual(["make test"]);
  });

  it("does not fall back when the preferred Makefile is empty", async () => {
    const dir = await repoWith({ GNUmakefile: "", Makefile: "build:\n\t@echo ignored\n" });
    expect(await discoverTasks(dir)).toEqual([]);
  });

  it("uses Compose's default filename order, including its legacy fallbacks", async () => {
    const names = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"];
    const dir = await repoWith(
      Object.fromEntries(
        names.map((name, index) => [name, `services: {service${index}: {image: nginx}}`])
      )
    );
    for (let index = 0; index < names.length; index++) {
      expect((await discoverTasks(dir)).map((task) => task.command)).toEqual([
        `docker compose up service${index}`,
      ]);
      await rm(join(dir, names[index]));
    }
  });

  it.each(["", "services: ["])(
    "does not invent legacy Compose services when the canonical file is empty or malformed (%j)",
    async (canonical) => {
      const dir = await repoWith({
        "compose.yaml": canonical,
        "docker-compose.yml": "services: {ignored: {image: nginx}}",
      });
      expect(await discoverTasks(dir)).toEqual([]);
    }
  );

  it("aggregates tasks across ecosystems in a stable order", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({ scripts: { build: "tsc" } }),
      Makefile: "deploy:\n\techo go\n",
      justfile: "lint:\n    cargo clippy\n",
      "Taskfile.yml": "tasks:\n  fmt:\n    cmds: [gofmt]\n",
      "docker-compose.yml": "services:\n  web:\n    image: nginx\n",
      "pyproject.toml": '[tool.poetry.scripts]\nserve = "app:main"\n',
      "composer.json": JSON.stringify({ scripts: { phpcs: "phpcs" } }),
    });
    const tasks = await discoverTasks(dir, { packageManager: "npm" });
    const sources = tasks.map((t) => t.source);
    expect(sources).toEqual([
      "package.json",
      "Makefile",
      "justfile",
      "Taskfile",
      "docker-compose",
      "pyproject.toml",
      "composer.json",
    ]);
    expect(tasks.find((t) => t.source === "package.json")?.command).toBe("npm run build");
  });

  it("detects the package manager when not forced", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({ packageManager: "yarn@4.0.0", scripts: { build: "tsc" } }),
    });
    const tasks = await discoverTasks(dir);
    expect(tasks[0].command).toBe("yarn run build");
  });

  it("returns [] for a repo with no task-definition files", async () => {
    const dir = await repoWith({ "README.md": "nothing runnable" });
    expect(await discoverTasks(dir)).toEqual([]);
  });
});

describe("toCommands", () => {
  it("drops category and omits description when absent", () => {
    const tasks: DiscoveredTask[] = [
      { name: "build", command: "make build", source: "Makefile", category: "build" },
      {
        name: "test",
        command: "npm run test",
        source: "package.json",
        category: "test",
        description: "vitest",
      },
    ];
    expect(toCommands(tasks)).toEqual([
      { name: "build", command: "make build", source: "Makefile" },
      { name: "test", command: "npm run test", source: "package.json", description: "vitest" },
    ]);
    expect("description" in toCommands(tasks)[0]).toBe(false);
  });
});

describe("suggestGettingStarted", () => {
  it("picks the first install, build, test, then dev-or-run task", () => {
    const tasks: DiscoveredTask[] = [
      { name: "install", command: "npm install", source: "package.json", category: "install" },
      { name: "build", command: "npm run build", source: "package.json", category: "build" },
      { name: "test", command: "npm run test", source: "package.json", category: "test" },
      { name: "dev", command: "npm run dev", source: "package.json", category: "dev" },
      { name: "start", command: "npm start", source: "package.json", category: "run" },
    ];
    expect(suggestGettingStarted(tasks).map((t) => t.command)).toEqual([
      "npm install",
      "npm run build",
      "npm run test",
      "npm run dev",
    ]);
  });

  it("falls back to a run task when there is no dev task, and skips missing categories", () => {
    const tasks: DiscoveredTask[] = [
      { name: "build", command: "make build", source: "Makefile", category: "build" },
      { name: "start", command: "make start", source: "Makefile", category: "run" },
    ];
    expect(suggestGettingStarted(tasks).map((t) => t.command)).toEqual([
      "make build",
      "make start",
    ]);
  });

  it("returns [] when nothing matches", () => {
    expect(suggestGettingStarted([])).toEqual([]);
  });
});
