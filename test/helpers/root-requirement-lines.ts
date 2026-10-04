import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runbookFacts } from "./runbook-facts.js";

const root = process.cwd();
// Root logical-line metadata only. Include/local controls exist on disk but
// are never traversed, evaluated, installed or fetched by these tests.
export const rootRequirementText = [
  "--find-links \\",
  "    wheels",
  "-r \\",
  "    ignored-requirements.txt",
  "--requirement \\",
  "    ../outside-requirements.txt",
  "-c \\",
  "    owned-constraints.txt",
  "--index-url \\",
  "    https://example.invalid/simple",
  "--trusted-host \\",
  "    phantom-host",
  "--hash= \\",
  "    sha256:owned",
  "-e \\",
  "    ./editable-owned",
  "git+https://\\",
  "    example.invalid/owned.git#egg=vcs-phantom",
  "https://\\",
  "    example.invalid/owned.whl",
  "direct @ \\",
  "    https://example.invalid/direct.whl",
  "./local\\",
  "    -owned",
  "\\leading-path\\",
  "    phantom-leading-path",
  "requests>=2.28,\\",
  "<3",
  "urllib3[security]\\",
  ">=2,<3",
  "rich~=13.0\\",
  '; python_version >= "3.10"',
  "Flask==3\\",
  "    # whole comment after continuation",
  "after-comment==4",
  "# whole comment ending in a slash\\",
  "pytest==8 # inline comment with a terminal slash\\",
  "    ignored_fragment",
  "duplicate==1",
  "duplicate>=2",
  "even==5\\\\",
  ".0",
  "trailing-space==7\\ ",
  "legacy-next==8",
  "envliteral==${OWNED_ROOT_VERSION}",
  "eof==9\\",
].join("\n");
export const pythonRows = [
  ["requests", "2.28,<3"],
  ["urllib3", "2,<3"],
  ["rich", "13.0"],
  ["Flask", "3"],
  ["after-comment", "4"],
  ["pytest", "8"],
  ["duplicate", "1"],
  ["duplicate", "2"],
  ["even", "5.0"],
  ["trailing-space", "7\\"],
  ["legacy-next", "8"],
  ["envliteral", "${OWNED_ROOT_VERSION}"],
  ["eof", "9"],
];
export const rejectedNames = [
  "wheels",
  "ignored-requirements.txt",
  "outside_scope_package",
  "outside_parent_package",
  "constraint_scope_package",
  "editable_scope_package",
  "phantom-host",
  "sha256",
  "git",
  "https",
  "direct",
  "local",
  "leading-path",
  "phantom-leading-path",
  "ignored_fragment",
];
export interface RequirementConfig {
  mixed: boolean;
  ending: "\n" | "\r\n" | "\r";
  pyproject?: boolean;
}
export const requirementConfigurations: RequirementConfig[] = [
  { mixed: false, ending: "\n" },
  { mixed: true, ending: "\n" },
  { mixed: false, ending: "\r\n" },
  { mixed: false, ending: "\r" },
  { mixed: true, ending: "\n", pyproject: true },
];
export function expectedInventory(config: RequirementConfig) {
  const python = config.pyproject ? [["pyproject-control", ">=11"]] : pythonRows;
  const record = (
    row: string[],
    type: "runtime" | "dev" | "peer",
    ecosystem: string,
    sourceFile: string
  ) => ({
    name: row[0],
    version: row[1],
    type,
    ...(config.mixed ? { ecosystem, sourceFile } : {}),
  });
  return {
    runtime: [
      ...(config.mixed
        ? [
            record(["requests", "^20"], "runtime", "node", "package.json"),
            record(["requests", "4.0"], "runtime", "rust", "Cargo.toml"),
          ]
        : []),
      ...python.map((row) =>
        record(row, "runtime", "python", config.pyproject ? "pyproject.toml" : "requirements.txt")
      ),
      ...(config.mixed
        ? [record(["example.invalid/requests", "v6.0.0"], "runtime", "go", "go.mod")]
        : []),
    ],
    dev: config.mixed
      ? [
          record(["node-dev", "^1"], "dev", "node", "package.json"),
          record(["rust-dev", "2.0"], "dev", "rust", "Cargo.toml"),
        ]
      : [],
    peer: config.mixed ? [record(["node-peer", "^3"], "peer", "node", "package.json")] : [],
  };
}
// Requirements retain the existing convention of dropping only the initial
// operator. Numeric comparators remain plain legacy cells; literal trailing
// slashes and underscores use the previously qualified code-span display.
export function expectedTables(config: RequirementConfig, markdown = false) {
  const inventory = expectedInventory(config);
  const kinds = config.mixed ? (["runtime", "dev", "peer"] as const) : (["runtime"] as const);
  return kinds.map((kind) => ({
    kind,
    headers: config.mixed
      ? ["Package", "Version", "Ecosystem", "Manifest"]
      : ["Package", "Version"],
    rows: inventory[kind].map((dep) => [
      dep.name,
      markdown && ["7\\", "${OWNED_ROOT_VERSION}"].includes(dep.version)
        ? "`" + dep.version + "`"
        : dep.version,
      ...(config.mixed ? [dep.ecosystem!, dep.sourceFile!] : []),
    ]),
  }));
}
export async function requirementFixture(
  config: RequirementConfig,
  text = rootRequirementText,
  git = false
) {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-root-requirement-lines-"));
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "wheels"));
  await mkdir(join(repo, "editable-owned"));
  await writeFile(
    join(repo, "README.md"),
    "# Owned root requirements fixture\nNo includes are processed.\n"
  );
  await writeFile(join(repo, "src", "index.py"), "metadata_only = True\n");
  await writeFile(join(repo, "requirements.txt"), text.replaceAll("\n", config.ending));
  await writeFile(join(repo, "ignored-requirements.txt"), "outside_scope_package==99\n");
  await writeFile(join(base, "outside-requirements.txt"), "outside_parent_package==98\n");
  await writeFile(join(repo, "owned-constraints.txt"), "constraint_scope_package==97\n");
  await writeFile(join(repo, "editable-owned", "requirements.txt"), "editable_scope_package==96\n");
  if (config.pyproject)
    await writeFile(
      join(repo, "pyproject.toml"),
      '[project]\nname="owned-priority"\nversion="1.0.0"\ndependencies=["pyproject-control>=11"]\n'
    );
  if (config.mixed) {
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        name: "owned-sidecar",
        dependencies: { requests: "^20" },
        devDependencies: { "node-dev": "^1" },
        peerDependencies: { "node-peer": "^3" },
      })
    );
    await writeFile(
      join(repo, "Cargo.toml"),
      '[package]\nname="owned-rust"\nversion="1.0.0"\n[dependencies]\nrequests="4.0"\n[dev-dependencies]\nrust-dev="2.0"\n'
    );
    await writeFile(
      join(repo, "go.mod"),
      "module example.invalid/fixture\ngo 1.22\nrequire example.invalid/requests v6.0.0\n"
    );
  }
  if (git) {
    const env = {
      PATH: process.env.PATH,
      HOME: base,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const command = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, env, stdio: "ignore" });
    command("init", "-b", "main");
    command("add", ".");
    command(
      "-c",
      "user.name=Owned Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--no-gpg-sign",
      "-m",
      "Owned requirement fixtures"
    );
  }
  const facts = runbookFacts();
  facts.repoName = "local/repo";
  facts.sources = ["requirements.txt", "README.md"];
  facts.structure.keyDirs[0].keyFiles = ["src/index.py"];
  facts.structure.entrypoints = [
    { path: "src/index.py", type: "library", description: "Owned root source" },
  ];
  const response = join(base, "response.json");
  await writeFile(response, JSON.stringify(facts));
  const preload = join(base, "owned-home.mjs");
  await writeFile(
    preload,
    "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>process.env.OWNED_REQUIREMENT_HOME;syncBuiltinESMExports();"
  );
  return { base, repo, response, preload, facts };
}
export async function ownedProcess(owned: Awaited<ReturnType<typeof requirementFixture>>) {
  const base = await mkdtemp(join(owned.base, "process-"));
  for (const dir of ["home", "cache", "tmp"]) await mkdir(join(base, dir));
  return { base, home: join(base, "home"), cache: join(base, "home", ".cache", "repo-bootcamp") };
}
export async function requirementCli(
  owned: Awaited<ReturnType<typeof requirementFixture>>,
  args: string[],
  processOwner?: Awaited<ReturnType<typeof ownedProcess>>
) {
  const processBase = processOwner ?? (await ownedProcess(owned));
  const result = spawnSync(
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
      cwd: processBase.base,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: owned.response,
        OWNED_REQUIREMENT_HOME: processBase.home,
        HOME: processBase.home,
        USERPROFILE: processBase.home,
        XDG_CACHE_HOME: join(processBase.base, "cache"),
        TMPDIR: join(processBase.base, "tmp"),
        TMP: join(processBase.base, "tmp"),
        TEMP: join(processBase.base, "tmp"),
        TSX_DISABLE_CACHE: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        OWNED_ROOT_VERSION: "9999",
        OWNED_REQUIREMENTS_INCLUDE: "ignored-requirements.txt",
      },
    }
  );
  return { result, processOwner: processBase };
}
export async function requirementExport(
  owned: Awaited<ReturnType<typeof requirementFixture>>,
  format: "markdown" | "html" | "pdf",
  processOwner?: Awaited<ReturnType<typeof ownedProcess>>,
  cache = false
) {
  const owner = processOwner ?? (await ownedProcess(owned));
  const output = join(owner.base, "output");
  const { result } = await requirementCli(
    owned,
    [
      owned.repo,
      "--no-clone",
      ...(cache ? [] : ["--no-cache"]),
      "--quiet",
      "--format",
      format,
      "--output",
      output,
    ],
    owner
  );
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  return {
    doc: await readFile(
      join(output, "DEPENDENCIES" + (format === "markdown" ? ".md" : ".html")),
      "utf8"
    ),
    facts: JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8")),
    summary: JSON.parse(await readFile(join(output, "summary.json"), "utf8")),
    owner,
  };
}
export async function requirementDocuments(config: RequirementConfig) {
  const owned = await requirementFixture(config);
  try {
    return {
      html: (await requirementExport(owned, "html")).doc,
      pdf: (await requirementExport(owned, "pdf")).doc,
    };
  } finally {
    await rm(owned.base, { recursive: true, force: true });
  }
}
export function htmlTables(doc: string) {
  const cell = (value: string) =>
    value
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
  return [...doc.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].map((table) => ({
    headers: [...table[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((match) => cell(match[1])),
    rows: [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((row) =>
        [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) => cell(match[1]))
      )
      .filter((row) => row.length),
  }));
}
