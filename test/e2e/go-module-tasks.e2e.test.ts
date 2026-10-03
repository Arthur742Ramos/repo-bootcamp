import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoFacts } from "../../src/types.js";
import { runCli } from "./helpers.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function facts(): RepoFacts {
  return {
    repoName: "local/go-fixture",
    purpose: "An owned Go library",
    description: "Offline Go module command fixture.",
    confidence: "high",
    sources: ["go.mod", "README.md"],
    stack: {
      languages: ["Go"],
      frameworks: [],
      buildSystem: "Go",
      packageManager: null,
      hasDocker: false,
      hasCi: false,
    },
    quickstart: {
      prerequisites: ["Go installed"],
      steps: [],
      commands: [],
      commonErrors: [],
      sources: ["go.mod"],
    },
    structure: {
      keyDirs: [{ path: ".", purpose: "Go package", keyFiles: ["demo.go"] }],
      entrypoints: [{ path: "demo.go", type: "library", description: "Go package" }],
      testDirs: ["."],
      docsDirs: [],
      sources: ["demo.go"],
    },
    ci: { workflows: [], mainChecks: [], sources: [] },
    contrib: {
      howToAddFeature: ["Update the Go package"],
      howToAddTest: ["Add a Go test"],
      codeStyle: "Go",
      sources: ["demo.go"],
    },
    architecture: {
      overview: "One Go package",
      components: [{ name: "Package", description: "Go library", directory: "." }],
      dataFlow: "Library calls",
      keyAbstractions: [],
      codeExamples: [],
      sources: ["demo.go"],
    },
    firstTasks: [],
    runbook: { applicable: false, deploySteps: [], observability: [], incidents: [], sources: [] },
  };
}

async function fixture(files: Record<string, string>) {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-go-e2e-"));
  dirs.push(base);
  const repo = join(base, "repo");
  await mkdir(repo);
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(repo, name, ".."), { recursive: true });
    await writeFile(join(repo, name), text);
  }
  const response = join(base, "response.json");
  await writeFile(response, JSON.stringify(facts()));
  return {
    base,
    repo,
    response,
    env: { NODE_ENV: "test", REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: response },
  };
}

const moduleFiles = {
  "go.mod": "module example.invalid/demo\ngo 1.22\n",
  "demo.go": "package demo\nfunc Value() int { return 42 }\n",
  "demo_test.go":
    'package demo\nimport "testing"\nfunc TestValue(t *testing.T) { if Value() != 42 { t.Fatal("value") } }\n',
};

describe("Go module conventions", () => {
  it("omits known filename constraints through actual tasks CLI and retains ordinary filename evidence", async () => {
    for (const name of ["demo_windows.go", "pkg/demo_linux_amd64.go", "demo_amd64.go"]) {
      const { repo } = await fixture({
        "go.mod": moduleFiles["go.mod"],
        [name]: moduleFiles["demo.go"],
      });
      const constrained = await runCli(["tasks", repo, "--json"]);
      expect(constrained.exitCode).toBe(0);
      expect(JSON.parse(constrained.stdout).tasks).toEqual([]);
      await writeFile(join(repo, "windows.go"), moduleFiles["demo.go"]);
      const mixed = await runCli(["tasks", repo, "--json"]);
      expect(mixed.exitCode).toBe(0);
      expect(JSON.parse(mixed.stdout).gettingStarted).toEqual(["go build ./...", "go test ./..."]);
    }
  });

  it.each([false, true])(
    "omits constrained-only generated guidance in fast=%s and respects ordinary source exclusions",
    async (fast) => {
      const { repo, base, env } = await fixture({
        "go.mod": moduleFiles["go.mod"],
        "demo_darwin_arm64.go": moduleFiles["demo.go"],
      });
      const generate = async (name: string, args: string[] = []) => {
        const output = join(base, name);
        const result = await runCli(
          [
            repo,
            "--no-clone",
            "--no-cache",
            "--output",
            output,
            ...(fast ? ["--fast"] : []),
            ...args,
          ],
          env
        );
        expect(result.exitCode).toBe(0);
        return {
          commands: JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8")).quickstart
            .commands,
          onboarding: await readFile(join(output, "ONBOARDING.md"), "utf8"),
        };
      };
      const constrained = await generate("constrained");
      expect(constrained.commands).toEqual([]);
      expect(constrained.onboarding).not.toContain("go test ./...");
      await writeFile(join(repo, "demo_custom.go"), moduleFiles["demo.go"]);
      const mixed = await generate("mixed");
      expect(mixed.commands.map(({ command }: { command: string }) => command)).toEqual([
        "go build ./...",
        "go test ./...",
      ]);
      expect(mixed.onboarding).toContain("go test ./...");
      const excluded = await generate("excluded", ["--exclude", "demo_custom.go"]);
      expect(excluded.commands).toEqual([]);
      expect(excluded.onboarding).not.toContain("go test ./...");
    }
  );

  it("omits native-invalid module quotes and package-free or unsupported source roots", async () => {
    const cases: Record<string, Record<string, string>> = {
      empty: { "go.mod": moduleFiles["go.mod"] },
      nested: {
        "go.mod": moduleFiles["go.mod"],
        "nested/go.mod": "module example.invalid/nested\n",
        "nested/demo.go": moduleFiles["demo.go"],
      },
      raw: {
        "go.mod": "module `example.invalid/demo`\ngo 1.22\n",
        "demo.go": moduleFiles["demo.go"],
      },
      skipped: {
        "go.mod": moduleFiles["go.mod"],
        "vendor/demo.go": moduleFiles["demo.go"],
        "testdata/demo.go": moduleFiles["demo.go"],
        ".hidden/demo.go": moduleFiles["demo.go"],
        "_hidden/demo.go": moduleFiles["demo.go"],
        "_demo.go": moduleFiles["demo.go"],
        ".demo.go": moduleFiles["demo.go"],
      },
      testOnly: { "go.mod": moduleFiles["go.mod"], "demo_test.go": moduleFiles["demo_test.go"] },
      constrained: {
        "go.mod": moduleFiles["go.mod"],
        "demo.go": "//go:build ignore\n\n" + moduleFiles["demo.go"],
      },
    };
    for (const files of Object.values(cases)) {
      const { repo } = await fixture(files);
      const result = await runCli(["tasks", repo, "--json"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).tasks).toEqual([]);
    }
  });
  it("reports build/test conventions with categories and preserves explicit task precedence", async () => {
    const { repo } = await fixture(moduleFiles);
    const json = await runCli(["tasks", repo, "--json"]);
    expect(json.exitCode).toBe(0);
    const payload = JSON.parse(json.stdout);
    expect(
      payload.tasks.map(
        ({
          name,
          command,
          source,
          category,
        }: {
          name: string;
          command: string;
          source: string;
          category: string;
        }) => ({ name, command, source, category })
      )
    ).toEqual([
      { name: "build", command: "go build ./...", source: "go.mod", category: "build" },
      { name: "test", command: "go test ./...", source: "go.mod", category: "test" },
    ]);
    expect(payload.gettingStarted).toEqual(["go build ./...", "go test ./..."]);
    const filtered = await runCli(["tasks", repo, "--category", "test", "--json"]);
    expect(
      JSON.parse(filtered.stdout).tasks.map((task: { command: string }) => task.command)
    ).toEqual(["go test ./..."]);
    await writeFile(join(repo, "Makefile"), "build:\n\t@echo build\ntest:\n\t@echo test\n");
    const declared = await runCli(["tasks", repo, "--json"]);
    expect(declared.exitCode).toBe(0);
    expect(JSON.parse(declared.stdout).gettingStarted).toEqual(["make build", "make test"]);
  });

  it.each([false, true])(
    "generates root and selected module guidance in fast=%s without executing project commands",
    async (fast) => {
      const { repo, base, env } = await fixture({
        ...moduleFiles,
        "packages/app/go.mod": "module example.invalid/app\ngo 1.22\n",
        "packages/app/demo.go": "package demo\n",
        "go.work": "go 1.22\nuse (\n .\n ./packages/app\n)\n",
      });
      for (const subdir of [undefined, "packages/app"]) {
        const output = join(base, subdir ? "package-output" : "root-output");
        const result = await runCli(
          [
            repo,
            "--no-clone",
            "--no-cache",
            "--output",
            output,
            ...(subdir ? ["--subdir", subdir] : []),
            ...(fast ? ["--fast"] : []),
          ],
          env
        );
        expect(result.exitCode).toBe(0);
        const emitted = JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8"));
        expect(
          emitted.quickstart.commands.map((command: { command: string }) => command.command)
        ).toEqual(["go build ./...", "go test ./..."]);
        expect(
          emitted.quickstart.commands.every(
            (command: { source: string }) => command.source === "go.mod"
          )
        ).toBe(true);
        const bootcamp = await readFile(join(output, "BOOTCAMP.md"), "utf8");
        const onboarding = await readFile(join(output, "ONBOARDING.md"), "utf8");
        expect(bootcamp).toContain("Build/verify: `go build ./...`");
        expect(onboarding).toContain("go build ./...");
        expect(onboarding).toContain("go test ./...");
        expect(onboarding).not.toContain("git clone");
        const bashPath = join(repo, subdir ?? "").replace(/\\/g, "/");
        expect(onboarding.replace(/\\/g, "/")).toContain(bashPath);
        expect(onboarding).not.toContain("npm install");
      }
    }
  );

  it("omits workspace-only, ancestor and excluded manifests while preserving explicit analysis commands", async () => {
    const { repo, base, response, env } = await fixture({
      "go.work": "go 1.22\nuse ./packages/app\n",
      "packages/app/go.mod": moduleFiles["go.mod"],
      "packages/app/pkg/demo.go": moduleFiles["demo.go"],
    });
    for (const [name, args] of [
      ["workspace", []],
      ["ancestor", ["--subdir", "packages/app/pkg"]],
      ["excluded", ["--subdir", "packages/app", "--exclude", "go.mod"]],
      ["source-excluded", ["--subdir", "packages/app", "--exclude", "**/*.go"]],
    ] as [string, string[]][]) {
      const output = join(base, name);
      const result = await runCli(
        [repo, "--no-clone", "--no-cache", "--output", output, ...args],
        env
      );
      expect(result.exitCode).toBe(0);
      expect(
        JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8")).quickstart.commands
      ).toEqual([]);
      expect(await readFile(join(output, "ONBOARDING.md"), "utf8")).not.toContain("go build ./...");
    }
    const documented = facts();
    documented.quickstart.commands = [
      { name: "verify", command: "go test -race ./...", source: "README.md" },
    ];
    await writeFile(response, JSON.stringify(documented));
    const output = join(base, "documented");
    const result = await runCli(
      [repo, "--no-clone", "--no-cache", "--output", output, "--subdir", "packages/app"],
      env
    );
    expect(result.exitCode).toBe(0);
    expect(
      JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8")).quickstart.commands
    ).toEqual(documented.quickstart.commands);
    expect(await readFile(join(output, "ONBOARDING.md"), "utf8")).toContain("go test -race ./...");
  });
});
