import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractDependencies } from "../src/deps.js";
import { scanGoDependencyDeclarations } from "../src/go-dependency-literals.js";

// Current Go modfile lexer and parseString implementation, not raw-string prose:
// https://go.dev/src/cmd/vendor/golang.org/x/mod/modfile/read.go
// https://go.dev/src/cmd/vendor/golang.org/x/mod/modfile/rule.go
const declared = [{ name: "example.invalid/owned", version: "v1.2.3" }];
const scan = (source: string) =>
  scanGoDependencyDeclarations(`module example.invalid/main\ngo 1.22\n${source}\n`);
async function extract(source: string, files: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-go-literal-"));
  try {
    await writeFile(join(dir, "go.mod"), `module example.invalid/main\ngo 1.22\n${source}\n`);
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
    return await extractDependencies(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
describe("declared Go require literals", () => {
  it.each([
    "require example.invalid/owned v1.2.3",
    'require "example.invalid/owned" v1.2.3',
    'require example.invalid/owned "v1.2.3"',
    'require "example.invalid/owned" "v1.2.3"',
    'require (\n"example.invalid/owned" "v1.2.3"\n)',
    'require\t(\r\n\t"example.invalid/owned"\t"v1.2.3"\r\n)\r',
    String.raw`require "example.invalid/\x6fwned" "v1\x2e2.3"`,
    String.raw`require "example.invalid/\157wned" "v1\0562.3"`,
    String.raw`require "example.invalid/\u006fwned" "v1\u002e2.3"`,
    String.raw`require "example.invalid/\U0000006fwned" "v1\U0000002e2.3"`,
  ])("decodes equivalent valid declarations: %s", (source) => {
    expect(scan(source)).toEqual(declared);
  });
  it.each([
    "require example.invalid/owned v1.2.3// indirect",
    "require example.invalid/owned v1.2.3 // comment (123)",
    'require "example.invalid/owned" "v1.2.3"//comment',
    "require (// note (123)\nexample.invalid/owned v1.2.3// ) phantom v9\n)//done",
    "// require example.invalid/phantom v9\nrequire example.invalid/owned v1.2.3",
  ])("isolates lexical comments without leaking versions or closing blocks: %s", (source) => {
    expect(scan(source)).toEqual(declared);
  });
  it.each([
    'require "example.invalid/owned v1.2.3',
    'require example.invalid/owned "v1.2.3',
    "require `example.invalid/owned` v1.2.3",
    "require 'example.invalid/owned' v1.2.3",
    String.raw`require "example.invalid/o\wned" v1.2.3`,
    String.raw`require "example.invalid/\xzz" v1.2.3`,
    String.raw`require "example.invalid/\400wned" v1.2.3`,
    String.raw`require "example.invalid/\uD800" v1.2.3`,
    String.raw`require "example.invalid/\U00110000" v1.2.3`,
    String.raw`require "example.invalid/\xff" v1.2.3`,
    String.raw`require "example.invalid/o\'wned" v1.2.3`,
    'require "" v1.2.3',
    'require "example.invalid/owned other" v1.2.3',
    String.raw`require example.invalid/owned "v1.2.3\nphantom"`,
    "require example.invalid/owned v1.2.3 extra",
    "require (example.invalid/owned v1.2.3)",
    '"require" example.invalid/owned v1.2.3',
    "require (\nexample.invalid/owned v1.2.3",
    "require example.invalid/owned v1.2.3/* forbidden */",
  ])("does not fabricate inventory from unsupported or malformed declarations: %s", (source) => {
    expect(scan(source)).toEqual([]);
  });
  it("does not reinterpret strings or unrelated directive blocks as require declarations", () => {
    expect(
      scan(
        "replace (\nrequire v9 => example.invalid/other v9\n)\nexclude (\nrequire v8\n)\nrequire example.invalid/owned v1.2.3"
      )
    ).toEqual(declared);
  });
  it("keeps the existing v-prefixed declared-version contract without resolving constraints", () => {
    expect(
      scan(
        'require example.invalid/prerelease "v1.2.3-rc.1+incompatible"\nrequire example.invalid/pseudo v0.0.0-20240101000000-abcdefabcdef\nrequire example.invalid/branch master'
      )
    ).toEqual([
      { name: "example.invalid/prerelease", version: "v1.2.3-rc.1+incompatible" },
      { name: "example.invalid/pseudo", version: "v0.0.0-20240101000000-abcdefabcdef" },
    ]);
  });
  it("retains first occurrences across quoted and unquoted blocks", async () => {
    const deps = await extract(
      'require "example.invalid/owned" "v1.2.3"\nrequire (\nexample.invalid/owned v9.9.9\nexample.invalid/second v2.0.0\n)\nrequire "example.invalid/second" v8.8.8'
    );
    expect(deps!.runtime).toEqual([
      { ...declared[0], type: "runtime" },
      { name: "example.invalid/second", version: "v2.0.0", type: "runtime" },
    ]);
    expect(deps!.totalCount).toBe(2);
    expect(deps!.packageManager).toBe("go");
  });
  it("preserves mixed identities and leaves other ecosystems available on malformed Go", async () => {
    const files = {
      "package.json": JSON.stringify({ dependencies: { "example.invalid/owned": "^20" } }),
      "Cargo.toml": '[dependencies]\nowned="30"',
      "pyproject.toml": '[project]\ndependencies=["owned>=40"]',
    };
    const deps = await extract('require "example.invalid/owned" "v1.2.3"', files);
    expect(
      deps!.runtime.map(({ name, version, ecosystem, sourceFile }) => [
        name,
        version,
        ecosystem,
        sourceFile,
      ])
    ).toEqual([
      ["example.invalid/owned", "^20", "node", "package.json"],
      ["owned", "30", "rust", "Cargo.toml"],
      ["owned", ">=40", "python", "pyproject.toml"],
      ["example.invalid/owned", "v1.2.3", "go", "go.mod"],
    ]);
    const bad = await extract("require `example.invalid/phantom` v9.9.9", files);
    expect(bad!.totalCount).toBe(3);
    expect(bad!.packageManagers).toEqual(["npm", "cargo", "pip"]);
  });
});
