import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expectedLocalInventory,
  expectedLocalTables,
  localReferenceFixture,
} from "./root-local-references.js";
import {
  htmlTables,
  ownedProcess,
  requirementCli,
  requirementExport,
} from "./root-requirement-lines.js";

export { htmlTables, ownedProcess };
export const toolingCli = requirementCli;
export const toolingExport = requirementExport;

export interface ToolingConfig {
  id: string;
  mixed: boolean;
  capped?: boolean;
  minimal?: boolean;
  toml: string;
}
export const toolingConfigurations: ToolingConfig[] = [
  {
    id: "canonical-single",
    mixed: false,
    minimal: true,
    toml: "[tool.ruff]\nline-length = 88\n",
  },
  {
    id: "quoted-dotted-nested-mixed",
    mixed: true,
    toml: String.raw`"tool"."ruff".line-length = 88
tool.ruff.select = ["E", "F"]
tool.ruff.settings = { enabled = true, threshold = 0.5, nested = { ignores = ["metadata-phantom"] } }
tool.black.target-version = ["py311"]
tool.black.metadata = '''
[project]
dependencies = ["string-owned-phantom>=99"]
[build-system]
[tool.poetry]
'''
tool.mypy.python_version = "3.11"
tool.mypy.ignore_missing_imports = true
tool.coverage.run.branch = true
tool.coverage.run.source = ["src"]
tool.pytest.ini_options.testpaths = ["test"]
tool.pytest.ini_options.addopts = "-q"
`,
  },
  {
    id: "inline-tool-mixed-capped",
    mixed: true,
    capped: true,
    toml: 'tool = { ruff = { "line-length" = 88, enabled = true }, black = { targets = ["py311"], metadata = "[project] [tool.poetry]" } }\n',
  },
];

export function toolingInventory(config: ToolingConfig) {
  if (!config.minimal) return expectedLocalInventory(config);
  return {
    runtime: [{ name: "requests", version: "2.31.0", type: "runtime" as const }],
    dev: [],
    peer: [],
  };
}
export function toolingTables(config: ToolingConfig, markdown = false) {
  if (!config.minimal) return expectedLocalTables(config, markdown);
  return [
    { kind: "runtime" as const, headers: ["Package", "Version"], rows: [["requests", "2.31.0"]] },
  ];
}
export function toolingJson(config: ToolingConfig) {
  const inventory = toolingInventory(config);
  return {
    repo: "local/repo",
    packageManager: config.mixed ? "npm" : "pip",
    ...(config.mixed ? { packageManagers: ["npm", "cargo", "pip", "go"] } : {}),
    totalCount: inventory.runtime.length + inventory.dev.length + inventory.peer.length,
    counts: {
      runtime: inventory.runtime.length,
      dev: inventory.dev.length,
      peer: inventory.peer.length,
    },
    ...inventory,
    categories: [],
  };
}

// Reuse owned root origins/includes and their standalone-deps filesystem
// guards. Nothing is installed, fetched, extracted or evaluated by fixtures.
export async function toolingFixture(config: ToolingConfig, git = false) {
  const owned = await localReferenceFixture(config);
  await writeFile(join(owned.repo, "pyproject.toml"), config.toml);
  if (config.minimal) await writeFile(join(owned.repo, "requirements.txt"), "requests==2.31.0\n");
  owned.facts.sources = ["pyproject.toml", "requirements.txt", "README.md"];
  await writeFile(owned.response, JSON.stringify(owned.facts));
  const paths = [
    ...owned.untouched.map(({ path }) => path),
    join(owned.repo, "pyproject.toml"),
    ...(config.mixed
      ? ["package.json", "Cargo.toml", "go.mod"].map((file) => join(owned.repo, file))
      : []),
  ];
  const untouched = await Promise.all(
    paths.map(async (path) => ({ path, bytes: await readFile(path) }))
  );
  if (git) {
    // Local cache identities require a clean tree. Commit only after the final
    // tooling pyproject and root requirements are present in this owned repo.
    const env = {
      PATH: process.env.PATH,
      HOME: owned.base,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const command = (...args: string[]) =>
      execFileSync("git", args, { cwd: owned.repo, env, stdio: "ignore" });
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
      "Owned tooling-only pyproject fixture"
    );
  }
  return { ...owned, config, untouched };
}
export async function toolingDocuments(config: ToolingConfig) {
  const owned = await toolingFixture(config);
  try {
    return {
      html: (await toolingExport(owned, "html")).doc,
      pdf: (await toolingExport(owned, "pdf")).doc,
    };
  } finally {
    await rm(owned.base, { recursive: true, force: true });
  }
}

export async function observeRootRequirements(owned: Awaited<ReturnType<typeof toolingFixture>>) {
  // Observe, rather than reject, an unexpected root read. A caught I/O error
  // must not manufacture the null result that these authority controls expect.
  await writeFile(
    owned.preload,
    (await readFile(owned.preload, "utf8")) +
      `
if(process.argv[2]==='deps'){
 const rootRequirement=path.resolve(${JSON.stringify(join(owned.repo, "requirements.txt"))});
 const read=fsp.readFile;
 fsp.readFile=async function(value,...args){
  const filename=typeof value==='string'?path.resolve(value):value instanceof URL?path.resolve(fileURLToPath(value)):'';
  if(filename===rootRequirement)fs.appendFileSync(path.join(os.homedir(),'root-requirement-access.jsonl'),'read\\n');
  return read.call(this,value,...args);
 };
 syncBuiltinESMExports();
}
`
  );
}

// Only documented non-owning tool roots qualify for fallback. Owned, unknown
// and package-tool declarations retain precedence even without dependency
// rows; invalid TOML never makes root requirements a replacement manifest.
export const authoritativePyprojects = [
  {
    id: "declared-project",
    toml: '[project]\ndependencies=["pyproject-control>=11"]\n[tool.ruff]\nline-length=88\n',
    rows: [["pyproject-control", ">=11"]],
  },
  {
    id: "declared-group",
    toml: '[dependency-groups]\ndev=["group-control~=8"]\n[tool.ruff]\nline-length=88\n',
    dev: [["group-control", "~=8"]],
  },
  { id: "empty-project", toml: "[project]\ndependencies=[]\n[tool.ruff]\nline-length=88\n" },
  {
    id: "dynamic-project",
    toml: '[project]\ndynamic=["dependencies"]\n[tool.ruff]\nline-length=88\n',
  },
  {
    id: "invalid-owned-dependencies",
    toml: "[project]\ndependencies=42\n[tool.ruff]\nline-length=88\n",
  },
  {
    id: "build-system",
    toml: '[build-system]\nrequires=["setuptools>=68"]\n[tool.ruff]\nline-length=88\n',
  },
  { id: "empty-group", toml: "[dependency-groups]\n[tool.ruff]\nline-length=88\n" },
  { id: "empty-poetry", toml: "[tool.poetry]\n[tool.ruff]\nline-length=88\n" },
  { id: "empty-uv", toml: "[tool.uv]\n" },
  { id: "empty-pdm", toml: "[tool.pdm]\n" },
  { id: "empty-hatch", toml: "[tool.hatch]\n" },
  { id: "empty-setuptools", toml: "[tool.setuptools]\n" },
  { id: "empty-rye", toml: "[tool.rye]\n" },
  { id: "unknown-tool", toml: "[tool.unknown-owned]\n" },
  { id: "ruff-plus-package-tool", toml: "[tool.ruff]\nline-length=88\n[tool.pdm]\n" },
  { id: "other-root", toml: 'name="owned-other-root"\n[tool.ruff]\nline-length=88\n' },
  { id: "empty-document", toml: "# no tool table\n" },
  { id: "malformed-string", toml: '[tool.ruff]\nsetting="unterminated\n' },
  { id: "trailing-token", toml: "[tool.ruff]\nline-length=88 trailing\n" },
  { id: "duplicate-key", toml: "[tool.ruff]\nline-length=88\nline-length=90\n" },
  { id: "invalid-bare-scalar", toml: "[tool.ruff]\nsetting=arbitrary\n" },
];
