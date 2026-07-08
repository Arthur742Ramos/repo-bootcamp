import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

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

  it("returns [] when there is no tasks block", () => {
    expect(parseTaskfile("version: '3'\n")).toEqual([]);
  });
});

describe("parseDockerCompose", () => {
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
});

describe("parsePyproject", () => {
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

  it("defaults to npm when nothing indicates otherwise", async () => {
    const dir = await repoWith({ "README.md": "hi" });
    expect(await detectPackageManager(dir)).toBe("npm");
  });
});

describe("discoverTasks", () => {
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
