import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { collectCompletionSpec, renderBash, renderFish, renderZsh } from "../src/completion.js";

function program(): Command {
  const root = new Command()
    .name("bootcamp")
    .argument("<repo>")
    .option("-b, --branch <branch>")
    .option("-v, --verbose")
    .option("--color [color]")
    .option("-x, --exclude <globs...>");
  root.command("scan <repo>").alias("s").option("--json");
  const cache = root.command("cache").alias("c");
  cache.command("list").alias("ls").option("-j, --json");
  cache.command("prune").option("--max-age <days>");
  return root;
}

const spec = collectCompletionSpec(program());
const cases: { label: string; words: string[]; includes?: string[]; excludes?: string[] }[] = [
  { label: "root names and aliases", words: [""], includes: ["scan", "s", "cache", "c"] },
  {
    label: "nested names and aliases",
    words: ["cache", ""],
    includes: ["list", "ls", "prune"],
    excludes: ["scan"],
  },
  {
    label: "nested flags",
    words: ["cache", "list", "--j"],
    includes: ["--json"],
    excludes: ["--max-age"],
  },
  { label: "nested aliases", words: ["c", "ls", "-j"], includes: ["-j"], excludes: ["--max-age"] },
  {
    label: "sibling flags",
    words: ["cache", "prune", "--max"],
    includes: ["--max-age"],
    excludes: ["--json"],
  },
  {
    label: "root required value",
    words: ["--branch", "main", "scan", "--j"],
    includes: ["--json"],
  },
  {
    label: "command-like required value",
    words: ["--branch", "cache", "scan", "--j"],
    includes: ["--json"],
  },
  {
    label: "pending required value",
    words: ["--branch", ""],
    excludes: ["cache", "scan", "--branch"],
  },
  {
    label: "hyphen-prefixed required value",
    words: ["--branch", "--verbose", "scan", "--j"],
    includes: ["--json"],
  },
  { label: "inline required value", words: ["--branch=main", "scan", "--j"], includes: ["--json"] },
  {
    label: "unfinished inline value",
    words: ["--branch=ca"],
    excludes: ["cache", "scan", "--branch"],
  },
  {
    label: "Bash word-break inline value",
    words: ["--branch", "=", "main", "scan", "--j"],
    includes: ["--json"],
  },
  {
    label: "pending Bash word-break value",
    words: ["--branch", "=", "ca"],
    excludes: ["cache", "scan", "--branch"],
  },
  {
    label: "Bash word-break colon value",
    words: ["--branch", "feature", ":", "next", "scan", "--j"],
    includes: ["--json"],
  },
  {
    label: "Bash word-break equals within value",
    words: ["--branch", "feature", "=", "next", "scan", "--j"],
    includes: ["--json"],
  },
  { label: "short required value", words: ["-b", "main", "scan", "--j"], includes: ["--json"] },
  { label: "attached short value", words: ["-bmain", "scan", "--j"], includes: ["--json"] },
  {
    label: "grouped short flags with value",
    words: ["-vbmain", "scan", "--j"],
    includes: ["--json"],
  },
  {
    label: "pending grouped short value",
    words: ["-vb", ""],
    excludes: ["cache", "scan", "--branch"],
  },
  {
    label: "optional value consumes command token",
    words: ["--color", "cache", "scan", "--j"],
    includes: ["--json"],
  },
  {
    label: "optional value ends at flag",
    words: ["--color", "--verbose", "cache", ""],
    includes: ["list", "prune"],
  },
  { label: "pending optional value", words: ["--color", "ca"], excludes: ["cache"] },
  {
    label: "optional value followed by flag prefix",
    words: ["--color", "--b"],
    includes: ["--branch"],
  },
  {
    label: "variadic values consume command tokens",
    words: ["--exclude", "src", "cache", ""],
    excludes: ["cache", "scan", "list"],
  },
  {
    label: "variadic ends at option",
    words: ["--exclude", "src", "cache", "--verbose", "scan", "--j"],
    includes: ["--json"],
  },
  {
    label: "variadic negative integer remains a value",
    words: ["--exclude", "src", "-1", "cache", ""],
    excludes: ["list", "prune", "cache", "scan"],
  },
  {
    label: "variadic negative decimal remains a value",
    words: ["--exclude", "src", "-.5", "cache", ""],
    excludes: ["list", "prune", "cache", "scan"],
  },
  {
    label: "variadic negative exponent remains a value",
    words: ["--exclude", "src", "-1.2e-3", "cache", ""],
    excludes: ["list", "prune", "cache", "scan"],
  },
  {
    label: "optional negative decimal remains a value",
    words: ["--color", "-.5", "cache", "l"],
    includes: ["list", "ls"],
  },
  {
    label: "inline variadic value permits a command",
    words: ["--exclude=src", "scan", "--j"],
    includes: ["--json"],
  },
  {
    label: "attached variadic value permits a command",
    words: ["-xsrc", "scan", "--j"],
    includes: ["--json"],
  },
  {
    label: "optional lone dash value",
    words: ["--color", "-", "scan", "--j"],
    includes: ["--json"],
  },
  {
    label: "terminator disables commands and flags",
    words: ["--", ""],
    excludes: ["scan", "cache", "--branch"],
  },
  {
    label: "terminator survives later command-like tokens",
    words: ["--", "cache", "--j"],
    excludes: ["--json"],
  },
  {
    label: "root repo positional blocks command recognition",
    words: ["./repo", "cache", ""],
    excludes: ["list", "scan", "cache"],
  },
  {
    label: "command repo positional retains command flags",
    words: ["scan", "./repo", "--j"],
    includes: ["--json"],
  },
];

function quoted(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// Windows installations may not have these shells; native checks run whenever
// the executable is usable. This Mac exercises Bash and Zsh, including compinit.
const hasBash = spawnSync("bash", ["--version"]).status === 0;
const hasZsh = spawnSync("zsh", ["--version"]).status === 0;
const hasFish = spawnSync("fish", ["--version"]).status === 0;

describe("completion tree and option arity", () => {
  it("captures child commands, aliases, short flags, and option value kinds", () => {
    expect(spec.commands[1].commands?.[0]).toMatchObject({
      name: "list",
      aliases: ["ls"],
      options: ["--json", "--help"],
    });
    expect(spec.optionSpecs).toContainEqual({
      flags: ["-b", "--branch"],
      value: "required",
      variadic: false,
    });
    expect(spec.optionSpecs).toContainEqual({
      flags: ["--color"],
      value: "optional",
      variadic: false,
      negativeValues: true,
    });
    expect(spec.optionSpecs).toContainEqual({
      flags: ["-x", "--exclude"],
      value: "required",
      variadic: true,
      negativeValues: true,
    });
  });

  it("matches Commander ancestor-option precedence when a child redeclares a flag", () => {
    const root = program();
    root.commands[0].option("--color", "boolean at child");
    const script = renderBash(collectCompletionSpec(root));
    expect(script).toContain("'1:--color') value=optional");
    expect(script).not.toContain("'1:--color') value=none");
    const childAction = () => {};
    root.commands[0].action(childAction);
    root.parse(["node", "bootcamp", "scan", "--color", "red", "./repo"]);
    expect(root.opts().color).toBe("red");
    expect(root.commands[0].opts().color).toBeUndefined();
  });

  it("derives numeric-value exceptions from the option owner and its ancestors", () => {
    const root = new Command().name("bootcamp").option("--exclude <globs...>");
    root.command("cache").option("-1, --one").command("list");
    let rootRan = false;
    root.action(() => {
      rootRan = true;
    });
    root.parse(["node", "bootcamp", "--exclude", "src", "-1", "cache"]);
    expect(rootRan).toBe(true);
    expect(root.opts().exclude).toEqual(["src", "-1", "cache"]);
    expect(
      collectCompletionSpec(root).optionSpecs?.find((option) => option.variadic)?.negativeValues
    ).toBe(true);
    root.option("-2, --two");
    root.commands[0].option("--color [color]");
    const digitSpec = collectCompletionSpec(root);
    expect(digitSpec.optionSpecs?.find((option) => option.variadic)?.negativeValues).toBe(false);
    expect(
      digitSpec.commands[0].optionSpecs?.find((option) => option.value === "optional")
        ?.negativeValues
    ).toBe(false);
  });

  it("retains rendering support for the original flat spec API", () => {
    const legacy = {
      program: "example",
      globalOptions: ["--help"],
      commands: [{ name: "scan", aliases: [], description: "scan", options: ["--json"] }],
    };
    expect(renderBash(legacy)).toContain("'1:--json'");
    expect(renderZsh(legacy)).toContain("'scan:scan'");
    expect(renderFish(legacy)).toContain("-l 'json'");
  });
});

describe.skipIf(!hasBash)("native Bash completion", () => {
  it("completes the command and option-value matrix with nounset enabled", () => {
    for (const testCase of cases) {
      const output = execFileSync(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-uc",
          `${renderBash(spec)}\nCOMP_WORDS=(bootcamp ${testCase.words.map(quoted).join(" ")})\nCOMP_CWORD=${testCase.words.length}\n_bootcamp_completions\nprintf '%s\\n' "\${COMPREPLY[@]+"\${COMPREPLY[@]}"}"`,
        ],
        { encoding: "utf8" }
      );
      const candidates = output.trim().split("\n");
      for (const token of testCase.includes ?? [])
        expect(candidates, testCase.label).toContain(token);
      for (const token of testCase.excludes ?? [])
        expect(candidates, testCase.label).not.toContain(token);
    }
  });
});

describe.skipIf(!hasBash)("native numeric option context", () => {
  it("matches Commander when ancestor and descendant digit flags differ", () => {
    for (const digitOwner of ["root", "child"] as const) {
      const root = new Command().name("bootcamp").option("--exclude <globs...>");
      const cache = root.command("cache");
      cache.command("list");
      (digitOwner === "root" ? root : cache).option("-1, --one");
      let selected = "";
      root.action(() => {
        selected = "root";
      });
      cache.action(() => {
        selected = "cache";
      });
      root.parse(["node", "bootcamp", "--exclude", "src", "-1", "cache"]);
      expect(selected).toBe(digitOwner === "root" ? "cache" : "root");
      expect(root.opts().exclude).toEqual(digitOwner === "root" ? ["src"] : ["src", "-1", "cache"]);
      const script = renderBash(collectCompletionSpec(root));
      const output = execFileSync(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-uc",
          `${script}\nCOMP_WORDS=(bootcamp --exclude src -1 cache '')\nCOMP_CWORD=5\n_bootcamp_completions\nprintf '%s\\n' "\${COMPREPLY[@]+"\${COMPREPLY[@]}"}"`,
        ],
        { encoding: "utf8" }
      );
      if (digitOwner === "root") expect(output.split("\n")).toContain("list");
      else expect(output.split("\n")).not.toContain("list");
    }
  });
});

describe.skipIf(!hasZsh)("native Zsh loading and state", () => {
  it("sources after compinit without invoking completion outside its context", () => {
    const dir = mkdtempSync(join(tmpdir(), "bootcamp-zsh-"));
    try {
      const path = join(dir, "_bootcamp");
      writeFileSync(path, renderZsh(spec));
      const result = spawnSync(
        "zsh",
        [
          "-fc",
          'autoload -Uz compinit; compinit -D; source "$1"; print -r -- $_comps[bootcamp]',
          "zsh",
          path,
        ],
        { encoding: "utf8" }
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe("_bootcamp");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("initializes and registers completion when sourced in a fresh Zsh session", () => {
    const dir = mkdtempSync(join(tmpdir(), "bootcamp-zsh-"));
    try {
      const path = join(dir, "_bootcamp");
      writeFileSync(path, renderZsh(spec));
      const result = spawnSync(
        "zsh",
        ["-fc", 'source "$1"; print -r -- $_comps[bootcamp]', "zsh", path],
        { encoding: "utf8", env: { ...process.env, ZDOTDIR: dir } }
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe("_bootcamp");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("registers the autoload file with the documented fpath setup", () => {
    const dir = mkdtempSync(join(tmpdir(), "bootcamp-zsh-"));
    try {
      writeFileSync(join(dir, "_bootcamp"), renderZsh(spec));
      const result = spawnSync(
        "zsh",
        [
          "-fc",
          'fpath=("$1" $fpath); autoload -Uz compinit; compinit -D; print -r -- $_comps[bootcamp]; print -r -- $functions[_bootcamp]',
          "zsh",
          dir,
        ],
        { encoding: "utf8" }
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("_bootcamp\n");
      expect(result.stdout).toContain("autoload");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses the command and option-value matrix", () => {
    for (const testCase of cases.filter((entry) => !entry.label.includes("Bash word-break"))) {
      const dir = mkdtempSync(join(tmpdir(), "bootcamp-zsh-"));
      try {
        const path = join(dir, "_bootcamp");
        writeFileSync(path, renderZsh(spec));
        const prior = testCase.words.slice(0, -1);
        const cur = testCase.words.at(-1)!;
        const code = `autoload -Uz compinit; compinit -D; source "$1"\ncur=${quoted(cur)}\n_bootcamp_state ${prior.map(quoted).join(" ")}\nif [[ "$ended" == 0 && "$pending" != required* && ( "$pending" == none || "$cur" == -* ) && "$cur" != --*=* ]]; then\n_bootcamp_candidates\nprint -rl -- \${candidates[@]}\nfi`;
        const result = spawnSync("zsh", ["-fc", code, "zsh", path], { encoding: "utf8" });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        const candidates = result.stdout
          .trim()
          .split("\n")
          .filter((word) => word.startsWith(cur));
        for (const token of testCase.includes ?? [])
          expect(candidates, testCase.label).toContain(token);
        for (const token of testCase.excludes ?? [])
          expect(candidates, testCase.label).not.toContain(token);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

describe.skipIf(!hasFish)("native Fish completion", () => {
  it("completes the command and option-value matrix", () => {
    for (const testCase of cases.filter((entry) => !entry.label.includes("Bash word-break"))) {
      const output = execFileSync(
        "fish",
        [
          "--no-config",
          "-c",
          `${renderFish(spec)}\ncomplete -C ${quoted(`bootcamp ${testCase.words.map((word) => (word ? quoted(word) : "")).join(" ")}`)}`,
        ],
        { encoding: "utf8" }
      );
      const candidates = output
        .trim()
        .split("\n")
        .map((line) => line.split("\t")[0]);
      for (const token of testCase.includes ?? [])
        expect(candidates, testCase.label).toContain(token);
      for (const token of testCase.excludes ?? [])
        expect(candidates, testCase.label).not.toContain(token);
    }
  });
});
