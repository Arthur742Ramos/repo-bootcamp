/** Shell completions derived from the live Commander command tree. */
import type { Command } from "commander";

export const SUPPORTED_SHELLS = ["bash", "zsh", "fish"] as const;
export type SupportedShell = (typeof SUPPORTED_SHELLS)[number];

export interface OptionSpec {
  flags: string[];
  value: "none" | "required" | "optional";
  variadic?: boolean;
  /** Commander accepts negative numeric values unless this option's command or an ancestor declares a digit short flag. */
  negativeValues?: boolean;
}

export interface CommandSpec {
  name: string;
  aliases: string[];
  description: string;
  /** Long flags, retained for callers of the original completion API. */
  options: string[];
  optionSpecs?: OptionSpec[];
  commands?: CommandSpec[];
}

export interface CompletionSpec {
  program: string;
  globalOptions: string[];
  commands: CommandSpec[];
  optionSpecs?: OptionSpec[];
}

export function isSupportedShell(value: string): value is SupportedShell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(value);
}

function optionsOf(command: Command): OptionSpec[] {
  let negativeValues = true;
  for (let owner: Command | null = command; owner; owner = owner.parent) {
    if (owner.options.some((option) => /^-\d$/.test(option.short ?? ""))) negativeValues = false;
  }
  const options: OptionSpec[] = command.options.map((option) => ({
    flags: [option.short, option.long].filter((flag): flag is string => Boolean(flag)),
    value: option.required ? "required" : option.optional ? "optional" : "none",
    variadic: option.variadic,
    ...((option.optional || option.variadic) && { negativeValues }),
  }));
  const help = command.createHelp().visibleOptions(command);
  for (const option of help) {
    if (!options.some((entry) => entry.flags.includes(option.long ?? option.short ?? ""))) {
      options.push({
        flags: [option.short, option.long].filter((flag): flag is string => Boolean(flag)),
        value: "none",
      });
    }
  }
  return options;
}

function longFlags(options: OptionSpec[]): string[] {
  return options.flatMap((option) => option.flags.filter((flag) => flag.startsWith("--")));
}

export function collectCompletionSpec(program: Command): CompletionSpec {
  function children(command: Command): CommandSpec[] {
    return command.commands
      .filter((child) => child.name() !== "help")
      .map((child) => {
        const optionSpecs = optionsOf(child);
        return {
          name: child.name(),
          aliases: child.aliases(),
          description: child.description() || "",
          options: longFlags(optionSpecs),
          optionSpecs,
          commands: children(child),
        };
      });
  }
  const optionSpecs = optionsOf(program);
  const globalOptions = longFlags(optionSpecs);
  // Preserve the original spec API's synthesized root version flag.
  if (!globalOptions.includes("--version")) {
    globalOptions.push("--version");
    optionSpecs.push({ flags: ["--version"], value: "none" });
  }
  return { program: program.name(), globalOptions, optionSpecs, commands: children(program) };
}

/** Immediate command names and aliases, preserving the original API. */
export function allCommandTokens(spec: Pick<CompletionSpec, "commands">): string[] {
  return [...new Set(spec.commands.flatMap((command) => [command.name, ...command.aliases]))];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

interface Node {
  id: number;
  commands: CommandSpec[];
  options: OptionSpec[];
  children: { command: CommandSpec; id: number }[];
}

function nodesOf(spec: CompletionSpec): Node[] {
  const nodes: Node[] = [];
  function visit(commands: CommandSpec[], options: OptionSpec[], inherited: OptionSpec[]): number {
    const id = nodes.length;
    // Commander consumes ancestor options before dispatching to children.
    const flags = new Set(inherited.flatMap((option) => option.flags));
    const effective = [
      ...inherited,
      ...options.map((option) => ({
        ...option,
        flags: option.flags.filter((flag) => !flags.has(flag)),
      })),
    ];
    const node: Node = { id, commands, options: effective, children: [] };
    nodes.push(node);
    node.children = commands.map((command) => ({
      command,
      id: visit(
        command.commands ?? [],
        command.optionSpecs ?? command.options.map((flag) => ({ flags: [flag], value: "none" })),
        effective
      ),
    }));
    return id;
  }
  visit(
    spec.commands,
    spec.optionSpecs ?? spec.globalOptions.map((flag) => ({ flags: [flag], value: "none" })),
    []
  );
  return nodes;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function programWord(value: string): string {
  return /^[a-zA-Z0-9_-]+$/.test(value) ? value : quote(value);
}

function fishQuote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Use safe internal identifiers even for CLI names containing punctuation. */
function functionName(spec: CompletionSpec): string {
  return spec.program.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Shared Bash/Zsh parser. Inputs are complete tokens before the cursor. */
function renderShState(spec: CompletionSpec, nodes: Node[]): string {
  const prefix = `_${functionName(spec)}`;
  return `${prefix}_option() {
  value=none
  variadic=0
  negative=0
  case "$node:$1" in
${nodes
  .flatMap((node) =>
    node.options
      .filter((option) => option.flags.length)
      .map(
        (option) =>
          `    ${option.flags.map((flag) => quote(`${node.id}:${flag}`)).join("|")}) value=${option.value}; variadic=${option.variadic ? 1 : 0}; negative=${option.negativeValues === false ? 0 : 1} ;;`
      )
  )
  .join("\n")}
  esac
}
${prefix}_state() {
  node=0
  pending=none
  pending_negative=0
  positional=0
  ended=0
  local token value variadic negative numeric short rest
  local number_pattern='^-([0-9]+|[0-9]*\\.[0-9]+)(e[+-]?[0-9]+)?$'
  for token in "$@"; do
    if [[ "$pending" == required || "$pending" == required_many ]]; then
      if [[ "$pending" == required_many ]]; then pending=many; else pending=none; fi
      continue
    fi
    numeric=0
    if [[ "$pending_negative" == 1 && "$token" =~ $number_pattern ]]; then numeric=1; fi
    if [[ "$pending" == many && ( "$token" != -?* || "$numeric" == 1 ) ]]; then continue; fi
    if [[ "$pending" == optional* && ( "$token" != -?* || "$numeric" == 1 ) ]]; then
      if [[ "$pending" == optional_many ]]; then pending=many; else pending=none; fi
      continue
    fi
    pending=none
    pending_negative=0
    [[ "$ended" == 1 ]] && continue
    if [[ "$token" == -- ]]; then
      ended=1
    elif [[ "$token" == --*=* ]]; then
      ${prefix}_option "\${token%%=*}"
    elif [[ "$token" == --* ]]; then
      ${prefix}_option "$token"
      pending=$value
      pending_negative=$negative
      [[ "$variadic" == 1 && "$value" != none ]] && pending=\${value}_many
    elif [[ "$token" == -?* ]]; then
      rest=\${token#-}
      while [[ -n "$rest" ]]; do
        short=\${rest%"\${rest#?}"}
        rest=\${rest#?}
        ${prefix}_option "-$short"
        if [[ "$value" != none ]]; then
          if [[ -z "$rest" ]]; then
            pending=$value
            pending_negative=$negative
            [[ "$variadic" == 1 && "$value" != none ]] && pending=\${value}_many
          fi
          break
        fi
      done
    elif [[ "$positional" == 0 ]]; then
      case "$node:$token" in
${nodes.flatMap((node) => node.children.map(({ command, id }) => `        ${[command.name, ...command.aliases].map((name) => quote(`${node.id}:${name}`)).join("|")}) node=${id} ;;`)).join("\n")}
        *) positional=1 ;;
      esac
    fi
  done
  return 0
}
${prefix}_candidates() {
  candidates=()
  case "$node" in
${nodes
  .map((node) => {
    const options = uniqueSorted(node.options.flatMap((option) => option.flags));
    const commands = uniqueSorted(allCommandTokens(node));
    return `    ${node.id})
      candidates=(${options.map(quote).join(" ")})
      if [[ "$positional" == 0 && "$cur" != -* ]]; then
        candidates+=(${commands.map(quote).join(" ")})
      fi
      ;;`;
  })
  .join("\n")}
  esac
}
`;
}

export function renderBash(spec: CompletionSpec): string {
  const prefix = `_${functionName(spec)}`;
  return `# bash completion for ${spec.program}
# Load in your shell: source <(${spec.program} completion bash)
${renderShState(spec, nodesOf(spec))}
${prefix}_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local node pending pending_negative positional ended
  local -a candidates=() prior=()
  local i token candidate prior_count=0
  COMPREPLY=()
  # Bash splits words at = and : by default. Rejoin completed pieces
  # before parsing, and leave unfinished value pieces to filenames.
  for (( i=1; i<COMP_CWORD; i++ )); do
    token="\${COMP_WORDS[i]}"
    if [[ "$token" == [=:] && $prior_count -gt 0 ]]; then
      prior[prior_count-1]+="$token"
    elif [[ $prior_count -gt 0 && "\${prior[prior_count-1]}" == *[=:] ]]; then
      prior[prior_count-1]+="$token"
    else
      prior+=("$token")
      (( prior_count+=1 ))
    fi
  done
  if [[ "$cur" == [=:] || COMP_CWORD -gt 1 && "\${COMP_WORDS[COMP_CWORD-1]}" == [=:] ]]; then return 0; fi
  ${prefix}_state "\${prior[@]+"\${prior[@]}"}"
  if [[ "$ended" == 1 || "$pending" == required* || "$pending" != none && "$cur" != -* || "$cur" == --*=* ]]; then
    return 0
  fi
  ${prefix}_candidates
  for candidate in "\${candidates[@]+"\${candidates[@]}"}"; do
    [[ "$candidate" == "$cur"* ]] && COMPREPLY+=("$candidate")
  done
  return 0
}
complete -F ${prefix}_completions ${programWord(spec.program)} -o default
`;
}

export function renderZsh(spec: CompletionSpec): string {
  const prefix = `_${functionName(spec)}`;
  const nodes = nodesOf(spec);
  return `#compdef ${spec.program}
# Run compinit first; source this script or autoload it from fpath.
${renderShState(spec, nodes)}
${prefix}() {
  setopt localoptions
  local cur="\${words[CURRENT]}"
  local node pending pending_negative positional ended i
  local -a candidates prior commands
  for (( i=2; i<CURRENT; i++ )); do prior+=("\${words[i]}"); done
  ${prefix}_state "\${prior[@]}"
  if [[ "$cur" == --*=* ]]; then compset -P '*='; _files; return; fi
  if [[ "$ended" == 1 || "$pending" == required* || "$pending" != none && "$cur" != -* ]]; then
    _files
    return
  fi
  ${prefix}_candidates
  if [[ "$positional" == 0 && "$cur" != -* ]]; then
    case "$node" in
${nodes
  .map(
    (node) =>
      `      ${node.id}) commands=(${node.commands.flatMap((command) => [command.name, ...command.aliases].map((name) => quote(`${name}:${command.description.replace(/[:'\\]/g, " ").trim()}`))).join(" ")}) ;;`
  )
  .join("\n")}
    esac
    _describe -t commands ${quote(`${spec.program} command`)} commands
    candidates=( \${(M)candidates:#-*} )
  fi
  compadd -- \${candidates[@]}
  _files
}
# A sourced file registers the function. An autoloaded completion executes it.
if [[ "$ZSH_EVAL_CONTEXT" == *:file ]]; then
  if (( ! $+functions[compdef] )); then autoload -Uz compinit; compinit; fi
  compdef ${prefix} ${quote(spec.program)}
else
  ${prefix} "$@"
fi
`;
}

export function renderFish(spec: CompletionSpec): string {
  const prefix = `__fish_${functionName(spec)}`;
  const nodes = nodesOf(spec);
  return `# fish completion for ${spec.program}
# Install: ${spec.program} completion fish > ~/.config/fish/completions/${spec.program}.fish
function ${prefix}_option
  set -g ${prefix}_value none
  set -g ${prefix}_variadic 0
  set -g ${prefix}_negative 0
  switch "$${prefix}_node:$argv[1]"
${nodes
  .flatMap((node) =>
    node.options
      .filter((option) => option.flags.length)
      .map(
        (
          option
        ) => `    case ${option.flags.map((flag) => fishQuote(`${node.id}:${flag}`)).join(" ")}
      set -g ${prefix}_value ${option.value}
      set -g ${prefix}_variadic ${option.variadic ? 1 : 0}
      set -g ${prefix}_negative ${option.negativeValues === false ? 0 : 1}`
      )
  )
  .join("\n")}
  end
end
function ${prefix}_state
  set -g ${prefix}_node 0
  set -g ${prefix}_pending none
  set -l pending_negative 0
  set -g ${prefix}_positional 0
  set -g ${prefix}_ended 0
  set -l tokens (commandline -opc)
  for token in $tokens[2..-1]
    if string match -q 'required*' "$${prefix}_pending"
      if test "$${prefix}_pending" = required_many
        set -g ${prefix}_pending many
      else
        set -g ${prefix}_pending none
      end
      continue
    end
    set -l numeric 0
    if test "$pending_negative" = 1; and string match -rq -- '^-([0-9]+|[0-9]*\\.[0-9]+)(e[+-]?[0-9]+)?$' "$token"
      set numeric 1
    end
    if test "$${prefix}_pending" = many; and begin; not string match -q -- '-?*' "$token"; or test "$numeric" = 1; end
      continue
    end
    if string match -q 'optional*' "$${prefix}_pending"; and begin; not string match -q -- '-?*' "$token"; or test "$numeric" = 1; end
      if test "$${prefix}_pending" = optional_many
        set -g ${prefix}_pending many
      else
        set -g ${prefix}_pending none
      end
      continue
    end
    set -g ${prefix}_pending none
    set pending_negative 0
    if test "$${prefix}_ended" = 1
      continue
    end
    if test "$token" = --
      set -g ${prefix}_ended 1
    else if string match -q -- '--*=*' "$token"
      ${prefix}_option (string split -m 1 = -- "$token")[1]
    else if string match -q -- '--*' "$token"
      ${prefix}_option "$token"
      set -g ${prefix}_pending $${prefix}_value
      set pending_negative $${prefix}_negative
      if test "$${prefix}_variadic" = 1; and test "$${prefix}_value" != none
        set -g ${prefix}_pending "$${prefix}_value"_many
      end
    else if string match -q -- '-?*' "$token"
      set -l rest (string sub -s 2 -- "$token")
      while test -n "$rest"
        set -l flag -(string sub -l 1 -- "$rest")
        set rest (string sub -s 2 -- "$rest")
        ${prefix}_option "$flag"
        if test "$${prefix}_value" != none
          if test -z "$rest"
            set -g ${prefix}_pending $${prefix}_value
            set pending_negative $${prefix}_negative
            if test "$${prefix}_variadic" = 1; and test "$${prefix}_value" != none
              set -g ${prefix}_pending "$${prefix}_value"_many
            end
          end
          break
        end
      end
    else if test "$${prefix}_positional" = 0
      switch "$${prefix}_node:$token"
${nodes
  .flatMap((node) =>
    node.children.map(
      ({
        command,
        id,
      }) => `        case ${[command.name, ...command.aliases].map((name) => fishQuote(`${node.id}:${name}`)).join(" ")}
          set -g ${prefix}_node ${id}`
    )
  )
  .join("\n")}
        case '*'
          set -g ${prefix}_positional 1
      end
    end
  end
end
function ${prefix}_no_subcommand
  ${prefix}_state
  test "$${prefix}_node" = 0; and test "$${prefix}_positional" = 0
end
function ${prefix}_at
  ${prefix}_state
  test "$${prefix}_node" = "$argv[1]"; or return 1
  test "$${prefix}_ended" = 0; or return 1
  not string match -q 'required*' "$${prefix}_pending"; or return 1
  set -l current (commandline -ct)
  if string match -q -- '--*=*' "$current"
    return 1
  end
  if test "$${prefix}_pending" != none; and not string match -q -- '-*' "$current"
    return 1
  end
  if test "$argv[2]" = command
    test "$${prefix}_positional" = 0; or return 1
  end
end
${nodes
  .flatMap((node) => [
    ...node.commands.flatMap((command) =>
      [command.name, ...command.aliases].map(
        (name) =>
          `complete -c ${programWord(spec.program)} -n '${prefix}_at ${node.id} command' -f -a ${fishQuote(name)} -d ${fishQuote(command.description)}`
      )
    ),
    ...node.options.flatMap((option) =>
      option.flags.map(
        (flag) =>
          `complete -c ${programWord(spec.program)} -n '${prefix}_at ${node.id} option' ${flag.startsWith("--") ? "-l" : "-s"} ${fishQuote(flag.replace(/^-+/, ""))}${option.value === "required" ? " -r" : ""}`
      )
    ),
  ])
  .join("\n")}
`;
}

const RENDERERS: Record<SupportedShell, (spec: CompletionSpec) => string> = {
  bash: renderBash,
  zsh: renderZsh,
  fish: renderFish,
};

export function renderCompletion(shell: SupportedShell, spec: CompletionSpec): string {
  return RENDERERS[shell](spec);
}
