import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractDependencies } from "../src/deps.js";

async function extract(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-python-identity-"));
  try {
    for (const [name, value] of Object.entries(files)) await writeFile(join(dir, name), value);
    return await extractDependencies(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const project = (requirements: string[]) =>
  `[project]\ndependencies = ${JSON.stringify(requirements)}`;

describe("Python prefixes and canonical first-wins identity", () => {
  it.each([
    ["requests [security,tests] >=2.28", ">=2.28"],
    ["requests\t[ security , tests ]\t>=2.28", ">=2.28"],
    ["requests [ ] >=2.28", ">=2.28"],
    ["requests[]>=2.28", ">=2.28"],
    ["requests [security]", "*"],
    ["requests [security] (>=2.28, <3)", "(>=2.28, <3)"],
    ["requests [security] >=2.28, <3; python_version >= '3.10'", ">=2.28, <3"],
    [
      "requests [security] @ https://example.invalid/pkg.whl;owned#sha256=abc ; python_version >= '3.10'",
      "@ https://example.invalid/pkg.whl;owned#sha256=abc",
    ],
    [
      "requests\t[security]@  https://example.invalid/pkg.whl;owned#sha256=abc\t;python_version >= '3.10'",
      "@  https://example.invalid/pkg.whl;owned#sha256=abc",
    ],
  ])("strips only legal spaced extras in %s", async (requirement, version) => {
    const deps = await extract({ "pyproject.toml": project([requirement]) });
    expect(deps?.runtime).toEqual([{ name: "requests", version, type: "runtime" }]);
  });

  it("keeps original first spelling/version while folding only Python identity aliases", async () => {
    const deps = await extract({
      "pyproject.toml": project([
        "Requests [security]>=2.28",
        "requests==99",
        "foo_bar>=1",
        "foo-bar==99",
        "foo.bar==100",
        "foo--bar==101",
        "foobar>=2",
        "foo-bar-baz>=3",
        "Foo.Bar.Baz==99",
        "foo_bar[security]>=9",
      ]),
    });
    expect(deps?.totalCount).toBe(4);
    expect(deps?.runtime).toEqual([
      { name: "Requests", version: ">=2.28", type: "runtime" },
      { name: "foo_bar", version: ">=1", type: "runtime" },
      { name: "foobar", version: ">=2", type: "runtime" },
      { name: "foo-bar-baz", version: ">=3", type: "runtime" },
    ]);
  });

  it("deduplicates optional arrays into runtime but keeps dev identity independent", async () => {
    const deps = await extract({
      "pyproject.toml":
        project(["Requests [security]>=2.28", "foo_bar>=1"]) +
        `\n[project.optional-dependencies]\nweb = ["requests==99", "Foo.Bar==9", "rich [ ]>=13"]\n[dependency-groups]\ntest = ["REQUESTS [ ]>=3", "foo-bar>=2", "foo.bar==99", "pytest [cov]>=8", "PYTEST==99"]`,
    });
    expect(deps?.totalCount).toBe(6);
    expect(deps?.runtime.map(({ name, version }) => [name, version])).toEqual([
      ["Requests", ">=2.28"],
      ["foo_bar", ">=1"],
      ["rich", ">=13"],
    ]);
    expect(deps?.dev.map(({ name, version }) => [name, version])).toEqual([
      ["REQUESTS", ">=3"],
      ["foo-bar", ">=2"],
      ["pytest", ">=8"],
    ]);
  });

  it("retains existing Poetry/hybrid traversal and version semantics with valid bare keys", async () => {
    const deps = await extract({
      "pyproject.toml": `[project]
dependencies = ["foo.bar>=99", "requests [security]>=99", "foobar>=2"]
[project.optional-dependencies]
web = ["Requests==100", "rich [ ]>=13"]
[dependency-groups]
test = ["foo.bar>=99", "pytest [cov]>=99"]
[tool.poetry.dependencies]
python = ">=3.10"
Foo_Bar = {version = "^1", extras = ["feature"]}
Requests = "^2.28"
foo-bar = "^99"
[tool.poetry.dev-dependencies]
FOO_bar = "^2"
Pytest = "^8"
[tool.poetry.group.web.dependencies]
foo-bar = "^100"
httpx = "^0.27"
[tool.poetry.group.dev.dependencies]
foo-bar = "^99"
ruff = "^0.5"
`,
    });
    expect(deps?.packageManager).toBe("poetry");
    expect(deps?.totalCount).toBe(8);
    expect(deps?.runtime.map(({ name, version }) => [name, version])).toEqual([
      ["Foo_Bar", "^1"],
      ["Requests", "^2.28"],
      ["httpx", "^0.27"],
      ["foobar", ">=2"],
      ["rich", ">=13"],
    ]);
    expect(deps?.dev.map(({ name, version }) => [name, version])).toEqual([
      ["FOO_bar", "^2"],
      ["Pytest", "^8"],
      ["ruff", "^0.5"],
    ]);
  });

  it("preserves pip duplicate retention, operator stripping and omissions while stripping spaced extras", async () => {
    const deps = await extract({
      "requirements.txt": [
        "Requests [security]>=2.28",
        "requests\t[ ]==99",
        "Requests [security]",
        "Requests [security] (>=2.28, <3)",
        "foo_bar [ ]~=1",
        "foo-bar!=2",
        "foo.bar===3",
        "foo--bar<=4",
        "named [security] @ https://example.invalid/pkg.whl;owned#hash",
        "https://example.invalid/pkg.whl",
        "./pkg.whl",
        "-r other.txt",
        "requests [security]==2.31 # see https://example.invalid/",
      ].join("\n"),
    });
    expect(deps?.runtime.map(({ name, version }) => [name, version])).toEqual([
      ["Requests", "2.28"],
      ["requests", "99"],
      ["Requests", "*"],
      ["Requests", "(>=2.28, <3)"],
      ["foo_bar", "1"],
      ["foo-bar", "2"],
      ["foo.bar", "3"],
      ["foo--bar", "4"],
      ["requests", "2.31"],
    ]);
  });

  it("keeps Node separator variants and Python records distinct in mixed output", async () => {
    const deps = await extract({
      "package.json": JSON.stringify({
        dependencies: { foo_bar: "^9", "foo-bar": "^10", "foo.bar": "^11" },
      }),
      "pyproject.toml": project(["foo_bar [ ]>=1", "foo-bar>=9", "foo.bar>=99", "foobar>=2"]),
    });
    expect(deps?.totalCount).toBe(5);
    expect(deps?.runtime).toEqual([
      {
        name: "foo_bar",
        version: "^9",
        type: "runtime",
        ecosystem: "node",
        sourceFile: "package.json",
      },
      {
        name: "foo-bar",
        version: "^10",
        type: "runtime",
        ecosystem: "node",
        sourceFile: "package.json",
      },
      {
        name: "foo.bar",
        version: "^11",
        type: "runtime",
        ecosystem: "node",
        sourceFile: "package.json",
      },
      {
        name: "foo_bar",
        version: ">=1",
        type: "runtime",
        ecosystem: "python",
        sourceFile: "pyproject.toml",
      },
      {
        name: "foobar",
        version: ">=2",
        type: "runtime",
        ecosystem: "python",
        sourceFile: "pyproject.toml",
      },
    ]);
  });

  it.each([
    ["requests[sec!]>=2.28", ">=2.28"],
    ["requests[security", "[security"],
    ["requests\u00a0[security]>=2.28", "[security]>=2.28"],
  ])("does not expand into a general invalid-requirement validator: %s", async (raw, version) => {
    const deps = await extract({ "pyproject.toml": project([raw]) });
    expect(deps?.runtime).toEqual([{ name: "requests", version, type: "runtime" }]);
  });

  it("retains first accepted records across a larger alias collection", async () => {
    const requirements = Array.from({ length: 100 }, (_, index) => [
      `Package_${index} [ ]>=${index + 1}`,
      `package-${index}==99`,
      `package.${index}==100`,
    ]).flat();
    const deps = await extract({ "pyproject.toml": project(requirements) });
    expect(deps?.totalCount).toBe(100);
    expect(deps?.runtime.map(({ name, version }) => [name, version])).toEqual(
      Array.from({ length: 100 }, (_, index) => [`Package_${index}`, `>=${index + 1}`])
    );
  });
});
