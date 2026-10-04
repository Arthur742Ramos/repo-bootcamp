import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractDependencies } from "../src/deps.js";
import { rootRequirementLogicalLines } from "../src/requirements-logical-lines.js";

// In-memory outputs cross-checked against pip 26.2.1 join_lines/ignore_comments.
// Admission of unsupported path-like prefixes deliberately remains unchanged.
const stripped = (text: string) =>
  [...rootRequirementLogicalLines(text)]
    .map((line) => line.split(/\s+#/)[0].trim())
    .filter((line) => line && !line.startsWith("#"));
const cases: [string, string[]][] = [
  ["requests>=2.28,\\\n<3", ["requests>=2.28,<3"]],
  ["requests>=2.28,\\\r\n<3", ["requests>=2.28,<3"]],
  ["requests>=2.28,\\\r<3", ["requests>=2.28,<3"]],
  ["--find-links \\\n    wheels", ["--find-links     wheels"]],
  ["-r \\\n    ignored.txt", ["-r     ignored.txt"]],
  ["requests==2 # note\\\nphantom==99", ["requests==2"]],
  ["# note\\\nrequests==2", ["requests==2"]],
  ["requests==2\\\n# note\\\nnext==3", ["requests==2", "next==3"]],
  ["requests==2\\\n   # note\nnext==3", ["requests==2", "next==3"]],
  ["requests==2\\\\\n.0", ["requests==2.0"]],
  ["requests==2\\\\\\\n.0", ["requests==2.0"]],
  ["requests==2\\", ["requests==2"]],
  ["requests==2\\\n", ["requests==2"]],
  ["requests==2\\ \nnext==3", ["requests==2\\", "next==3"]],
  ["requests==2\\\n\\\n.0", ["requests==2.0"]],
  ["requests==2\\\n\nnext==3", ["requests==2", "next==3"]],
  ["requests==2#fragment", ["requests==2#fragment"]],
  ["requests==${OWNED_VERSION}", ["requests==${OWNED_VERSION}"]],
  ["", []],
  ["\n\r\n\r", []],
];
async function extract(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-root-lines-unit-"));
  try {
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
    return await extractDependencies(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("root requirement logical lines", () => {
  it.each(cases)("joins before stripping comments: %j", (text, expected) => {
    expect(stripped(text)).toEqual(expected);
  });
  it.each(["\\requests==2\\\n,<3", "\\\\requests==2\\\n,<3"])(
    "preserves unsupported leading path prefixes: %j",
    async (text) => {
      expect(stripped(text)[0].startsWith("\\")).toBe(true);
      expect(await extract({ "requirements.txt": text })).toBeNull();
    }
  );
  it.each(["\n", "\r\n", "\r"])(
    "projects supported continued declarations like equivalent logical lines with %j",
    async (ending) => {
      const physical = [
        "requests>=2.28,\\",
        "<3",
        "urllib3[security]\\",
        ">=2,<3",
        "rich~=13\\",
        '; python_version >= "3.10"',
        "duplicate==1",
        "duplicate>=2",
      ].join(ending);
      const logical =
        'requests>=2.28,<3\nurllib3[security]>=2,<3\nrich~=13; python_version >= "3.10"\nduplicate==1\nduplicate>=2';
      const deps = await extract({ "requirements.txt": physical });
      expect(deps).toEqual(await extract({ "requirements.txt": logical }));
      expect(deps?.runtime.map(({ name, version }) => [name, version])).toEqual([
        ["requests", "2.28,<3"],
        ["urllib3", "2,<3"],
        ["rich", "13"],
        ["duplicate", "1"],
        ["duplicate", "2"],
      ]);
    }
  );
  it("does not admit continued options, includes, editables, URLs or local paths", async () => {
    const deps = await extract({
      "requirements.txt": [
        "--find-links \\",
        "wheels",
        "-r \\",
        "ignored.txt",
        "-c \\",
        "constraints.txt",
        "--trusted-host \\",
        "phantom-host",
        "-e \\",
        "editable-owned",
        "git+https://\\",
        "example.invalid/pkg.git",
        "https://\\",
        "example.invalid/pkg.whl",
        "sample @ \\",
        "https://example.invalid/pkg.whl",
        "./local\\",
        "-owned",
        "requests==2",
      ].join("\n"),
      "ignored.txt": "outside_scope_package==99",
      "constraints.txt": "constraint_scope_package==99",
    });
    expect(deps?.runtime).toEqual([{ name: "requests", version: "2", type: "runtime" }]);
  });
  it("keeps environment text, opaque requirement flags and trailing whitespace conventions", async () => {
    const deps = await extract({
      "requirements.txt":
        "envliteral==${OWNED_ROOT_VERSION}\nrequests==2 \\\n --hash=sha256:owned\ntrailing==7\\ \nnext==8",
    });
    expect(deps?.runtime.map(({ name, version }) => [name, version])).toEqual([
      ["envliteral", "${OWNED_ROOT_VERSION}"],
      ["requests", "2  --hash=sha256:owned"],
      ["trailing", "7\\"],
      ["next", "8"],
    ]);
  });
  it("retains pyproject precedence rather than joining its literals or reading requirements", async () => {
    const deps = await extract({
      "requirements.txt": "phantom==2\\\n.0",
      "pyproject.toml": '[project]\ndependencies=["actual>=3"]',
    });
    expect(deps?.runtime).toEqual([{ name: "actual", version: ">=3", type: "runtime" }]);
  });
  it("joins long continuation groups without losing any fragment", () => {
    const fragments = Array.from({ length: 20_000 }, (_, index) => String(index));
    expect(stripped(fragments.join("\\\n"))).toEqual([fragments.join("")]);
  });
});
