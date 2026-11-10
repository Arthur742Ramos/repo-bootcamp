import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  repoPath: "",
  versions: {} as Record<string, string>,
  calls: [] as Array<{ command: string; args: string[]; cwd?: string; autoInstall?: string }>,
  exitCode: undefined as number | void,
}));

vi.mock("child_process", () => {
  const execFile = vi.fn();
  Object.defineProperty(execFile, Symbol.for("nodejs.util.promisify.custom"), {
    value: async (
      command: string,
      args: string[],
      options: { cwd?: string; env?: NodeJS.ProcessEnv }
    ) => {
      state.calls.push({
        command,
        args,
        cwd: options.cwd,
        autoInstall: options.env?.RUSTUP_AUTO_INSTALL,
      });
      const version = state.versions[`${command} ${args.join(" ")}`] ?? state.versions[command];
      if (version === undefined)
        throw Object.assign(new Error("Tool not installed"), { code: "ENOENT" });
      return { stdout: version, stderr: "" };
    },
  });
  return { execFile };
});

vi.mock("../src/commands/_shared.js", () => ({
  withResolvedRepo: async (
    _url: string,
    _opts: unknown,
    _label: string,
    analyze: (repo: unknown) => Promise<number | void>
  ) => {
    state.exitCode = await analyze({
      path: state.repoPath,
      repoInfo: { fullName: "local/fixture" },
    });
  },
}));

import { runPreflightCommand } from "../src/commands/preflight-command.js";

describe("preflight source semantics", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    state.repoPath = await mkdtemp(join(tmpdir(), "bootcamp-preflight-pins-"));
    state.versions = {};
    state.calls = [];
    state.exitCode = undefined;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(state.repoPath, { recursive: true, force: true });
  });

  it.each([
    ["1.21.2", "1.21.3", "mismatch", 1],
    ["1.21.3", "1.21.3", "ok", 0],
    ["1.21.4", "1.21.3", "ok", 0],
    ["1.22.0", "1.21.3", "ok", 0],
    ["1.22.0", "1.21", "ok", 0],
  ] as const)("checks Go %s against minimum %s", async (installed, required, status, exitCode) => {
    await writeFile(join(state.repoPath, "go.mod"), `module fixture\n\ngo ${required}\n`);
    state.versions.go = `go version go${installed} linux/amd64`;
    await runPreflightCommand(state.repoPath, { json: true, check: true });
    expect(state.exitCode).toBe(exitCode);
    expect(JSON.parse(logSpy.mock.calls[0][0])).toMatchObject({
      ok: exitCode === 0,
      checks: [{ tool: "Go", source: "go.mod", required, installed, status }],
    });
  });

  it.each(["8.6.0", "8.6.2", "8.7.1"])(
    "rejects package-manager %s against a complete pin",
    async (installed) => {
      await writeFile(
        join(state.repoPath, "package.json"),
        JSON.stringify({ packageManager: "pnpm@8.6.1+sha512.test" })
      );
      state.versions.pnpm = installed;
      await runPreflightCommand(state.repoPath, { json: true, check: true });
      expect(state.exitCode).toBe(1);
      expect(JSON.parse(logSpy.mock.calls[0][0])).toMatchObject({
        ok: false,
        checks: [{ tool: "pnpm", required: "8.6.1", status: "mismatch" }],
      });
    }
  );

  it("accepts matching package-manager and version-file pins", async () => {
    await writeFile(
      join(state.repoPath, "package.json"),
      JSON.stringify({ packageManager: "pnpm@8.6.1" })
    );
    await writeFile(join(state.repoPath, ".node-version"), "26.7.1\n");
    state.versions = { node: "v26.7.1", pnpm: "8.6.1" };
    await runPreflightCommand(state.repoPath, { json: true, check: true });
    expect(state.exitCode).toBe(0);
    const report = JSON.parse(logSpy.mock.calls[0][0]);
    expect(report.checks).toHaveLength(2);
    expect(report.checks.every((check: { status: string }) => check.status === "ok")).toBe(true);
  });

  it("checks an installed Rust channel without invoking the repository's toolchain", async () => {
    await writeFile(
      join(state.repoPath, "rust-toolchain.toml"),
      '[toolchain]\nchannel = "stable"\n'
    );
    state.versions.rustup = "stable-aarch64-apple-darwin (active, default)\n";
    await runPreflightCommand(state.repoPath, { json: true, check: true });

    expect(JSON.parse(logSpy.mock.calls[0][0])).toMatchObject({
      ok: true,
      checks: [
        {
          tool: "Rust",
          required: "stable",
          installed: "stable-aarch64-apple-darwin",
          status: "ok",
        },
      ],
    });
    expect(state.calls).toEqual([
      expect.objectContaining({
        command: "rustup",
        args: ["toolchain", "list"],
        autoInstall: "0",
      }),
    ]);
    expect(state.calls[0].cwd).not.toBe(state.repoPath);
  });

  it("fails the gate when the declared Rust toolchain is absent", async () => {
    await writeFile(join(state.repoPath, "rust-toolchain"), "nightly-2025-01-01\n");
    state.versions.rustup = "stable-aarch64-apple-darwin (default)\n";
    await runPreflightCommand(state.repoPath, { json: true, check: true });

    expect(state.exitCode).toBe(1);
    expect(JSON.parse(logSpy.mock.calls[0][0]).checks).toEqual([
      expect.objectContaining({ tool: "Rust", required: "nightly-2025-01-01", status: "missing" }),
    ]);
  });

  it.each([
    ["rust-toolchain.toml", '[toolchain]\npath = "/tmp/custom"\n', "Rust"],
    ["global.json", '{"sdk":{"version":"8.0.100","paths":[".dotnet"]}}', ".NET SDK"],
  ])(
    "leaves custom toolchain paths in %s unverified without running them",
    async (file, content, tool) => {
      await writeFile(join(state.repoPath, file), content);
      await runPreflightCommand(state.repoPath, { json: true, check: true });

      expect(state.calls).toEqual([]);
      expect(JSON.parse(logSpy.mock.calls[0][0]).checks).toEqual([
        expect.objectContaining({ tool, status: "unknown", installed: null }),
      ]);
    }
  );

  it.each([
    ["patch", "8.0.100", "8.0.100", "ok"],
    ["latestPatch", "8.0.100", "8.0.105", "ok"],
    ["feature", "8.0.200", "8.0.205", "ok"],
    ["latestFeature", "8.0.100", "8.0.305", "ok"],
    ["disable", "8.0.200", null, "mismatch"],
  ] as const)(
    "honors .NET %s roll-forward from %s",
    async (rollForward, version, installed, status) => {
      await writeFile(
        join(state.repoPath, "global.json"),
        `{\n  // SDK policy\n  "sdk": {"version":"${version}", "rollForward":"${rollForward}"}\n}`
      );
      state.versions.dotnet = [
        "8.0.100 [/sdk]",
        "8.0.105 [/sdk]",
        "8.0.205 [/sdk]",
        "8.0.305 [/sdk]",
      ].join("\n");
      await runPreflightCommand(state.repoPath, { json: true, check: true });

      expect(JSON.parse(logSpy.mock.calls[0][0]).checks).toEqual([
        expect.objectContaining({
          tool: ".NET SDK",
          required: version,
          status,
          ...(installed ? { installed } : {}),
        }),
      ]);
      expect(state.calls[0]).toMatchObject({ command: "dotnet", args: ["--list-sdks"] });
      expect(state.calls[0].cwd).not.toBe(state.repoPath);
      expect(state.exitCode).toBe(status === "ok" ? 0 : 1);
    }
  );

  it("excludes prerelease SDKs when global.json disallows them", async () => {
    await writeFile(
      join(state.repoPath, "global.json"),
      '{"sdk":{"version":"8.0.100","rollForward":"latestFeature","allowPrerelease":false}}'
    );
    state.versions.dotnet = "8.0.100 [/sdk]\n8.0.200-preview.1 [/sdk]\n";
    await runPreflightCommand(state.repoPath, { json: true, check: true });

    expect(JSON.parse(logSpy.mock.calls[0][0]).checks).toEqual([
      expect.objectContaining({ tool: ".NET SDK", installed: "8.0.100", status: "ok" }),
    ]);
  });
});
