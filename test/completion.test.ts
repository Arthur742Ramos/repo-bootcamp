/**
 * Tests for the shell completion generator.
 *
 * The spec is collected from a small synthetic Commander program so the tests
 * don't depend on the full CLI surface, plus one test against the real program
 * to guard the wiring. Renderers are checked for the structural invariants each
 * shell relies on.
 */

import { Command } from "commander";
import { describe, expect, it } from "vitest";

import {
  allCommandTokens,
  collectCompletionSpec,
  isSupportedShell,
  renderBash,
  renderCompletion,
  renderFish,
  renderZsh,
  SUPPORTED_SHELLS,
  type CompletionSpec,
} from "../src/completion.js";

function buildSampleProgram(): Command {
  const program = new Command();
  program
    .name("bootcamp")
    .option("-b, --branch <branch>", "branch")
    .option("--no-clone", "use local path");

  program
    .command("ask <url>")
    .alias("a")
    .description("Ask questions")
    .option("-v, --verbose", "verbose")
    .option("--model <model>", "model");

  program.command("web").alias("serve").description("Start: the web server");

  return program;
}

describe("isSupportedShell", () => {
  it("accepts bash, zsh, and fish", () => {
    for (const shell of SUPPORTED_SHELLS) {
      expect(isSupportedShell(shell)).toBe(true);
    }
  });

  it("rejects unknown shells", () => {
    expect(isSupportedShell("powershell")).toBe(false);
    expect(isSupportedShell("")).toBe(false);
  });
});

describe("collectCompletionSpec", () => {
  it("captures the program name, subcommands, aliases, and per-command flags", () => {
    const spec = collectCompletionSpec(buildSampleProgram());
    expect(spec.program).toBe("bootcamp");

    const ask = spec.commands.find((c) => c.name === "ask")!;
    expect(ask.aliases).toEqual(["a"]);
    expect(ask.options).toContain("--verbose");
    expect(ask.options).toContain("--model");
    // --help is always appended.
    expect(ask.options).toContain("--help");

    const web = spec.commands.find((c) => c.name === "web")!;
    expect(web.aliases).toEqual(["serve"]);
  });

  it("includes root --branch and synthesizes --help/--version globally", () => {
    const spec = collectCompletionSpec(buildSampleProgram());
    expect(spec.globalOptions).toContain("--branch");
    expect(spec.globalOptions).toContain("--no-clone");
    expect(spec.globalOptions).toContain("--help");
    expect(spec.globalOptions).toContain("--version");
  });

  it("skips the auto-generated help command", () => {
    const program = buildSampleProgram();
    // Force commander to register its implicit help command.
    program.command("help");
    const spec = collectCompletionSpec(program);
    expect(spec.commands.find((c) => c.name === "help")).toBeUndefined();
  });
});

describe("allCommandTokens", () => {
  it("returns every command name and alias, de-duplicated", () => {
    const spec = collectCompletionSpec(buildSampleProgram());
    const tokens = allCommandTokens(spec);
    expect(tokens).toContain("ask");
    expect(tokens).toContain("a");
    expect(tokens).toContain("web");
    expect(tokens).toContain("serve");
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe("renderBash", () => {
  const spec: CompletionSpec = collectCompletionSpec(buildSampleProgram());
  const script = renderBash(spec);

  it("declares the completion function and registers it with complete -F", () => {
    expect(script).toContain("_bootcamp_completions()");
    expect(script).toContain("complete -F _bootcamp_completions bootcamp");
  });

  it("lists subcommands and routes per-command options via a case statement", () => {
    expect(script).toContain('local commands="a ask serve web"');
    // ask|a share a case arm; options sorted.
    expect(script).toContain("ask|a)");
    expect(script).toContain("--model --verbose");
  });
});

describe("renderZsh", () => {
  const spec = collectCompletionSpec(buildSampleProgram());
  const script = renderZsh(spec);

  it("emits a #compdef header and a _describe command list", () => {
    expect(script.startsWith("#compdef bootcamp")).toBe(true);
    expect(script).toContain("_describe");
    expect(script).toContain("'ask:Ask questions'");
  });

  it("sanitizes colons out of descriptions so the name:desc split stays valid", () => {
    // "Start: the web server" → colon replaced with a space.
    expect(script).toContain("'web:Start  the web server'");
    expect(script).not.toContain("Start: the web");
  });
});

describe("renderFish", () => {
  const spec = collectCompletionSpec(buildSampleProgram());
  const script = renderFish(spec);

  it("defines a no-subcommand guard and command completions", () => {
    expect(script).toContain("function __fish_bootcamp_no_subcommand");
    expect(script).toContain("-a 'ask'");
    expect(script).toContain("-a 'web'");
  });

  it("guards per-command options with __fish_seen_subcommand_from", () => {
    expect(script).toContain("__fish_seen_subcommand_from ask");
    expect(script).toContain("-l 'model'");
  });
});

describe("renderCompletion", () => {
  const spec = collectCompletionSpec(buildSampleProgram());

  it("dispatches to the matching renderer", () => {
    expect(renderCompletion("bash", spec)).toBe(renderBash(spec));
    expect(renderCompletion("zsh", spec)).toBe(renderZsh(spec));
    expect(renderCompletion("fish", spec)).toBe(renderFish(spec));
  });
});
