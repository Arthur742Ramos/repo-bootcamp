import { execFileSync, spawnSync } from "node:child_process";

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

// Execute the generated script, rather than accepting a script that only lists
// the right strings. Bash is available on Unix and Git Bash installations.
describe.skipIf(spawnSync("bash", ["--version"]).status !== 0)(
  "generated Bash CLI completion",
  () => {
    it("routes nested commands, aliases, and values using the actual CLI tree", async () => {
      const result = await runCli(["completion", "bash"], { NO_COLOR: "1" }, 60_000);
      expect(result.exitCode).toBe(0);
      const checks = [
        { words: ["cache", "l"], expected: ["list", "ls"] },
        { words: ["cache", "list", "--j"], expected: ["--json"] },
        { words: ["cache", "ls", "--j"], expected: ["--json"] },
        { words: ["cache", "prune", "--max-a"], expected: ["--max-age"] },
        { words: ["--branch", "main", "scan", "--j"], expected: ["--json"] },
        { words: ["--branch=main", "scan", "--j"], expected: ["--json"] },
        { words: ["-bmain", "scan", "--j"], expected: ["--json"] },
      ];
      for (const check of checks) {
        const words = check.words.map((word) => `'${word}'`).join(" ");
        const output = execFileSync("bash", ["--noprofile", "--norc", "-s"], {
          encoding: "utf8",
          // The live tree exceeds Windows' command-line length limit. Feed
          // the exact same script through stdin so Git Bash still executes
          // every completion scenario on Windows.
          input: `${result.stdout}\nCOMP_WORDS=(bootcamp ${words})\nCOMP_CWORD=${check.words.length}\n_bootcamp_completions\nprintf '%s\\n' "\${COMPREPLY[@]}"`,
        });
        for (const candidate of check.expected)
          expect(output.trim().split("\n")).toContain(candidate);
      }
    }, 60_000);
  }
);
