import { describe, expect, it } from "vitest";
import { findGuidanceCommand } from "../src/command-guidance.js";
import { generateBootcamp, generateOnboarding } from "../src/generator.js";
import { parsePackageJsonScripts, parseTaskfile } from "../src/tasks.js";
import type { Command, BootcampOptions, RepoFacts } from "../src/types.js";

const roles = ["build", "test", "dev"] as const;
function selection(command: Command) {
  return roles.filter((role) => findGuidanceCommand([command], role) === command);
}
const options: BootcampOptions = {
  branch: "",
  focus: "all",
  audience: "all",
  output: "output",
  maxFiles: 200,
  noClone: true,
  verbose: false,
};
function facts(commands: Command[]): RepoFacts {
  return {
    repoName: "local/declared-dot-fixture",
    purpose: "Library",
    stack: { languages: [], frameworks: [], hasDocker: false, hasCi: false },
    quickstart: { prerequisites: [], steps: [], commands, commonErrors: [], sources: [] },
    structure: { keyDirs: [], entrypoints: [], testDirs: [], docsDirs: [] },
    ci: { workflows: [], mainChecks: [], sources: [] },
    contrib: { howToAddFeature: [], howToAddTest: [], sources: [] },
    architecture: {
      overview: "Library",
      components: [],
      dataFlow: "Library calls",
      keyAbstractions: [],
      sources: [],
    },
    firstTasks: [],
  };
}

describe("declared dotted named-task guidance", () => {
  it.each(["npm", "pnpm", "yarn", "bun"] as const)(
    "recognizes only declared literal %s run targets",
    (runner) => {
      for (const [name, role] of [
        ["build.prod", "build"],
        ["test.unit", "test"],
        ["app:build.prod", "build"],
        ["app:test.unit", "test"],
        ["build.test.prod", "build"],
        ["watch.test.build", "test"],
      ] as const) {
        const discovered = parsePackageJsonScripts(
          JSON.stringify({ scripts: { [name]: "echo NEVER_RUN" } }),
          runner
        )[0];
        expect(selection(discovered)).toEqual([role]);
        for (const action of runner === "npm" ? ["run", "run-script"] : ["run"]) {
          const command = {
            name,
            command: `  ${runner} ${action} '${name}'  `,
            source: "package.json",
          };
          const before = JSON.stringify(command);
          expect(selection(command)).toEqual([role]);
          expect(JSON.stringify(command)).toBe(before);
        }
      }
    }
  );

  it("recognizes declared Task targets while preserving whole literal command bytes", () => {
    for (const [name, role] of [
      ["build.prod", "build"],
      ["test.unit", "test"],
      ["app:build.prod", "build"],
      ["app:test.unit", "test"],
    ] as const) {
      const command = { name, command: `task "${name}"`, source: "Taskfile" };
      expect(selection(command)).toEqual([role]);
      expect(findGuidanceCommand([command], role)?.command).toBe(`task "${name}"`);
    }
  });

  it.each(["npm", "task"])(
    "keeps dotted setup targets out of semantic fallback for %s",
    (runner) => {
      for (const target of ["setup.test", "install.build", "app:setup.test", "app:install.build"]) {
        for (const name of [target, "dev", "test", "build"]) {
          expect(
            selection({
              name,
              command: runner === "npm" ? `npm run ${target}` : `task ${target}`,
              source: runner === "npm" ? "package.json" : "Taskfile",
            })
          ).toEqual([]);
        }
      }
    }
  );

  it.each([
    "build.js",
    "test.py",
    "build.prod.js",
    "build.preview",
    "test.fast",
    "build.test.fixtures",
    ".build.prod",
    "build..prod",
    "build.prod.",
    "scripts/build.prod",
    "scripts\\build.prod",
    "app::build.prod",
    ":build.prod",
    "app:build.prod:",
    "app.dot:build.prod",
    "contest",
  ])("does not infer a new role from declared target %s", (name) => {
    expect(selection({ name, command: `npm run '${name}'`, source: "package.json" })).toEqual([]);
    expect(selection({ name, command: `task '${name}'`, source: "Taskfile" })).toEqual([]);
  });

  it.each([
    ["build.prod", "npm run build.prod", "README.md"],
    ["build.prod", "npm run build.prod", "other/package.json"],
    ["build.prod", "task build.prod", "README.md"],
    ["build.prod", "task build.prod", "Taskfile.yml"],
    ["inspect", "npm run build.prod", "package.json"],
    ["inspect", "task build.prod", "Taskfile"],
    ["build.prod", "npm run 'Build.prod'", "package.json"],
    ["build.prod", "npm build.prod", "package.json"],
    ["build.prod", "yarn build.prod", "package.json"],
    ["build.prod", "pnpm run-script build.prod", "package.json"],
    ["build.prod", "yarn run-script build.prod", "package.json"],
    ["build.prod", "bun run-script build.prod", "package.json"],
    ["build.prod", "composer run build.prod", "package.json"],
    ["build.prod", "npx npm run build.prod", "package.json"],
    ["build.prod", "make build.prod", "Makefile"],
    ["build.prod", "just build.prod", "Justfile"],
    ["build.prod", "poetry run build.prod", "pyproject.toml"],
    ["build.prod", "node build.prod", "package.json"],
    ["build.prod", "echo ready", "package.json"],
  ])("keeps provenance/runner/name boundaries %s / %s / %s", (name, command, source) => {
    expect(selection({ name, command, source })).toEqual([]);
  });

  it.each([
    "npm run build.prod --help",
    "npm run build.prod -h",
    "npm run build.prod --version",
    "npm run build.prod && npm install",
    "npm run build.prod | cat",
    "npm run build.prod; echo done",
    "npm run $(echo build.prod)",
    "npm run build.prod\necho done",
  ])("preserves simple invocation guards for %s", (command) => {
    expect(selection({ name: "build.prod", command, source: "package.json" })).toEqual([]);
  });

  it.each([
    ["npm run build.prod -- --target=prod", "package.json"],
    ["npm run build.prod --if-present", "package.json"],
    ["npm run build.prod test.unit", "package.json"],
    ["npm --workspace app run build.prod", "package.json"],
    ["task build.prod setup", "Taskfile"],
    ["task build.prod test.unit", "Taskfile"],
    ["task build.prod --parallel", "Taskfile"],
    ["task --parallel build.prod", "Taskfile"],
    ["task build.prod ENV=prod", "Taskfile"],
  ])("does not infer a dotted role from extra targets/options %s", (command, source) => {
    expect(selection({ name: "build.prod", command, source })).toEqual([]);
  });

  it("retains prior invocation precedence and explicit semantic label contracts", () => {
    for (const [name, command, source, expected] of [
      ["build", "npm test", "package.json", "test"],
      ["dev", "npm run build.prod", "package.json", "dev"],
      ["test:build.prod", "npm run test:build.prod", "package.json", "test"],
      ["dev:build.prod", "task dev:build.prod", "Taskfile", "dev"],
      ["build", "poetry run build-tools.py", "README.md", "build"],
      ["inspect", "poetry run build-tools.py", "README.md", null],
      ["build:test-fixtures", "npm run build:test-fixtures", "package.json", "build"],
      ["watch:test-build", "npm run watch:test-build", "package.json", "test"],
      ["build-prod", "just build-prod", "Justfile", "build"],
      ["test unit", "npm run 'test unit'", "package.json", "test"],
    ] as const)
      expect(selection({ name, command, source })).toEqual(expected ? [expected] : []);
  });

  it.each(["npm", "task"])("uses actual %s discovery in both newcomer guides", (runner) => {
    const tasks =
      runner === "npm"
        ? parsePackageJsonScripts(
            JSON.stringify({
              scripts: { "app:build.prod": "echo NEVER_RUN", "app:test.unit": "echo NEVER_RUN" },
            })
          )
        : parseTaskfile(
            "version: '3'\ntasks:\n  app:build.prod: {cmds: ['echo NEVER_RUN']}\n  app:test.unit: {cmds: ['echo NEVER_RUN']}\n"
          );
    const commands = tasks.map(({ name, command, source }) => ({ name, command, source }));
    const original = JSON.stringify(commands);
    const docs = facts(commands);
    const prefix = runner === "npm" ? "npm run" : "task";
    expect(generateBootcamp(docs, options)).toContain(`Build/verify: \`${prefix} app:build.prod\``);
    expect(generateOnboarding(docs)).toContain(
      `## Running Tests\n\n\`\`\`bash\n${prefix} app:test.unit\n\`\`\``
    );
    expect(JSON.stringify(commands)).toBe(original);
  });
});
