import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractDependencies } from "../src/deps.js";
import { isRootLocalRequirementReference } from "../src/root-requirement-admission.js";

const extensions = [
  ".zip",
  ".whl",
  ".tar.bz2",
  ".tbz",
  ".tar.gz",
  ".tgz",
  ".tar",
  ".tar.xz",
  ".txz",
  ".tlz",
  ".tar.lz",
  ".tar.lzma",
];
async function extract(text: string, extraFiles: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-root-local-unit-"));
  try {
    await mkdir(join(dir, "owned", "local"), { recursive: true });
    await mkdir(join(dir, "plain-project"));
    await writeFile(
      join(dir, "owned", "local", "pyproject.toml"),
      '[project]\nname="not_scanned"\nversion="99"'
    );
    await writeFile(
      join(dir, "plain-project", "pyproject.toml"),
      '[project]\nname="not_scanned_plain"\nversion="98"'
    );
    await writeFile(join(dir, "requirements.txt"), text);
    for (const [file, value] of Object.entries(extraFiles)) await writeFile(join(dir, file), value);
    return await extractDependencies(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("bounded unnamed root local-reference admission", () => {
  it.each([
    "owned/local",
    "owned/local[feature]",
    "owned/local [feature]",
    "owned dir/local",
    String.raw`owned\local`,
    String.raw`C:\owned\local`,
    "c:/owned/local",
    "D:owned",
    "z:owned.whl",
    "file:owned",
    "FILE:owned/local",
    "file:///owned/local",
    "../outside",
    "/outside",
    String.raw`\\server\share\owned`,
    "owned/local\\\nproject",
  ])("rejects obvious unnamed path data without origin access: %j", (line) => {
    expect(isRootLocalRequirementReference(line)).toBe(true);
  });
  it.each(
    extensions.flatMap((extension) => [
      `owned${extension}`,
      `OWNED${extension.toUpperCase()}`,
      `owned${extension}[feature]`,
      `owned${extension} [feature]`,
      `owned${extension}[ ]`,
    ])
  )("uses pip lexical archive types and nonempty extras: %s", (line) => {
    expect(isRootLocalRequirementReference(line)).toBe(true);
  });
  it.each([
    "plain-project",
    "c",
    "file",
    "legitimate.tar.gz==2.0",
    "legitimate.whl>=3",
    "legitimate.zip~=4",
    "archive.whl[]",
    "archive.tar.gz[]",
    "plain-project[feature]",
    "plain-project[]",
    "pkg==opaque/path",
    String.raw`pkg>=opaque\value`,
    "pkg (>=opaque/path)",
    "pkg (opaque/path)",
    String.raw`pkg (lane\value)`,
    "pkg[extra](opaque/path)",
    String.raw`pkg [extra] (lane\value)`,
    "pkg[extra] (>=opaque/path)",
    "named @ owned/local",
    "named[extra]@ owned/local",
    "named @ archive.whl",
    "named @ file:owned",
    "named\t[ extra ]\t@ owned/local",
    "pkg\u00a0==opaque/path",
    "pkg[extra] >=opaque/path",
    "ordinary.unrecognized",
    "ordinary.tar.zst",
    "ordinary.whl.backup",
  ])("retains existing named declarations and ambiguous plain names: %j", (line) => {
    expect(isRootLocalRequirementReference(line)).toBe(false);
  });
  it("omits local origins without deriving names from nested project metadata", async () => {
    const deps = await extract(
      [
        "requests==2.31",
        "owned/local",
        String.raw`C:\owned\local`,
        "file:owned",
        ...extensions.map((extension) => `owned${extension}`),
        "archive.whl[extra]",
        "archive.tar.gz[]",
        "legitimate.tar.gz==2.0",
        "c==3",
        "plain-project",
        "plain-project==4",
        "named @ owned/local",
      ].join("\n")
    );
    expect(deps?.runtime).toEqual([
      { name: "requests", version: "2.31", type: "runtime" },
      { name: "archive.tar.gz", version: "*", type: "runtime" },
      { name: "legitimate.tar.gz", version: "2.0", type: "runtime" },
      { name: "c", version: "3", type: "runtime" },
      { name: "plain-project", version: "*", type: "runtime" },
      { name: "plain-project", version: "4", type: "runtime" },
      { name: "named", version: "@ owned/local", type: "runtime" },
    ]);
    expect(deps?.totalCount).toBe(7);
  });
  it("preserves literal comparison/parenthesized and named-reference suffixes", async () => {
    const deps = await extract(
      [
        "pkg==opaque/path",
        String.raw`pkg>=opaque\value`,
        "pkg (>=opaque/path)",
        "pkg (opaque/path)",
        String.raw`pkg (lane\value)`,
        "pkg[extra](opaque/path)",
        String.raw`pkg [extra] (lane\value)`,
        "named @ archive.whl",
        "named[extra]@ file:owned",
        "archive.whl[]",
      ].join("\n")
    );
    expect(deps?.runtime.map(({ name, version }) => [name, version])).toEqual([
      ["pkg", "opaque/path"],
      ["pkg", String.raw`opaque\value`],
      ["pkg", "(>=opaque/path)"],
      ["pkg", "(opaque/path)"],
      ["pkg", String.raw`(lane\value)`],
      ["pkg", "(opaque/path)"],
      ["pkg", String.raw`(lane\value)`],
      ["named", "@ archive.whl"],
      ["named", "@ file:owned"],
      ["archive.whl", "*"],
    ]);
  });
  it("retains inline-comment/marker/continuation conventions before classification", async () => {
    const deps = await extract(
      'owned/\\\nlocal\nrequests>=2,\\\n<3 # ordinary/archive.whl\nplain-project; python_version >= "3.10"\n'
    );
    expect(deps?.runtime).toEqual([
      { name: "requests", version: "2,<3", type: "runtime" },
      { name: "plain-project", version: "*", type: "runtime" },
    ]);
  });
  it("leaves pyproject precedence and named PEP references untouched", async () => {
    const deps = await extract("owned/local\nroot-only==1", {
      "pyproject.toml": '[project]\ndependencies=["named @ file:owned/local", "ordinary>=3"]',
    });
    expect(deps?.runtime.map(({ name, version }) => [name, version])).toEqual([
      ["named", "@ file:owned/local"],
      ["ordinary", ">=3"],
    ]);
  });
});
