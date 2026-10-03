import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  repoPath: "",
  versions: {} as Record<string, string>,
  exitCode: undefined as number | void,
}));

vi.mock("child_process", () => {
  const execFile = vi.fn();
  Object.defineProperty(execFile, Symbol.for("nodejs.util.promisify.custom"), {
    value: async (command: string) => {
      const version = state.versions[command];
      if (!version) throw new Error("Tool not installed");
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
});
