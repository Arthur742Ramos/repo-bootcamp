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
  parseGoMod,
  parseJustfile,
  parseMakefile,
  parsePackageJsonScripts,
  parsePyproject,
  parseTaskfile,
  suggestGettingStarted,
  toCommands,
  type DiscoveredTask,
  type PackageManager,
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
  it.each<PackageManager>(["npm", "pnpm", "yarn", "bun"])(
    "preserves exact literal script arguments for %s",
    (manager) => {
      const argumentsByName = {
        "test:e2e": "test:e2e",
        "test unit": "'test unit'",
        "test'quoted": `'test'"'"'quoted'`,
        'test"quoted': `'test"quoted'`,
        "test;literal": "'test;literal'",
        test$HOME: "'test$HOME'",
        "test`literal`": "'test`literal`'",
        "test|literal": "'test|literal'",
        "test&literal": "'test&literal'",
        "test\\literal": "'test\\literal'",
        "test*literal": "'test*literal'",
        "test(literal)": "'test(literal)'",
        "test#literal": "'test#literal'",
        "--test": "-- --test",
        "-t": "-- -t",
      };
      const tasks = parsePackageJsonScripts(
        JSON.stringify({
          scripts: Object.fromEntries(
            Object.keys(argumentsByName).map((name) => [name, "literal body"])
          ),
        }),
        manager
      );
      expect(tasks.map((task) => task.name)).toEqual(Object.keys(argumentsByName));
      expect(tasks.map((task) => task.command)).toEqual(
        Object.values(argumentsByName).map((argument) => `${manager} run ${argument}`)
      );
      expect(
        tasks.every((task) => task.source === "package.json" && task.description === "literal body")
      ).toBe(true);
      expect(tasks[1].category).toBe("test");
      expect(toCommands(tasks).map((task) => task.command)).toEqual(
        tasks.map((task) => task.command)
      );
      expect(suggestGettingStarted(tasks).map((task) => task.command)).toContain(
        `${manager} run test:e2e`
      );
    }
  );

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

  it("omits required-argument recipes whose bare invocation native Just rejects", () => {
    expect(parseJustfile("deploy env:\n    echo {{env}}\n")).toEqual([]);
    expect(parseJustfile("test +FILES:\n    echo {{FILES}}\n")).toEqual([]);
    expect(parseJustfile("dev target mode='debug':\n    echo {{target}}\n")).toEqual([]);
  });

  it.each([
    "mode='debug'",
    'mode="debug"',
    "target='some: path'",
    "mode=''",
    "$mode='debug'",
    "+FLAGS='-q'",
    "*FILES",
    "*FILES='one'",
    "+$FILES='one'",
    "build-mode = 'debug'",
    "mode='debug' target='app'",
    String.raw`mode="quote\"slash\\"`,
    String.raw`mode="\u{1F916}"`,
    "mode='{{literal braces}}'",
  ])("advertises native zero-argument signature %s with a bare command", (parameters) => {
    const tasks = parseJustfile(`build ${parameters}:\n    @echo literal\n`);
    expect(tasks).toEqual([
      {
        name: "build",
        command: "just build",
        source: "justfile",
        category: "build",
        description: undefined,
      },
    ]);
  });

  it("keeps public recipe order and descriptions while excluding private helpers", () => {
    const tasks = parseJustfile(`# Hidden setup
[private, no-cd]
setup:
    @echo helper
_helper:
    @echo helper
# Build with a default
[no-cd]
@build mode='debug':
    @echo {{mode}}
# Test locally
@test *FILES:
    @echo {{FILES}}
`);
    expect(tasks.map((task) => [task.command, task.description])).toEqual([
      ["just build", "Build with a default"],
      ["just test", "Test locally"],
    ]);
  });

  it("conservatively omits expression defaults and unsupported argument attributes", () => {
    expect(
      parseJustfile(`mode := 'debug'
build value=mode:
    @echo {{value}}
test value=(mode + '-test'):
    @echo {{value}}
dev value=x'$MODE':
    @echo {{value}}
[arg('FILES', min='2')]
check *FILES:
    @echo {{FILES}}
[quiet]
quiet:
    @echo unsupported
public:
    @echo public
`).map((task) => task.command)
    ).toEqual(["just public"]);
  });

  it.each(["[ no-cd ]", "[\tno-cd\t]", "[ no-cd ] # Local working directory"])(
    "preserves native whitespace in supported attribute %s",
    (attribute) => {
      expect(
        parseJustfile(`${attribute}\nbuild mode='debug':\n    @echo literal\n`).map(
          (task) => task.command
        )
      ).toEqual(["just build"]);
    }
  );

  it("keeps multiline private/unsupported attributes associated with their recipes", () => {
    expect(
      parseJustfile(`[no-cd,
private]
setup:
    @echo hidden
[
  private,
  no-cd
]
hidden:
    @echo hidden
[linux,
no-cd]
platform:
    @echo conditional
[
  no-cd
]
build mode='debug':
    @echo literal
`).map((task) => task.command)
    ).toEqual(["just build"]);
  });

  it("keeps opaque multiline argument and documentation attributes on their recipes", () => {
    const tasks = parseJustfile(`set unstable
set lists
[arg(
  'FILES',
  min='2'
)]
check *FILES:
    @echo literal
[doc(
  '''
fake]
'''
)]
documented:
    @echo literal
public:
    @echo literal
`);
    expect(tasks.map((task) => task.command)).toEqual(["just public"]);
  });

  it("shields recipe-looking data inside multiline strings and backticks", () => {
    const tasks = parseJustfile(
      "text := '''\nsetup:\n[private]\n'''\ncommand := `\ntest:\n`\n# Build\nbuild:\n    @echo literal\n"
    );
    expect(tasks.map((task) => [task.command, task.description])).toEqual([
      ["just build", "Build"],
    ]);
  });

  it("does not take attributes or comments from recipe bodies", () => {
    expect(
      parseJustfile("build:\n    [private]\n    # body comment\ntest:\n    @echo test\n").map(
        (task) => [task.command, task.description]
      )
    ).toEqual([
      ["just build", undefined],
      ["just test", undefined],
    ]);
  });

  it.each(["'''", '\"\"\"'])(
    "shields indented multiline values inside parentheses with %s delimiters",
    (quote) => {
      const content = `example := (\n  ${quote}\nsetup:\n[private]\n${quote}\n)\nbuild:\n    @echo literal\n`;
      expect(parseJustfile(content).map((task) => task.command)).toEqual(["just build"]);
    }
  );

  it("shields multiline literal concatenations without evaluating them", () => {
    expect(
      parseJustfile(
        "example := (\n  'prefix' + '''\nsetup:\n'''\n)\nbuild:\n    @echo literal\n"
      ).map((task) => task.command)
    ).toEqual(["just build"]);
  });

  it("shields multiline list data without evaluating unsupported expressions", () => {
    expect(
      parseJustfile(
        "set unstable\nset lists\nexample := [\n  '''\nsetup:\n'''\n]\nbuild:\n    @echo literal\n"
      ).map((task) => task.command)
    ).toEqual(["just build"]);
  });

  it.each([
    "build mode='x'+suffix:",
    "build mode='x'other='y':",
    "build *FILES extra='x':",
    'build mode="bad\\z":',
    'build mode="\\u{D800}":',
    'build mode="\\u{110000}":',
    "build $+FILES='one':",
    "build mode=:",
  ])("does not advertise unsupported or malformed signatures: %s", (header) => {
    expect(parseJustfile(header + "\n    @echo literal\n")).toEqual([]);
  });

  it("keeps large literal defaults and example blocks bounded", () => {
    const content =
      "example := '''\n" +
      "fake:\n".repeat(32_000) +
      "'''\nbuild mode='" +
      "literal ".repeat(32_000) +
      "':\n    @echo literal\n";
    expect(parseJustfile(content).map((task) => task.command)).toEqual(["just build"]);
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

describe("parseGoMod", () => {
  it.each([
    "module example.invalid/demo\ngo 1.22\n",
    '// module ignored.invalid/example\nmodule "example.invalid/demo" // selected\n',
    "module example.invalid/demo\nrequire (\n example.invalid/dependency v1.0.0\n) // dependencies\n",
    "module example.invalid/demo\r\ngo 1.22\r\ntoolchain go1.22.0\r\n",
    "module example.invalid/demo\ngo 1.23\ngodebug (\n default=go1.23\n)\n",
  ])("qualifies literal module declarations without interpolating their path (%j)", (content) => {
    const tasks = parseGoMod(content);
    expect(
      tasks.map(({ name, command, source, category }) => ({ name, command, source, category }))
    ).toEqual([
      { name: "build", command: "go build ./...", source: "go.mod", category: "build" },
      { name: "test", command: "go test ./...", source: "go.mod", category: "test" },
    ]);
    expect(tasks.every((task) => task.description?.startsWith("Go module convention:"))).toBe(true);
  });

  it.each([
    "",
    "module `example.invalid/demo`\n",
    "module example.invalid/demo\nignore ./pkg\n",
    "// module example.invalid/demo",
    "go 1.22\n",
    "module",
    "module ()",
    'module "example.invalid/demo',
    'module "example.invalid/demo\\n"',
    "module example.invalid/../demo",
    "module example.invalid/.hidden",
    "module example.invalid/demo/",
    "module example.invalid/demo;echo injected",
    "module example.invalid/$(echo injected)",
    "module example.invalid/demo\nmodule example.invalid/other",
    "module example.invalid/demo extra",
    "require (\nmodule example.invalid/fake\n)\n",
    "module example.invalid/demo\nrequire (\n",
    "module example.invalid/demo\nunknown directive\n",
    "/* module example.invalid/demo */",
  ])("declines missing, malformed or ambiguous module qualification (%j)", (content) => {
    expect(parseGoMod(content)).toEqual([]);
  });
});

describe("discoverTasks", () => {
  it.each([
    "demo_windows.go",
    "pkg/demo_linux_amd64.go",
    "demo_amd64.go",
    "demo_darwin.go",
    "demo_darwin_arm64.go",
    "demo_nacl.go",
    "demo_zos.go",
    "demo_amd64p32.go",
    "demo_riscv.go",
    "demo_windows.extra.go",
    "demo_windows_test.extra.go",
    "foo_linux_test.extra.go",
    "windows_test.go",
  ])("does not use implicitly constrained source as portable Go evidence: %s", async (name) => {
    const dir = await repoWith({
      "go.mod": "module example.invalid/demo\n",
      [name]: "package demo\n",
    });
    expect(await discoverTasks(dir)).toEqual([]);
    expect(await discoverTasks(dir, { taskfileFiles: new Set(["go.mod", name]) })).toEqual([]);
  });

  it.each([
    "demo_custom.go",
    "windows.go",
    "amd64.go",
    "demo_WINDOWS.go",
    "demo_unix.go",
    "demo_windows_custom.go",
    "demo.extra_windows.go",
    "windows_test.extra.go",
    "amd64_test.extra.go",
  ])("retains ordinary Go filenames without known constraint suffixes: %s", async (name) => {
    const dir = await repoWith({
      "go.mod": "module example.invalid/demo\n",
      [name]: "package demo\n",
    });
    expect((await discoverTasks(dir)).map((task) => task.command)).toEqual([
      "go build ./...",
      "go test ./...",
    ]);
  });

  it("qualifies mixed Go packages through selected ordinary source and preserves callbacks", async () => {
    const module = "module example.invalid/demo\n";
    const dir = await repoWith({
      "go.mod": module,
      "demo_windows.go": "package demo\n",
      "demo_custom.go": "package demo\n",
    });
    const reads: [string, string][] = [];
    const evidence: [string, string][] = [];
    const tasks = await discoverTasks(dir, {
      onGoModRead: (path, content) => reads.push([path, content]),
      onGoPackageEvidence: (path, content) => evidence.push([path, content]),
      onTaskfileRead: () => {
        throw new Error("Go evidence must not invoke the Taskfile callback");
      },
    });
    expect(tasks.map((task) => task.command)).toEqual(["go build ./...", "go test ./..."]);
    expect(reads).toEqual([["go.mod", module]]);
    expect(evidence.map(([path]) => path)).toEqual([".", "demo_custom.go"]);
    expect(
      await discoverTasks(dir, { taskfileFiles: new Set(["go.mod", "demo_windows.go"]) })
    ).toEqual([]);
  });

  it.each([
    {},
    { "nested/go.mod": "module example.invalid/nested\n", "nested/demo.go": "package demo\n" },
    { "vendor/demo.go": "package demo\n" },
    { "testdata/demo.go": "package demo\n" },
    { "_private/demo.go": "package demo\n" },
    { ".private/demo.go": "package demo\n" },
    { "_demo.go": "package demo\n" },
    { ".demo.go": "package demo\n" },
    { "demo_test.go": "package demo\n" },
    { "demo.go": "" },
    { "demo.go": "// package demo\n" },
    { "demo.go": "/* package demo */" },
    { "demo.go": "//go:build ignore\n\npackage demo\n" },
    { "demo.go": "package documentation\n" },
  ])(
    "does not advertise Go conventions without supported in-module package evidence (%j)",
    async (files) => {
      const dir = await repoWith({ "go.mod": "module example.invalid/demo\ngo 1.22\n", ...files });
      expect(await discoverTasks(dir)).toEqual([]);
    }
  );

  it("honors source exclusions/budgets and nested markers absent from inventory", async () => {
    const dir = await repoWith({
      "go.mod": "module example.invalid/demo\n",
      "pkg/demo.go": "package demo\n",
    });
    expect(await discoverTasks(dir, { taskfileFiles: new Set(["go.mod"]) })).toEqual([]);
    const sourceInventory = new Set(["go.mod", "pkg/demo.go"]);
    expect((await discoverTasks(dir, { taskfileFiles: sourceInventory })).length).toBe(2);
    await writeFile(join(dir, "pkg/go.mod"), "module example.invalid/nested\n");
    expect(await discoverTasks(dir, { taskfileFiles: sourceInventory })).toEqual([]);
    await rm(join(dir, "pkg/go.mod"));
    await writeFile(join(dir, "pkg/demo.go"), " ".repeat(256 * 1024) + "package demo\n");
    expect(await discoverTasks(dir, { taskfileFiles: sourceInventory })).toEqual([]);
  });

  it("bounds total source reads and skips symlink source trees", async () => {
    const padding = "/*" + "x".repeat(256 * 1024 - 4) + "*/";
    const dir = await repoWith({
      "go.mod": "module example.invalid/demo\n",
      "a.go": padding,
      "b.go": padding,
      "c.go": padding,
      "d.go": padding,
      "z.go": "package demo\n",
    });
    expect(await discoverTasks(dir)).toEqual([]);
    await rm(join(dir, "a.go"));
    expect((await discoverTasks(dir)).length).toBe(2);
    const linked = await repoWith({
      "go.mod": "module example.invalid/linked\n",
      "real/demo.go": "package demo\n",
    });
    await symlink(join(linked, "real"), join(linked, "alias"), "junction");
    expect(
      await discoverTasks(linked, { taskfileFiles: new Set(["go.mod", "alias/demo.go"]) })
    ).toEqual([]);
  });
  it("uses the same bounded Go evidence regardless of selected inventory order", async () => {
    const dir = await repoWith({
      "go.mod": "module example.invalid/demo\n",
      "a.go": "// no package\n",
      "z.go": "package demo\n",
    });
    const observe = async (paths: string[]) => {
      const evidence: [string, string][] = [];
      const tasks = await discoverTasks(dir, {
        taskfileFiles: new Set(paths),
        onGoPackageEvidence: (path, value) => evidence.push([path, value]),
      });
      return { tasks, evidence };
    };
    expect(await observe(["go.mod", "a.go", "z.go"])).toEqual(
      await observe(["z.go", "go.mod", "a.go"])
    );
  });

  it("appends Go conventions after declared tasks and keeps the explicit first-session sequence", async () => {
    const dir = await repoWith({
      "go.mod": "module example.invalid/demo\ngo 1.22\n",
      "demo.go": "package demo\n",
      Makefile: "build:\n\t@echo build\ntest:\n\t@echo test\n",
    });
    const tasks = await discoverTasks(dir);
    expect(tasks.map((task) => task.command)).toEqual([
      "make build",
      "make test",
      "go build ./...",
      "go test ./...",
    ]);
    expect(suggestGettingStarted(tasks).map((task) => task.command)).toEqual([
      "make build",
      "make test",
    ]);
  });

  it("qualifies only the selected module root and never a workspace or ancestor", async () => {
    const dir = await repoWith({
      "go.work": "go 1.22\nuse ./packages/app\n",
      "packages/app/go.mod": "module example.invalid/app\n",
      "packages/app/pkg/demo.go": "package demo\n",
    });
    expect(await discoverTasks(dir)).toEqual([]);
    expect((await discoverTasks(join(dir, "packages/app"))).map((task) => task.command)).toEqual([
      "go build ./...",
      "go test ./...",
    ]);
    expect(await discoverTasks(join(dir, "packages/app/pkg"))).toEqual([]);
  });

  it("honors selected scan evidence and reports exact loaded module content for fingerprints", async () => {
    const content = "module example.invalid/demo\ngo 1.22\n";
    const dir = await repoWith({ "go.mod": content, "demo.go": "package demo\n" });
    const reads: [string, string][] = [];
    const omitted = await discoverTasks(dir, {
      taskfileFiles: new Set(["demo.go"]),
      onGoModRead: (path, text) => reads.push([path, text]),
    });
    expect(omitted).toEqual([]);
    expect(reads).toEqual([]);
    expect(
      (
        await discoverTasks(dir, {
          taskfileFiles: new Set(["go.mod", "demo.go"]),
          onGoModRead: (path, text) => reads.push([path, text]),
          onTaskfileRead: () => {
            throw new Error("Go evidence must not invoke the Taskfile callback");
          },
        })
      ).length
    ).toBe(2);
    expect(reads).toEqual([["go.mod", content]]);
    await writeFile(join(dir, "go.mod"), "malformed\n");
    expect(
      await discoverTasks(dir, { onGoModRead: (path, text) => reads.push([path, text]) })
    ).toEqual([]);
    expect(reads.at(-1)).toEqual(["go.mod", "malformed\n"]);
  });

  it("does not read an external Go manifest or a directory masquerading as one", async () => {
    const external = await repoWith({ "go.mod": "module example.invalid/external\n" });
    const dir = await repoWith({ "demo.go": "package demo\n" });
    if (process.platform !== "win32") {
      await symlink(join(external, "go.mod"), join(dir, "go.mod"));
      expect(await discoverTasks(dir)).toEqual([]);
      await rm(join(dir, "go.mod"));
    }
    await symlink(external, join(dir, "go.mod"), "junction");
    expect(await discoverTasks(dir)).toEqual([]);
    await rm(join(dir, "go.mod"));
    await mkdir(join(dir, "go.mod"));
    expect(await discoverTasks(dir)).toEqual([]);
  });
  it.each(["justfile", "Justfile", "JUSTFILE", ".justfile", ".JUSTFILE"])(
    "uses one native case-insensitive Just filename entry: %s",
    async (name) => {
      const dir = await repoWith({ [name]: "build mode='debug':\n    @echo {{mode}}\n" });
      expect((await discoverTasks(dir)).map((task) => task.command)).toEqual(["just build"]);
    }
  );

  it("omits ambiguous default Just sources without affecting other ecosystems", async () => {
    const dir = await repoWith({
      justfile: "build:\n    @echo build\n",
      ".justfile": "test:\n    @echo test\n",
      Makefile: "verify:\n\t@echo verify\n",
      "package.json": JSON.stringify({ scripts: { dev: "vite" } }),
    });
    expect((await discoverTasks(dir)).map((task) => task.command)).toEqual([
      "npm run dev",
      "make verify",
    ]);
  });

  it("uses the selected child Justfile independently of ambiguous parent candidates", async () => {
    const dir = await repoWith({
      justfile: "outer:\n    @echo outer\n",
      ".justfile": "other:\n    @echo other\n",
      "packages/app/Justfile": "build mode='debug':\n    @echo {{mode}}\n",
    });
    expect((await discoverTasks(join(dir, "packages/app"))).map((task) => task.command)).toEqual([
      "just build",
    ]);
  });

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
