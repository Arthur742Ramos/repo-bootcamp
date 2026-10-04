import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runbookFacts } from "./runbook-facts.js";

const root = process.cwd();
export interface Declaration {
  name: string;
  value: string;
  display: "plain" | "literal" | "notation";
  target?: string;
}
// The local-path positives are real owned package directories. Deliberately
// hostile/malformed scalars below exercise tolerated manifest data, not npm
// selector validity, installation, or resolution.
export const runtimeDeclarations: Declaration[] = [
  {
    name: "owned-local",
    value: "file:packages/[alpha](target)",
    display: "literal",
    target: "packages/[alpha](target)",
  },
  { name: "owned-control", value: "^1.2.3", display: "plain" },
  { name: "plain-alternatives", value: "^1.0.0 || ^2.0.0", display: "plain" },
  {
    name: "owned-ticks",
    value: "file:packages/`alpha``(target)",
    display: "literal",
    target: "packages/`alpha``(target)",
  },
  {
    name: "owned-unicode",
    value: "file:packages/café-🚀",
    display: "plain",
    target: "packages/café-🚀",
  },
  {
    name: "owned-spaces",
    value: "file:packages/space target",
    display: "plain",
    target: "packages/space target",
  },
  {
    name: "owned-underscore",
    value: "file:packages/under_score",
    display: "literal",
    target: "packages/under_score",
  },
  ...(process.platform === "win32"
    ? []
    : [
        {
          name: "owned-stars",
          value: "file:packages/***",
          display: "literal" as const,
          target: "packages/***",
        },
        {
          name: "owned-pipe",
          value: "file:packages/pipe|target",
          display: "plain" as const,
          target: "packages/pipe|target",
        },
        {
          name: "owned-escape",
          value: "file:packages/back\\slash",
          display: "literal" as const,
          target: "packages/back\\slash",
        },
      ]),
  { name: "hostile-link", value: "[owned](https://example.invalid/pkg)", display: "literal" },
  { name: "hostile-image", value: "![owned](https://example.invalid/image)", display: "literal" },
  {
    name: "hostile-html",
    value:
      '<img src="https://example.invalid/image"><script>globalThis.declarationInjected=true</script>',
    display: "literal",
  },
  { name: "hostile-entity", value: "&lt;owned&gt; &amp; retained", display: "literal" },
  { name: "hostile-fences", value: "``[owned]|tail```", display: "literal" },
  { name: "owned-padding", value: "  [spaced]  ", display: "literal" },
  { name: "edge-spaces", value: " ^7.0.0 ", display: "literal" },
  { name: "edge-nbsp", value: "\u00a0^8.0.0\u00a0", display: "literal" },
  { name: "malformed-high", value: "file:packages/\ud800", display: "notation" },
  { name: "malformed-low", value: "file:packages/\udc00", display: "notation" },
  { name: "control-characters", value: "line\nreturn\r\ttab\u0000\u007f", display: "notation" },
];
export const devDeclarations: Declaration[] = [
  {
    name: "owned-dev",
    value: "file:packages/[dev](target)",
    display: "literal",
    target: "packages/[dev](target)",
  },
  { name: "dev-control", value: "~2.3.4", display: "plain" },
  {
    name: "dev-hostile",
    value: "[dev](https://example.invalid/dev)|`literal`",
    display: "literal",
  },
];
export const peerDeclarations: Declaration[] = [
  {
    name: "owned-peer",
    value: "file:packages/[peer](target)",
    display: "literal",
    target: "packages/[peer](target)",
  },
  { name: "peer-control", value: ">=3 <4", display: "plain" },
  {
    name: "peer-hostile",
    value: "![peer](https://example.invalid/image)<b>literal</b>",
    display: "literal",
  },
];
export const poetryMetadata = {
  extras: ["owned"],
  markers: 'sys_platform == "linux"',
  source: "owned",
  version: "^5",
};
export interface Config {
  mixed: boolean;
  capped: boolean;
}
export const configurations: Config[] = [
  { mixed: false, capped: false },
  { mixed: true, capped: false },
  { mixed: true, capped: true },
];
export function declarations(config: Config) {
  const fill = (kind: string, count: number): Declaration[] =>
    Array.from({ length: count }, (_, index) => ({
      name: `${kind}-fill-${String(index).padStart(2, "0")}`,
      value: `^${index + 10}.0.0`,
      display: "plain",
    }));
  return {
    runtime: [...runtimeDeclarations, ...(config.capped ? fill("runtime", 54) : [])],
    dev: [...devDeclarations, ...(config.capped ? fill("dev", 33) : [])],
    peer: [...peerDeclarations, ...(config.capped ? fill("peer", 33) : [])],
  };
}
export function visibleValue(declaration: Declaration): string {
  return declaration.display === "notation"
    ? JSON.stringify(declaration.value).replace(/\u007f/g, "\\u007f")
    : declaration.value;
}
// This oracle compares exact Markdown wire rows. It recognizes only the fixture
// declarations' specified display modes; it never strips arbitrary delimiters.
export function markdownVersion(declaration: Declaration): string {
  const value = visibleValue(declaration);
  if (declaration.display === "plain") return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  const raw = value.replace(/\|/g, "\\|");
  const fence = "`".repeat(Math.max(0, ...(raw.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  const pad =
    raw.startsWith("`") ||
    raw.endsWith("`") ||
    (raw.startsWith(" ") && raw.endsWith(" ") && /[^ ]/.test(raw))
      ? " "
      : "";
  return fence + pad + raw + pad + fence;
}
export function expectedInventory(config: Config) {
  const values = declarations(config);
  const record = (declaration: Declaration, type: "runtime" | "dev" | "peer") => ({
    name: declaration.name,
    version: declaration.value,
    type,
    ...(config.mixed ? { ecosystem: "node", sourceFile: "package.json" } : {}),
  });
  return {
    runtime: [
      ...values.runtime.map((declaration) => record(declaration, "runtime")),
      ...(config.mixed
        ? [
            {
              name: "rust-control",
              version: "4.0",
              type: "runtime",
              ecosystem: "rust",
              sourceFile: "Cargo.toml",
            },
            {
              name: "poetry-control",
              version: "^5",
              type: "runtime",
              ecosystem: "python",
              sourceFile: "pyproject.toml",
              description: "Declared Poetry metadata: " + JSON.stringify(poetryMetadata),
            },
            {
              name: "example.invalid/owned",
              version: "v6.0.0",
              type: "runtime",
              ecosystem: "go",
              sourceFile: "go.mod",
            },
          ]
        : []),
    ],
    dev: values.dev.map((declaration) => record(declaration, "dev")),
    peer: values.peer.map((declaration) => record(declaration, "peer")),
  };
}
export function expectedTables(config: Config, markdown = false) {
  const inventory = expectedInventory(config);
  const values = declarations(config);
  const kinds = config.mixed
    ? (["runtime", "dev", "peer"] as const)
    : (["runtime", "dev"] as const);
  return kinds.map((kind) => {
    const rows = inventory[kind].slice(0, kind === "runtime" ? 50 : 30).map((dep) => {
      const declaration = values[kind].find((item) => item.name === dep.name);
      const version = declaration
        ? markdown
          ? markdownVersion(declaration)
          : visibleValue(declaration)
        : markdown && dep.name === "poetry-control"
          ? "` ^5 `"
          : dep.version;
      return [
        dep.name,
        version,
        ...(config.mixed
          ? ["ecosystem" in dep ? dep.ecosystem : "", "sourceFile" in dep ? dep.sourceFile : ""]
          : []),
      ];
    });
    const cap = kind === "runtime" ? 50 : 30;
    if (inventory[kind].length > cap)
      rows.push([
        "...",
        `+${inventory[kind].length - cap} more`,
        ...(config.mixed ? ["", ""] : []),
      ]);
    return {
      kind,
      headers: config.mixed
        ? ["Package", "Version", "Ecosystem", "Manifest"]
        : ["Package", "Version"],
      rows,
    };
  });
}
export async function declarationFixture(config: Config) {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-declaration-display-"));
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(
    join(repo, "README.md"),
    "# Owned declaration display fixture\nNo dependencies are installed.\n"
  );
  await writeFile(join(repo, "src", "index.ts"), "export const metadataOnly = true;\n");
  const values = declarations(config);
  const packageJson = {
    name: "owned-declaration-display",
    version: "1.0.0",
    dependencies: Object.fromEntries(values.runtime.map((item) => [item.name, item.value])),
    devDependencies: Object.fromEntries(values.dev.map((item) => [item.name, item.value])),
    peerDependencies: Object.fromEntries(values.peer.map((item) => [item.name, item.value])),
  };
  await writeFile(join(repo, "package.json"), JSON.stringify(packageJson, null, 2));
  for (const declaration of [...runtimeDeclarations, ...devDeclarations, ...peerDeclarations]) {
    if (!declaration.target) continue;
    await mkdir(join(repo, declaration.target), { recursive: true });
    await writeFile(
      join(repo, declaration.target, "package.json"),
      JSON.stringify({ name: declaration.name, version: "1.0.0" })
    );
  }
  if (config.mixed) {
    await writeFile(
      join(repo, "Cargo.toml"),
      '[package]\nname="owned-rust"\nversion="1.0.0"\n[dependencies]\nrust-control="4.0"\n'
    );
    await writeFile(
      join(repo, "pyproject.toml"),
      '[tool.poetry.dependencies]\npoetry-control={version="^5",extras=["owned"],markers=\'sys_platform == "linux"\',source="owned"}\n'
    );
    await writeFile(
      join(repo, "go.mod"),
      "module example.invalid/fixture\ngo 1.22\nrequire example.invalid/owned v6.0.0\n"
    );
  }
  const facts = runbookFacts();
  facts.repoName = "local/repo";
  facts.description = "Unrelated source facts remain unchanged";
  const response = join(base, "response.json");
  await writeFile(response, JSON.stringify(facts));
  const preload = join(base, "owned-home.mjs");
  await writeFile(
    preload,
    "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>process.env.OWNED_DECLARATION_HOME;syncBuiltinESMExports();"
  );
  return { base, repo, response, preload, facts, packageJson };
}
export async function declarationCli(
  owned: Awaited<ReturnType<typeof declarationFixture>>,
  args: string[]
) {
  const processBase = await mkdtemp(join(owned.base, "process-"));
  for (const dir of ["home", "cache", "tmp"]) await mkdir(join(processBase, dir));
  return spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(join(root, "node_modules", "tsx", "dist", "loader.mjs")).href,
      "--import",
      pathToFileURL(owned.preload).href,
      join(root, "src", "cli.ts"),
      ...args,
    ],
    {
      cwd: processBase,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: owned.response,
        OWNED_DECLARATION_HOME: join(processBase, "home"),
        HOME: join(processBase, "home"),
        USERPROFILE: join(processBase, "home"),
        XDG_CACHE_HOME: join(processBase, "cache"),
        TMPDIR: join(processBase, "tmp"),
        TMP: join(processBase, "tmp"),
        TEMP: join(processBase, "tmp"),
        TSX_DISABLE_CACHE: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    }
  );
}
export async function declarationExport(
  owned: Awaited<ReturnType<typeof declarationFixture>>,
  format: "markdown" | "html" | "pdf"
) {
  const output = join(owned.base, format);
  const result = await declarationCli(owned, [
    owned.repo,
    "--no-clone",
    "--no-cache",
    "--quiet",
    "--format",
    format,
    "--output",
    output,
  ]);
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  return {
    doc: await readFile(
      join(output, "DEPENDENCIES" + (format === "markdown" ? ".md" : ".html")),
      "utf8"
    ),
    facts: JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8")),
    summary: JSON.parse(await readFile(join(output, "summary.json"), "utf8")),
  };
}
export async function declarationDocuments(config: Config) {
  const owned = await declarationFixture(config);
  try {
    return {
      html: (await declarationExport(owned, "html")).doc,
      pdf: (await declarationExport(owned, "pdf")).doc,
    };
  } finally {
    await rm(owned.base, { recursive: true, force: true });
  }
}
export function htmlTables(doc: string) {
  const decode = (value: string) =>
    value
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  const cell = (value: string) => decode(value.replace(/<[^>]*>/g, ""));
  return [...doc.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].map((table) => ({
    headers: [...table[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((match) => cell(match[1])),
    rows: [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((row) =>
        [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) => cell(match[1]))
      )
      .filter((row) => row.length),
  }));
}
