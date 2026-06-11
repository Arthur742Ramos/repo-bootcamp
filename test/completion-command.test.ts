/**
 * Tests for the `completion` command wrapper: validation, exit codes, and
 * output routing via injected dependencies (no process spawning).
 */

import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import { runCompletionCommand } from "../src/commands/completion-command.js";

function buildProgram(): Command {
  const program = new Command();
  program.name("bootcamp");
  program.command("ask <url>").description("ask").option("-v, --verbose", "verbose");
  return program;
}

describe("runCompletionCommand", () => {
  it("prints the bash script and does not exit for a valid shell", () => {
    const log = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();

    runCompletionCommand(buildProgram(), { shell: "bash" }, { log, error, exit });

    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("complete -F _bootcamp_completions bootcamp");
  });

  it("is case-insensitive about the shell name", () => {
    const log = vi.fn();
    runCompletionCommand(buildProgram(), { shell: "ZSH" }, { log, exit: vi.fn() });
    expect(log.mock.calls[0][0]).toContain("#compdef bootcamp");
  });

  it("errors and exits 1 on an unsupported shell", () => {
    const log = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();

    runCompletionCommand(buildProgram(), { shell: "powershell" }, { log, error, exit });

    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain("Unsupported shell");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("errors and exits 1 when no shell is provided", () => {
    const error = vi.fn();
    const exit = vi.fn();

    runCompletionCommand(buildProgram(), {}, { error, exit, log: vi.fn() });

    expect(error.mock.calls[0][0]).toContain("Missing shell");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
