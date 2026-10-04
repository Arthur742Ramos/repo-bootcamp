import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runbookFacts } from "./runbook-facts.js";

const root = process.cwd();
// Valid typed Cargo/TOML declarations only; no build, resolution or origin access.
export const cargoLiteralToml = String.raw`[package]
name="owned-cargo"
version="1.0.0"
[dependencies]
"serde"="1.0"
'regex'={"version"="2.0",features=["unicode"]}
"café"="3.0"
local={path='deps/version = "9.9"',version='4.0'}
git_local={git='https://example.invalid/version = "8.8"',version="5.0"}
path_only={path='deps/version = "7.7"'}
workspace_only={workspace=true}
"\u0075nicode"="6\u002e0"
dotted.version="7.0"
dotted.features=["owned"]
[target.'cfg(unix)'.dependencies]
serde="1.1"
middle="8.0"
[dependencies.detailed]
path="./owned"
"version"="9.0"
[dev-dependencies]
"cc"="1.0"
[build-dependencies]
"cc"={"version"="2.0"}
[target."cfg(target_arch = \"x86\")".build-dependencies]
cc="2.1"
[target.x86_64-pc-windows-msvc.dev-dependencies]
cc="*"
[package.metadata.audit]
description='''[dependencies]
phantom="99.0"
[target.'cfg(unix)'.dependencies]
target_phantom="98.0"
'''
[workspace.dependencies]
workspace_only="97.0"
[features]
not_a_package=["serde/derive"]
`;
export const cargoRuntime = [
  ["serde", "1.1"],
  ["regex", "2.0"],
  ["café", "3.0"],
  ["local", "4.0"],
  ["git_local", "5.0"],
  ["path_only", "*"],
  ["workspace_only", "*"],
  ["unicode", "6.0"],
  ["dotted", "7.0"],
  ["middle", "8.0"],
  ["detailed", "9.0"],
];
export const cargoDev = [
  ["cc", "1.0"],
  ["cc", "2.1"],
];
export function cargoExpectedRows(mixed: boolean) {
  return {
    runtime: mixed
      ? [
          ["serde", "^20", "node", "package.json"],
          ...cargoRuntime.map((row) => [...row, "rust", "Cargo.toml"]),
          ["serde", ">=30", "python", "pyproject.toml"],
          ["example.invalid/serde", "v40.0.0", "go", "go.mod"],
        ]
      : cargoRuntime,
    dev: mixed
      ? [
          ["node-dev", "^21", "node", "package.json"],
          ...cargoDev.map((row) => [...row, "rust", "Cargo.toml"]),
        ]
      : cargoDev,
  };
}
export async function cargoFixture(mixed: boolean, toml = cargoLiteralToml) {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-cargo-export-"));
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "README.md"), "# Owned Cargo literal fixture\n");
  await writeFile(join(repo, "src", "lib.rs"), "pub fn owned() {}\n");
  await writeFile(join(repo, "Cargo.toml"), toml);
  if (mixed) {
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        name: "owned-node",
        dependencies: { serde: "^20" },
        devDependencies: { "node-dev": "^21" },
      })
    );
    await writeFile(join(repo, "pyproject.toml"), '[project]\ndependencies=["serde>=30"]\n');
    await writeFile(
      join(repo, "go.mod"),
      "module example.invalid/owned\ngo 1.22\nrequire example.invalid/serde v40.0.0\n"
    );
  }
  const response = join(base, "response.json");
  const facts = runbookFacts();
  facts.repoName = "local/repo";
  await writeFile(response, JSON.stringify(facts));
  const preload = join(base, "owned-home.mjs");
  await writeFile(
    preload,
    "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>process.env.OWNED_CARGO_HOME;syncBuiltinESMExports();"
  );
  return { base, repo, response, preload };
}
export async function cargoCli(owned: Awaited<ReturnType<typeof cargoFixture>>, args: string[]) {
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
      timeout: 60000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: owned.response,
        OWNED_CARGO_HOME: join(processBase, "home"),
        HOME: join(processBase, "home"),
        USERPROFILE: join(processBase, "home"),
        TMPDIR: join(processBase, "tmp"),
        TMP: join(processBase, "tmp"),
        TEMP: join(processBase, "tmp"),
        XDG_CACHE_HOME: join(processBase, "cache"),
        TSX_DISABLE_CACHE: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    }
  );
}
export async function cargoExport(
  owned: Awaited<ReturnType<typeof cargoFixture>>,
  format: "markdown" | "html" | "pdf"
) {
  const output = join(owned.base, format);
  const result = await cargoCli(owned, [
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
    summary: JSON.parse(await readFile(join(output, "summary.json"), "utf8")),
  };
}
export async function cargoDocuments(mixed: boolean) {
  const owned = await cargoFixture(mixed);
  try {
    return {
      html: (await cargoExport(owned, "html")).doc,
      pdf: (await cargoExport(owned, "pdf")).doc,
    };
  } finally {
    await rm(owned.base, { recursive: true, force: true });
  }
}
export function cargoDocumentRows(doc: string, markdown: boolean): string[][] {
  if (markdown)
    return doc
      .split("\n")
      .filter((line) => line.startsWith("| "))
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim())
      );
  const decode = (value: string) =>
    value
      .replace(/<[^>]*>/g, "")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  return [...doc.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decode(cell[1]))
  );
}
