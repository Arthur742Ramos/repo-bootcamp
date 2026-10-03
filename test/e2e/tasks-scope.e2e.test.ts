import { execFileSync } from "child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./helpers.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(remote = false) {
  const root = await mkdtemp(join(tmpdir(), "bootcamp-task-scope-"));
  dirs.push(root);
  const repo = join(root, "repository");
  const app = join(repo, "packages", "my app");
  const caller = join(root, "caller");
  await mkdir(join(app, "taskfiles"), { recursive: true });
  await mkdir(caller);
  for (const [dir, label] of [
    [repo, "root"],
    [app, "child"],
  ]) {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: label,
        version: "1.0.0",
        scripts: { [label + "-test"]: "echo owned" },
      })
    );
    await writeFile(join(dir, "Makefile"), label + "-build:\n\t@echo owned\n");
    await writeFile(join(dir, "README.md"), "# Owned " + label + "\n");
  }
  await writeFile(join(repo, "Taskfile.yml"), "version: '3'\ntasks:\n  root-task:\n    cmds: []\n");
  await writeFile(
    join(app, "Taskfile.yml"),
    "version: '3'\nincludes:\n  tools: ./taskfiles/tools.yml\n"
  );
  await writeFile(
    join(app, "taskfiles", "tools.yml"),
    "version: '3'\ntasks:\n  verify:\n    cmds: []\n"
  );
  await writeFile(join(repo, "file.txt"), "owned file\n");
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "Makefile"), "outside-build:\n\t@echo outside\n");
  await mkdir(join(repo, "packages", "second app"));
  await writeFile(
    join(repo, "packages", "second app", "Makefile"),
    "second-build:\n\t@echo owned\n"
  );
  for (const name of ["--keep-temp", "--verbose", "--branch", "--category"]) {
    await mkdir(join(repo, name));
    await writeFile(join(repo, name, "Makefile"), "flag-build:\n\t@echo owned\n");
  }
  await symlink(app, join(repo, "alias"), process.platform === "win32" ? "junction" : "dir");
  await symlink(
    outside,
    join(repo, "outside-alias"),
    process.platform === "win32" ? "junction" : "dir"
  );
  const env: NodeJS.ProcessEnv = {};
  const url = "https://github.com/owned/task-scope.git";
  if (remote) {
    const git = (args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    git(["init", "-b", "main"]);
    git(["config", "user.email", "owned@example.invalid"]);
    git(["config", "user.name", "Owned Task Scope"]);
    // Do not commit junctions: contained-alias controls are local only.
    git(["add", "package.json", "Makefile", "Taskfile.yml", "README.md", "file.txt", "packages"]);
    git(["add", "--", "--keep-temp", "--verbose", "--branch", "--category"]);
    git(["commit", "--no-gpg-sign", "-m", "Owned scope fixture"]);
    git(["checkout", "-b", "release/scope"]);
    await writeFile(join(app, "Makefile"), "child-release-build:\n\t@echo owned\n");
    git(["add", "packages"]);
    git(["commit", "--no-gpg-sign", "-m", "Owned release scope"]);
    git(["checkout", "main"]);
    const bare = join(root, "upstream.git");
    execFileSync("git", ["clone", "--bare", repo, bare], { stdio: "ignore" });
    Object.assign(env, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "url." + pathToFileURL(bare).href + ".insteadOf",
      GIT_CONFIG_VALUE_0: url,
    });
  }
  return { root, repo, app, caller, outside, url, env };
}
const childCommands = ["npm run child-test", "make child-build", "task tools:verify"];

describe("standalone task scope in the actual CLI", () => {
  it.each(["after", "before", "before-repo", "equals"])(
    "uses only package commands with %s option placement",
    async (placement) => {
      const f = await fixture();
      let args: string[];
      if (placement === "before") args = ["--subdir", "packages/my app", "tasks", f.repo, "--json"];
      else if (placement === "before-repo")
        args = ["tasks", "--subdir", "packages/my app", f.repo, "--json"];
      else if (placement === "equals")
        args = ["tasks", f.repo, "--subdir=packages/my app", "--json"];
      else args = ["tasks", f.repo, "--subdir", " ./packages/my app/ ", "--json"];
      const result = await runCli(args, {}, 60_000, f.caller);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.subdir).toBe("packages/my app");
      expect(data.tasks.map((t: { command: string }) => t.command)).toEqual(childCommands);
      expect(data.gettingStarted).toContain("make child-build");
      expect(data.gettingStarted).not.toContain("make root-build");
      expect(await readFile(join(f.app, "Makefile"), "utf8")).toContain("child-build");
    }
  );

  it("keeps root JSON shape/order and category behavior while reporting a scoped working directory", async () => {
    const f = await fixture();
    const root = await runCli(["tasks", f.repo, "--json"], {}, 60_000, f.caller);
    expect(root.exitCode).toBe(0);
    const data = JSON.parse(root.stdout);
    expect(data).not.toHaveProperty("subdir");
    expect(data.tasks.map((t: { command: string }) => t.command)).toEqual([
      "npm run root-test",
      "make root-build",
      "task root-task",
    ]);
    const filtered = await runCli(
      ["tasks", f.repo, "--subdir", "packages/my app", "--category", "build", "--json"],
      {},
      60_000,
      f.caller
    );
    expect(filtered.exitCode).toBe(0);
    expect(JSON.parse(filtered.stdout).tasks.map((t: { command: string }) => t.command)).toEqual([
      "make child-build",
    ]);
    const human = await runCli(
      ["tasks", f.repo, "--subdir", "packages/my app"],
      {},
      60_000,
      f.caller
    );
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("Run these commands from: packages/my app");
    expect(human.stdout).not.toContain("root-build");
  });

  it.each(["missing", "file.txt", "../outside", "absolute", "outside-alias"])(
    "rejects %s scope without emitting root JSON or deleting local files",
    async (kind) => {
      const f = await fixture();
      const scope = kind === "absolute" ? f.outside : kind;
      const result = await runCli(
        ["tasks", f.repo, "--subdir", scope, "--json"],
        {},
        60_000,
        f.caller
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Task discovery failed:");
      expect(await readFile(join(f.repo, "Makefile"), "utf8")).toContain("root-build");
      expect(await readFile(join(f.outside, "Makefile"), "utf8")).toContain("outside-build");
    }
  );

  it("discovers a contained alias and preserves blank/dot root selection", async () => {
    const f = await fixture();
    const alias = await runCli(
      ["tasks", f.repo, "--subdir", "alias", "--json"],
      {},
      60_000,
      f.caller
    );
    expect(alias.exitCode).toBe(0);
    expect(JSON.parse(alias.stdout).tasks.map((t: { command: string }) => t.command)).toEqual(
      childCommands
    );
    for (const subdir of ["", "."]) {
      const root = await runCli(
        ["tasks", f.repo, "--subdir", subdir, "--json"],
        {},
        60_000,
        f.caller
      );
      expect(root.exitCode).toBe(0);
      expect(JSON.parse(root.stdout).tasks[0].command).toBe("npm run root-test");
    }
  });

  it.each(["packages/second app", "", ".", "missing", "file.txt", "../outside", "outside-alias"])(
    "uses the final parsed repeated scope %j",
    async (scope) => {
      const f = await fixture();
      const result = await runCli(
        ["--subdir", "packages/my app", "tasks", f.repo, "--subdir=" + scope, "--json"],
        {},
        60_000,
        f.caller
      );
      if (["missing", "file.txt", "../outside", "outside-alias"].includes(scope)) {
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("Task discovery failed:");
      } else {
        expect(result.exitCode).toBe(0);
        const data = JSON.parse(result.stdout);
        expect(data.tasks[0].command).toBe(
          scope === "packages/second app" ? "make second-build" : "npm run root-test"
        );
        if (scope === "") expect(data).not.toHaveProperty("subdir");
        else expect(data.subdir).toBe(scope);
      }
      expect(await readFile(join(f.app, "Makefile"), "utf8")).toContain("child-build");
    }
  );

  it.each(["--keep-temp", "--verbose", "--branch", "--category"])(
    "does not interpret required scope value %s as a separate option",
    async (scope) => {
      const f = await fixture(true);
      const result = await runCli(
        ["tasks", f.url, "--subdir", scope, "--json"],
        f.env,
        60_000,
        f.caller
      );
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.subdir).toBe(scope);
      expect(data.category).toBeNull();
      expect(data.tasks[0].command).toBe("make flag-build");
      expect(result.stderr).not.toContain("Temporary clone kept at:");
      expect(await readdir(join(f.caller, ".tmp"))).toEqual([]);
    }
  );

  it("keeps an operand-named package only when a separate keep-temp flag is parsed", async () => {
    const f = await fixture(true);
    const result = await runCli(
      ["tasks", f.url, "--subdir", "--keep-temp", "--keep-temp", "--json"],
      f.env,
      60_000,
      f.caller
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).tasks[0].command).toBe("make flag-build");
    expect(result.stderr).toContain("Temporary clone kept at:");
    expect(await readdir(join(f.caller, ".tmp"))).toHaveLength(1);
  });

  it("selects an owned remote branch and cleans the outer clone", async () => {
    const f = await fixture(true);
    const result = await runCli(
      [
        "--branch",
        "main",
        "tasks",
        f.url,
        "--branch",
        "release/scope",
        "--subdir",
        "packages/my app",
        "--category",
        "build",
        "--verbose",
        "--json",
      ],
      f.env,
      60_000,
      f.caller
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).tasks[0].command).toBe("make child-release-build");
    expect(await readdir(join(f.caller, ".tmp"))).toEqual([]);
  });

  it.each([false, true])(
    "honors keep-temp=%s on failed remote selection with JSON stdout empty",
    async (keep) => {
      const f = await fixture(true);
      const args = ["tasks", f.url, "--subdir", "missing", "--json"];
      if (keep) args.push("--keep-temp");
      const result = await runCli(args, f.env, 60_000, f.caller);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Scan subdir does not exist");
      const remaining = await readdir(join(f.caller, ".tmp"));
      expect(remaining).toHaveLength(keep ? 1 : 0);
      if (keep) {
        expect(result.stderr).toContain("Temporary clone kept at:");
        expect(await readFile(join(f.caller, ".tmp", remaining[0], "Makefile"), "utf8")).toContain(
          "root-build"
        );
      } else expect(result.stderr).not.toContain("Temporary clone kept at:");
    }
  );

  it("keeps a successful scoped outer clone and leaves its note on stderr", async () => {
    const f = await fixture(true);
    const result = await runCli(
      ["--keep-temp", "tasks", f.url, "--subdir", "packages/my app", "--json"],
      f.env,
      60_000,
      f.caller
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).tasks.map((t: { command: string }) => t.command)).toEqual(
      childCommands
    );
    expect(result.stderr).toContain("Temporary clone kept at:");
    const remaining = await readdir(join(f.caller, ".tmp"));
    expect(remaining).toHaveLength(1);
    expect(
      await readFile(join(f.caller, ".tmp", remaining[0], "packages", "my app", "Makefile"), "utf8")
    ).toContain("child-build");
  });
});
