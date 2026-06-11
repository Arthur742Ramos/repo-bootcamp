import { describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

describe("completion command", () => {
  it("emits a bash completion script", async () => {
    const result = await runCli(["completion", "bash"], { NO_COLOR: "1" }, 60_000);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("_bootcamp_completions()");
    expect(result.stdout).toContain("complete -F _bootcamp_completions bootcamp");
    // Real subcommands are derived from the live program.
    expect(result.stdout).toContain("health");
    expect(result.stdout).toContain("doctor");
  }, 60_000);

  it("emits a zsh completion script with a #compdef header", async () => {
    const result = await runCli(["completion", "zsh"], { NO_COLOR: "1" }, 60_000);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trimStart().startsWith("#compdef bootcamp")).toBe(true);
    expect(result.stdout).toContain("_describe");
  }, 60_000);

  it("emits a fish completion script", async () => {
    const result = await runCli(["completion", "fish"], { NO_COLOR: "1" }, 60_000);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("function __fish_bootcamp_no_subcommand");
    expect(result.stdout).toContain("complete -c bootcamp");
  }, 60_000);

  it("exits non-zero on an unsupported shell", async () => {
    const result = await runCli(["completion", "powershell"], { NO_COLOR: "1" }, 60_000);
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Unsupported shell");
  }, 60_000);
});
