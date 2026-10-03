import type { Command } from "./types.js";

type CommandRole = "dev" | "test" | "build";

const ROLE_TOKENS: Record<CommandRole, readonly string[]> = {
  dev: ["dev", "start", "serve", "server", "watch"],
  test: ["test", "tests", "spec", "e2e", "unit", "integration", "coverage"],
  build: ["build", "compile", "bundle"],
};
const SETUP_TOKENS = new Set([
  "install",
  "setup",
  "bootstrap",
  "deps",
  "dependencies",
  "sync",
  "restore",
  "add",
  "update",
]);

function roleFromName(name: string): CommandRole | null {
  const tokens = name
    .toLowerCase()
    .trim()
    .split(/[\s:_-]+/);
  if (tokens.some((token) => SETUP_TOKENS.has(token))) return null;
  // Preserve a leading build action when its output is test fixtures.
  if (tokens.some((token) => ROLE_TOKENS.build.includes(token))) {
    for (const token of tokens) {
      for (const role of ["test", "build"] as const) {
        if (ROLE_TOKENS[role].includes(token)) return role;
      }
    }
  }
  for (const role of ["test", "build", "dev"] as const) {
    if (tokens.some((token) => ROLE_TOKENS[role].includes(token))) return role;
  }
  return null;
}

function isSetupName(name: string): boolean {
  return name
    .toLowerCase()
    .split(/[\s:_-]+/)
    .some((token) => SETUP_TOKENS.has(token));
}

// Recognize one simple invocation, including whole quoted literal tokens. Shell
// pipelines, substitutions, escapes, and compound commands need repository guidance.
function invocation(command: string): string[] | null {
  const pattern = /(?:[^\s'"`$;&|<>\\]+|'[^'\n]*'|"[^"\n`$\\]*")/g;
  const matches = [...command.matchAll(pattern)];
  let end = 0;
  const tokens: string[] = [];
  for (const match of matches) {
    if (command.slice(end, match.index).trim()) return null;
    if (tokens.length && match.index === end) return null;
    const token = match[0];
    tokens.push(/^["']/.test(token) ? token.slice(1, -1) : token);
    end = match.index + token.length;
  }
  return command.slice(end).trim() || command.includes("\n") ? null : tokens;
}

function executable(token: string): string {
  return token
    .split("/")
    .at(-1)!
    .replace(/\.(?:exe|cmd)$/i, "")
    .toLowerCase();
}

function roleFromInvocation(tokens: string[]): CommandRole | null {
  const [first, action, target] = tokens;
  if (!first) return null;
  if (tokens.some((token) => ["--help", "--version", "-h"].includes(token))) return null;
  const tool = executable(first);
  if (["npm", "pnpm", "yarn", "bun", "composer"].includes(tool)) {
    if (["run", "run-script"].includes(action)) return target ? roleFromName(target) : null;
    if (["start", "test"].includes(action)) return roleFromName(action);
    if (["pnpm", "yarn", "bun"].includes(tool) && action && !action.startsWith("-")) {
      if (["exec", "x", "dlx"].includes(action)) {
        return roleFromInvocation(tokens.slice(2));
      }
      return roleFromName(action);
    }
  }
  if (["make", "just", "task"].includes(tool)) {
    return action && !action.startsWith("-") ? roleFromName(action) : null;
  }
  if (["uv", "poetry"].includes(tool) && action === "run") {
    // Options whose values can themselves be "dev" are not runnable task names.
    let index = 2;
    const valueOptions = new Set(["--group", "--extra", "--project", "--directory", "--package"]);
    const flagOptions = new Set(["--frozen", "--locked", "--no-sync", "--offline", "--no-dev"]);
    while (tokens[index]?.startsWith("-")) {
      const option = tokens[index++];
      if (valueOptions.has(option)) index++;
      else if (!flagOptions.has(option) && !option.includes("=")) return null;
    }
    const target = tokens[index] ?? "";
    const isFileTarget = /[/\\]/.test(target) || /\.[a-z0-9]+$/i.test(target);
    return roleFromInvocation(tokens.slice(index)) ?? (isFileTarget ? null : roleFromName(target));
  }
  if (tool === "npx") return roleFromInvocation(tokens.slice(1));
  if (["pytest", "vitest", "jest", "mocha", "ava"].includes(tool)) return "test";
  if (tool === "playwright" && action === "test") return "test";
  if (/^python(?:\d+(?:\.\d+)?)?$/.test(tool)) {
    if (action === "-m" && ["pytest", "unittest"].includes(target)) return "test";
    if (action === "-m" && target === "build") return "build";
    if (action === "-m" && target === "http.server") return "dev";
    if (action === "-m" && target === "flask" && tokens[3] === "run") return "dev";
    if (action && /(?:^|\/)manage\.py$/.test(action) && target === "runserver") return "dev";
  }
  if (["cargo", "go", "dotnet"].includes(tool)) {
    if (action === "test") return "test";
    if (action === "build") return "build";
    if (tool !== "go" && action === "watch") return "dev";
  }
  if (tool === "vite") {
    if (action === "build") return "build";
    return !action || action.startsWith("-") || ["dev", "serve", "preview"].includes(action)
      ? "dev"
      : null;
  }
  if (tool === "uvicorn") return action && !action.startsWith("-") ? "dev" : null;
  if (tool === "http-server") return "dev";
  if (["next", "nuxt", "astro", "webpack", "vue-cli-service"].includes(tool)) {
    return action ? roleFromName(action) : null;
  }
  if (tool === "flask" && action === "run") return "dev";
  return null;
}

/** Select a command using semantic labels or a bounded known invocation grammar. */
export function findGuidanceCommand(commands: Command[], role: CommandRole): Command | undefined {
  return commands.find((command) => {
    if (isSetupName(command.name)) return false;
    const tokens = invocation(command.command);
    if (tokens?.some((token) => ["--help", "--version", "-h"].includes(token))) return false;
    // Known setup operations remain setup even when their arguments mention dev/test.
    if (tokens && SETUP_TOKENS.has(tokens[1]?.toLowerCase())) return false;
    if (
      tokens &&
      ["make", "just", "task"].includes(executable(tokens[0] ?? "")) &&
      isSetupName(tokens[1] ?? "")
    )
      return false;
    if (tokens && ["run", "run-script"].includes(tokens[1]) && isSetupName(tokens[2] ?? ""))
      return false;
    const namedRole = roleFromName(command.name);
    return ((tokens ? roleFromInvocation(tokens) : null) ?? namedRole) === role;
  });
}
