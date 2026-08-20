/**
 * Shell completion generator.
 *
 * Derives the completion data (subcommands, their aliases, and option flags)
 * directly from the live Commander `program`, so the generated scripts can
 * never drift from the actual CLI surface. Supports bash, zsh, and fish.
 *
 * `collectCompletionSpec` is pure over a `Command` and fully unit-testable;
 * the per-shell renderers are pure string builders.
 */

import type { Command } from "commander";

/** Shells we can emit completion scripts for. */
export const SUPPORTED_SHELLS = ["bash", "zsh", "fish"] as const;
export type SupportedShell = (typeof SUPPORTED_SHELLS)[number];

/** A single subcommand in the completion spec. */
export interface CommandSpec {
  /** Primary command name (e.g. "health"). */
  name: string;
  /** Declared aliases (e.g. ["serve"]). */
  aliases: string[];
  /** One-line description for shells that show it (zsh/fish). */
  description: string;
  /** Long option flags this command accepts (e.g. ["--json", "--branch"]). */
  options: string[];
}

/** The full, shell-agnostic completion spec for the CLI. */
export interface CompletionSpec {
  /** The binary name (e.g. "bootcamp"). */
  program: string;
  /** Top-level (root command) option flags. */
  globalOptions: string[];
  /** All registered subcommands. */
  commands: CommandSpec[];
}

/** Whether a string is a shell we support. */
export function isSupportedShell(value: string): value is SupportedShell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(value);
}

/** Long flags declared directly on a command, in declaration order. */
function longFlagsOf(command: Command): string[] {
  const flags: string[] = [];
  for (const option of command.options) {
    if (option.long) {
      flags.push(option.long);
    }
  }
  // `--help` is always available but isn't in the options array.
  if (!flags.includes("--help")) {
    flags.push("--help");
  }
  return flags;
}

/**
 * Build the completion spec from a configured Commander `program`.
 *
 * Internal commander commands (the auto-generated `help` command) are skipped
 * so the completions only surface real user-facing subcommands.
 */
export function collectCompletionSpec(program: Command): CompletionSpec {
  const commands: CommandSpec[] = [];

  for (const command of program.commands) {
    const name = command.name();
    if (name === "help") {
      continue;
    }
    commands.push({
      name,
      aliases: command.aliases(),
      description: command.description() || "",
      options: longFlagsOf(command),
    });
  }

  const globalOptions = longFlagsOf(program);
  // The root command also responds to --version.
  if (!globalOptions.includes("--version")) {
    globalOptions.push("--version");
  }

  return {
    program: program.name(),
    globalOptions,
    commands,
  };
}

/** All command tokens (names + aliases) a user can type, de-duplicated. */
export function allCommandTokens(spec: CompletionSpec): string[] {
  const tokens = new Set<string>();
  for (const command of spec.commands) {
    tokens.add(command.name);
    for (const alias of command.aliases) {
      tokens.add(alias);
    }
  }
  return [...tokens];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** Render a bash completion script. */
export function renderBash(spec: CompletionSpec): string {
  const commandTokens = uniqueSorted(allCommandTokens(spec)).join(" ");
  const globalOpts = uniqueSorted(spec.globalOptions).join(" ");

  const caseArms = spec.commands
    .map((command) => {
      const names = [command.name, ...command.aliases];
      const opts = uniqueSorted(command.options).join(" ");
      return `    ${names.join("|")})
      COMPREPLY=( $(compgen -W "${opts}" -- "$cur") )
      return 0
      ;;`;
    })
    .join("\n");

  return `# bash completion for ${spec.program}
# Install: ${spec.program} completion bash > /etc/bash_completion.d/${spec.program}
#   or:    source <(${spec.program} completion bash)
_${spec.program}_completions() {
  local cur prev words cword
  _get_comp_words_by_ref -n : cur prev words cword 2>/dev/null || {
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
  }

  local commands="${commandTokens}"
  local global_opts="${globalOpts}"

  # Find the subcommand (first non-option word after the program name).
  local cmd=""
  local i
  for (( i=1; i < COMP_CWORD; i++ )); do
    case "\${COMP_WORDS[i]}" in
      -*) ;;
      *) cmd="\${COMP_WORDS[i]}"; break ;;
    esac
  done

  if [[ -z "$cmd" ]]; then
    if [[ "$cur" == -* ]]; then
      COMPREPLY=( $(compgen -W "$global_opts" -- "$cur") )
    else
      COMPREPLY=( $(compgen -W "$commands $global_opts" -- "$cur") )
    fi
    return 0
  fi

  case "$cmd" in
${caseArms}
  esac

  COMPREPLY=( $(compgen -W "$global_opts" -- "$cur") )
  return 0
}
complete -F _${spec.program}_completions ${spec.program}
`;
}

/** Render a zsh completion script (with per-command descriptions). */
export function renderZsh(spec: CompletionSpec): string {
  const commandLines = spec.commands
    .map((command) => {
      const desc = command.description.replace(/[:'\\]/g, " ").trim();
      return `    '${command.name}:${desc}'`;
    })
    .join("\n");

  const caseArms = spec.commands
    .map((command) => {
      const names = [command.name, ...command.aliases];
      const opts = uniqueSorted(command.options)
        .map((opt) => `'${opt}'`)
        .join(" ");
      return `      ${names.join("|")})
        opts=(${opts})
        ;;`;
    })
    .join("\n");

  return `#compdef ${spec.program}
# zsh completion for ${spec.program}
# Install: ${spec.program} completion zsh > "\${fpath[1]}/_${spec.program}"
#   or:    source <(${spec.program} completion zsh)
_${spec.program}() {
  local -a commands
  commands=(
${commandLines}
  )

  local global_opts
  global_opts=(${uniqueSorted(spec.globalOptions)
    .map((opt) => `'${opt}'`)
    .join(" ")})

  local cmd=""
  local i
  for (( i=2; i < CURRENT; i++ )); do
    case "\${words[i]}" in
      -*) ;;
      *) cmd="\${words[i]}"; break ;;
    esac
  done

  if [[ -z "$cmd" ]]; then
    _describe -t commands '${spec.program} command' commands
    _values 'option' $global_opts
    return
  fi

  local -a opts
  case "$cmd" in
${caseArms}
      *)
        opts=($global_opts)
        ;;
  esac
  _values 'option' $opts
}
_${spec.program} "$@"
`;
}

/** Render a fish completion script. */
export function renderFish(spec: CompletionSpec): string {
  const lines: string[] = [];
  lines.push(`# fish completion for ${spec.program}`);
  lines.push(
    `# Install: ${spec.program} completion fish > ~/.config/fish/completions/${spec.program}.fish`
  );
  lines.push("");
  lines.push(`function __fish_${spec.program}_no_subcommand`);
  const tokens = uniqueSorted(allCommandTokens(spec)).join(" ");
  lines.push(`  set -l cmds ${tokens}`);
  lines.push(`  for i in (commandline -opc)`);
  lines.push(`    if contains -- $i $cmds`);
  lines.push(`      return 1`);
  lines.push(`    end`);
  lines.push(`  end`);
  lines.push(`  return 0`);
  lines.push(`end`);
  lines.push("");

  // Subcommands (only suggested when no subcommand has been typed yet).
  for (const command of spec.commands) {
    const desc = command.description.replace(/'/g, "").trim();
    lines.push(
      `complete -c ${spec.program} -n '__fish_${spec.program}_no_subcommand' -f -a '${command.name}' -d '${desc}'`
    );
  }
  lines.push("");

  // Global options (always available).
  for (const opt of uniqueSorted(spec.globalOptions)) {
    lines.push(`complete -c ${spec.program} -l '${opt.replace(/^--/, "")}'`);
  }
  lines.push("");

  // Per-command options.
  for (const command of spec.commands) {
    const condition = [command.name, ...command.aliases]
      .map((n) => `__fish_seen_subcommand_from ${n}`)
      .join("; or ");
    for (const opt of uniqueSorted(command.options)) {
      lines.push(`complete -c ${spec.program} -n '${condition}' -l '${opt.replace(/^--/, "")}'`);
    }
  }

  return lines.join("\n") + "\n";
}

const RENDERERS: Record<SupportedShell, (spec: CompletionSpec) => string> = {
  bash: renderBash,
  zsh: renderZsh,
  fish: renderFish,
};

/** Render the completion script for `shell` from a completion spec. */
export function renderCompletion(shell: SupportedShell, spec: CompletionSpec): string {
  return RENDERERS[shell](spec);
}
