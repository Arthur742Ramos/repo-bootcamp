import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractDependencies, generateDependencyDocs } from "../src/deps.js";
import { projectCargoDependencies } from "../src/cargo-projection.js";
import { scanTomlMetadata } from "../src/toml-metadata-scan.js";
import { markdownToHtml } from "../src/formatter.js";

// Cargo's scalar/detailed/path/git/target declarations are TOML metadata here,
// not resolved plans. Names may be Unicode alphanumeric; crates.io is narrower.
// https://doc.rust-lang.org/cargo/reference/manifest.html#the-name-field
// https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html
async function extract(source: string, files: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-cargo-literal-"));
  try {
    await writeFile(join(dir, "Cargo.toml"), source);
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
    return await extractDependencies(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const shape = (source: string) => projectCargoDependencies(scanTomlMetadata(source));

describe("complete declared Cargo dependency literals", () => {
  it.each([
    '[dependencies]\nserde="1.0"',
    '["dependencies"]\n"serde"="1.0"',
    "['dependencies']\n'serde'='1.0'",
    '[dependencies]\n"\\u0073erde"="1\\u002e0"',
    '[dependencies]\nserde={version="1.0",features=["derive"]}',
    '[dependencies]\nserde={"version"="1.0",features=["derive"]}',
    '[dependencies]\nserde.version="1.0"\nserde.features=["derive"]',
    '[dependencies]\n"serde" . "version"="1.0"',
    '[dependencies.serde]\nversion="1.0"',
    "['dependencies'.'serde']\n'version'='1.0'",
    'dependencies.serde.version="1.0"',
    'dependencies={serde={version="1.0"}}',
    '[dependencies]\nserde="""1.0"""',
    "[dependencies]\nserde='''1.0'''",
  ])("decodes equivalent scalar/quoted/dotted/detailed declarations: %s", async (source) => {
    const deps = await extract(source);
    expect(deps!.runtime).toEqual([{ name: "serde", version: "1.0", type: "runtime" }]);
    expect(deps!.totalCount).toBe(1);
    expect(deps!.packageManager).toBe("cargo");
  });
  it("retains local Unicode package identifiers without crates.io-only restrictions", async () => {
    const deps = await extract('[dependencies]\n"café"="1"\n"工具"="2"\n"naïve_crate-2"="3"');
    expect(deps!.runtime.map(({ name, version }) => [name, version])).toEqual([
      ["café", "1"],
      ["工具", "2"],
      ["naïve_crate-2", "3"],
    ]);
  });
  it("aggregates the complete actual version field rather than path, Git, feature or metadata text", async () => {
    const deps = await extract(String.raw`[dependencies]
path_owned = { path = 'deps/version = "9.9"', "version" = '1.0' }
git_owned = { git = 'https://example.invalid/version = "8.8"', version = '2.0' }
feature_owned = { features = ['version = "7.7"'], version = " >= 3, < 4 " }
no_version = { path = 'deps/version = "6.6"' }
[dependencies.detailed]
path = 'deps/version = "5.5"'
[target.'cfg(unix)'.dependencies]
detailed = "*"
[dependencies.later]
path = "./owned"
"version" = "4.0"
[package.metadata.audit]
text = '''[dependencies]
phantom = "9.9"
'''
`);
    expect(deps!.runtime.map(({ name, version }) => [name, version])).toEqual([
      ["path_owned", "1.0"],
      ["git_owned", "2.0"],
      ["feature_owned", " >= 3, < 4 "],
      ["no_version", "*"],
      ["detailed", "*"],
      ["later", "4.0"],
    ]);
    const html = markdownToHtml(generateDependencyDocs(deps!, "Owned"));
    expect(html).not.toContain("phantom");
    expect(html).not.toContain("9.9");
    expect(html).not.toContain("8.8");
  });
  it.each([
    "dependencies.serde.bar='9.9'",
    '[dependencies]\nserde=["1","2"]',
    '[[dependencies.serde]]\nversion="1"',
    '[dependencies]\nserde={version=false,path="./owned"}',
    '[dependencies]\nserde={version=["1","2"]}',
    '[dependencies]\nserde={features=["derive"]}',
    "[dependencies]\nserde={}",
    "[dependencies]\nserde={workspace=false}",
    '[dependencies]\n"serde.version"="9.9"',
    '"dependencies.serde"="1"',
    '[package.metadata.dependencies]\nserde="1"',
    '[workspace.dependencies]\nserde="1"',
    '[dependencies]\nserde="unterminated\nphantom="9.9"',
  ])("never coins packages from unsupported attributes/arrays/namespaces: %s", async (source) => {
    expect(await extract(source)).toBeNull();
  });
  it("retains unresolved source/workspace behavior without traversing or selecting anything", async () => {
    const deps = await extract(String.raw`[dependencies]
local={path="../not-read"}
remote={git="https://example.invalid/not-requested.git",branch="owned"}
inherited={workspace=true,features=["derive"]}
renamed={version="1",package="different-package"}
[workspace.dependencies]
inherited="9.9"
`);
    expect(deps!.runtime.map(({ name, version }) => [name, version])).toEqual([
      ["local", "*"],
      ["remote", "*"],
      ["inherited", "*"],
      ["renamed", "1"],
    ]);
  });
  it("preserves interleaved target/global slots and last non-* version precedence", async () => {
    const source = String.raw`[dependencies.first]
version="1"
[target.'cfg(unix)'.dependencies]
first="2"
middle="3"
[dependencies.last]
version="4"
[target."cfg(any(unix, target_arch = \"x86\"))".dependencies]
first="*"
last="5"
[dev-dependencies]
first="6"
[build-dependencies]
first="7"
[target.x86_64-pc-windows-msvc.build-dependencies]
first="8"
[target.'cfg(unix)'.dev-dependencies]
first="*"
`;
    expect(shape(source).map(({ section, name, version }) => [section, name, version])).toEqual([
      ["dependencies", "first", "1"],
      ["dependencies", "first", "2"],
      ["dependencies", "middle", "3"],
      ["dependencies", "last", "4"],
      ["dependencies", "first", "*"],
      ["dependencies", "last", "5"],
      ["dev-dependencies", "first", "6"],
      ["build-dependencies", "first", "7"],
      ["build-dependencies", "first", "8"],
      ["dev-dependencies", "first", "*"],
    ]);
    const deps = await extract(source);
    expect(deps!.runtime.map(({ name, version }) => [name, version])).toEqual([
      ["first", "2"],
      ["middle", "3"],
      ["last", "5"],
    ]);
    expect(deps!.dev).toEqual([
      { name: "first", version: "6", type: "dev" },
      { name: "first", version: "8", type: "dev" },
    ]);
  });
  it("keeps other ecosystem identities and provenance independent", async () => {
    const deps = await extract('[dependencies]\n"serde"={"version"="2"}', {
      "package.json": JSON.stringify({ dependencies: { serde: "1" } }),
      "pyproject.toml": '[project]\ndependencies=["serde>=3"]',
      "go.mod": "module example.invalid/owned\ngo 1.22\nrequire example.invalid/serde v4.0.0\n",
    });
    expect(
      deps!.runtime.map(({ name, version, ecosystem, sourceFile }) => [
        name,
        version,
        ecosystem,
        sourceFile,
      ])
    ).toEqual([
      ["serde", "1", "node", "package.json"],
      ["serde", "2", "rust", "Cargo.toml"],
      ["serde", ">=3", "python", "pyproject.toml"],
      ["example.invalid/serde", "v4.0.0", "go", "go.mod"],
    ]);
  });
});
