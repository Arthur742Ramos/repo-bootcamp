import { describe, expect, it } from "vitest";
import { scanTomlMetadata, type TomlMetadataValue } from "../src/toml-metadata-scan.js";

const plain = (value: TomlMetadataValue): unknown => {
  if (value instanceof Map)
    return Object.fromEntries([...value].map(([key, member]) => [key, plain(member)]));
  if (Array.isArray(value)) return value.map(plain);
  return value;
};

// Independent Python tomllib structures from the 44 Poetry schema audit fixtures.
// Schema-invalid dependency shapes can still be structurally valid TOML.
const oracle: [string, string, string | null][] = [
  [
    "scalar-bare",
    '[tool.poetry.dependencies]\nrequests = "^2.28"\n',
    '{"tool":{"poetry":{"dependencies":{"requests":"^2.28"}}}}',
  ],
  [
    "scalar-basic",
    '["tool" . "poetry" . "dependencies"]\n"requests" = "^2.28"\n',
    '{"tool":{"poetry":{"dependencies":{"requests":"^2.28"}}}}',
  ],
  [
    "scalar-literal",
    "['tool'.'poetry'.'dependencies']\n'requests' = '^2.28'\n",
    '{"tool":{"poetry":{"dependencies":{"requests":"^2.28"}}}}',
  ],
  [
    "scalar-escape",
    '["to\\u006fl" . poetry . dependencies]\n"\\u0072equests" = "^2.28"\n',
    '{"tool":{"poetry":{"dependencies":{"requests":"^2.28"}}}}',
  ],
  [
    "object-inline",
    '[tool.poetry.dependencies]\nrequests = { version = " >= 1, < 3 ", extras = ["security"], markers = "python_version >= \\"3.10\\"", optional = true, source = "owned" }\n',
    '{"tool":{"poetry":{"dependencies":{"requests":{"version":" >= 1, < 3 ","extras":["security"],"markers":"python_version >= \\"3.10\\"","optional":true,"source":"owned"}}}}}',
  ],
  [
    "object-dotted",
    '[tool.poetry.dependencies]\nrequests.version = " >= 1, < 3 "\nrequests.extras = ["security"]\nrequests.markers = "python_version >= \\"3.10\\""\nrequests.optional = true\nrequests.source = "owned"\n',
    '{"tool":{"poetry":{"dependencies":{"requests":{"version":" >= 1, < 3 ","extras":["security"],"markers":"python_version >= \\"3.10\\"","optional":true,"source":"owned"}}}}}',
  ],
  [
    "object-nested",
    '[tool.poetry.dependencies.requests]\nversion = " >= 1, < 3 "\nextras = ["security"]\nmarkers = "python_version >= \\"3.10\\""\noptional = true\nsource = "owned"\n',
    '{"tool":{"poetry":{"dependencies":{"requests":{"version":" >= 1, < 3 ","extras":["security"],"markers":"python_version >= \\"3.10\\"","optional":true,"source":"owned"}}}}}',
  ],
  [
    "object-root",
    'tool.poetry.dependencies.requests.version = " >= 1, < 3 "\ntool.poetry.dependencies.requests.extras = ["security"]\ntool.poetry.dependencies.requests.markers = "python_version >= \\"3.10\\""\ntool.poetry.dependencies.requests.optional = true\ntool.poetry.dependencies.requests.source = "owned"\n',
    '{"tool":{"poetry":{"dependencies":{"requests":{"version":" >= 1, < 3 ","extras":["security"],"markers":"python_version >= \\"3.10\\"","optional":true,"source":"owned"}}}}}',
  ],
  [
    "object-parent",
    '[tool.poetry]\ndependencies.requests.version = " >= 1, < 3 "\ndependencies.requests.extras = ["security"]\ndependencies.requests.markers = "python_version >= \\"3.10\\""\ndependencies.requests.optional = true\ndependencies.requests.source = "owned"\n',
    '{"tool":{"poetry":{"dependencies":{"requests":{"version":" >= 1, < 3 ","extras":["security"],"markers":"python_version >= \\"3.10\\"","optional":true,"source":"owned"}}}}}',
  ],
  [
    "object-mixed-build",
    '[tool.poetry.dependencies]\nrequests.source = "owned"\nfoo = "^9"\nrequests.version = " >= 1, < 3 "\nrequests.extras = ["security"]\nrequests.optional = true\nrequests.markers = \'python_version >= "3.10"\'\n',
    '{"tool":{"poetry":{"dependencies":{"requests":{"source":"owned","version":" >= 1, < 3 ","extras":["security"],"optional":true,"markers":"python_version >= \\"3.10\\""},"foo":"^9"}}}}',
  ],
  [
    "dotted-name-inline",
    '[tool.poetry.dependencies]\n"zope.interface" = {version = "^6"}\n',
    '{"tool":{"poetry":{"dependencies":{"zope.interface":{"version":"^6"}}}}}',
  ],
  [
    "dotted-name-path",
    '[tool.poetry.dependencies]\n"zope.interface" . "version" = "^6"\n',
    '{"tool":{"poetry":{"dependencies":{"zope.interface":{"version":"^6"}}}}}',
  ],
  [
    "dotted-name-nested",
    "[tool.poetry.dependencies.'zope.interface']\nversion = '^6'\n",
    '{"tool":{"poetry":{"dependencies":{"zope.interface":{"version":"^6"}}}}}',
  ],
  [
    "dotted-name-root",
    'tool.poetry.dependencies."zope\\U0000002Einterface".version = "^6"\n',
    '{"tool":{"poetry":{"dependencies":{"zope.interface":{"version":"^6"}}}}}',
  ],
  [
    "group-inline",
    '[tool.poetry.group."docs.prod".dependencies]\n"zope.interface" = {version = "^6"}\n',
    '{"tool":{"poetry":{"group":{"docs.prod":{"dependencies":{"zope.interface":{"version":"^6"}}}}}}}',
  ],
  [
    "group-nested",
    "['tool'.poetry.group.'docs.prod'.dependencies.'zope.interface']\nversion = '^6'\n",
    '{"tool":{"poetry":{"group":{"docs.prod":{"dependencies":{"zope.interface":{"version":"^6"}}}}}}}',
  ],
  [
    "group-root",
    'tool.poetry.group."docs\\u002eprod".dependencies."zope.interface".version = "^6"\n',
    '{"tool":{"poetry":{"group":{"docs.prod":{"dependencies":{"zope.interface":{"version":"^6"}}}}}}}',
  ],
  [
    "group-namespace-phantom",
    '[tool.poetry.group.docs.prod.dependencies]\nsphinx = "^8"\n',
    '{"tool":{"poetry":{"group":{"docs":{"prod":{"dependencies":{"sphinx":"^8"}}}}}}}',
  ],
  [
    "unknown-attribute",
    '[tool.poetry.dependencies]\nfoo.bar = "^1"\n',
    '{"tool":{"poetry":{"dependencies":{"foo":{"bar":"^1"}}}}}',
  ],
  [
    "unknown-plus-valid-version",
    '[tool.poetry.dependencies]\nfoo.bar = "^1"\nfoo.version = "^2"\n',
    '{"tool":{"poetry":{"dependencies":{"foo":{"bar":"^1","version":"^2"}}}}}',
  ],
  [
    "options-only",
    '[tool.poetry.dependencies]\nrequests.source = "owned"\nrequests.markers = \'python_version >= "3.10"\'\n',
    '{"tool":{"poetry":{"dependencies":{"requests":{"source":"owned","markers":"python_version >= \\"3.10\\""}}}}}',
  ],
  [
    "empty-options",
    "[tool.poetry.dependencies]\nrequests = {}\n",
    '{"tool":{"poetry":{"dependencies":{"requests":{}}}}}',
  ],
  [
    "version-type-invalid",
    "[tool.poetry.dependencies.requests]\nversion = 1\n",
    '{"tool":{"poetry":{"dependencies":{"requests":{"version":1}}}}}',
  ],
  [
    "extras-only-invalid",
    '[tool.poetry.dependencies]\nrequests.extras = ["security"]\n',
    '{"tool":{"poetry":{"dependencies":{"requests":{"extras":["security"]}}}}}',
  ],
  [
    "all-origin-objects",
    '[tool.poetry.dependencies]\ngitpkg = {git = "https://example.invalid/owned.git", rev = "owned", subdirectory = "pkg", develop = true}\nfilepkg = {file = "./owned.whl", subdirectory = "pkg"}\npathpkg = {path = "./owned", develop = true}\nurlpkg = {url = "https://example.invalid/owned.whl#hash=owned", subdirectory = "pkg"}\n',
    '{"tool":{"poetry":{"dependencies":{"gitpkg":{"git":"https://example.invalid/owned.git","rev":"owned","subdirectory":"pkg","develop":true},"filepkg":{"file":"./owned.whl","subdirectory":"pkg"},"pathpkg":{"path":"./owned","develop":true},"urlpkg":{"url":"https://example.invalid/owned.whl#hash=owned","subdirectory":"pkg"}}}}}',
  ],
  [
    "array-inline",
    '[tool.poetry.dependencies]\nfoo = [{version = "^1", python = ">=3.8,<3.10"}, {version = "^2", python = ">=3.10"}]\n',
    '{"tool":{"poetry":{"dependencies":{"foo":[{"version":"^1","python":">=3.8,<3.10"},{"version":"^2","python":">=3.10"}]}}}}',
  ],
  [
    "array-multiline",
    '[tool.poetry.dependencies]\nfoo = [\n {version = "^1", python = ">=3.8,<3.10"},\n {version = "^2", python = ">=3.10"},\n]\n',
    '{"tool":{"poetry":{"dependencies":{"foo":[{"version":"^1","python":">=3.8,<3.10"},{"version":"^2","python":">=3.10"}]}}}}',
  ],
  [
    "array-tables",
    '[[tool.poetry.dependencies.foo]]\nversion = "^1"\npython = ">=3.8,<3.10"\n[[tool.poetry.dependencies.foo]]\nversion = "^2"\npython = ">=3.10"\n',
    '{"tool":{"poetry":{"dependencies":{"foo":[{"version":"^1","python":">=3.8,<3.10"},{"version":"^2","python":">=3.10"}]}}}}',
  ],
  [
    "array-empty-invalid",
    "[tool.poetry.dependencies]\nfoo = []\n",
    '{"tool":{"poetry":{"dependencies":{"foo":[]}}}}',
  ],
  [
    "array-invalid-member",
    '[tool.poetry.dependencies]\nfoo = [{version = "^1"}, {bar = "^2"}]\n',
    '{"tool":{"poetry":{"dependencies":{"foo":[{"version":"^1"},{"bar":"^2"}]}}}}',
  ],
  [
    "array-origin-first",
    '[tool.poetry.dependencies]\nfoo = [{url = "https://example.invalid/owned.whl", markers = \'sys_platform == "linux"\'}, {version = "^2", markers = \'sys_platform == "win32"\'}]\n',
    '{"tool":{"poetry":{"dependencies":{"foo":[{"url":"https://example.invalid/owned.whl","markers":"sys_platform == \\"linux\\""},{"version":"^2","markers":"sys_platform == \\"win32\\""}]}}}}',
  ],
  [
    "group-order-metadata",
    '[tool.poetry.group.docs]\noptional = true\n[tool.poetry.group.web.dependencies]\nalpha = "^1"\n[tool.poetry.group.docs.dependencies]\nALPHA = "^9"\n',
    '{"tool":{"poetry":{"group":{"docs":{"optional":true,"dependencies":{"ALPHA":"^9"}},"web":{"dependencies":{"alpha":"^1"}}}}}}',
  ],
  [
    "package-order-completion",
    '[tool.poetry.dependencies]\nFoo_Bar.source = "owned"\nfoo-bar = "^9"\nFoo_Bar.version = "^1"\n',
    '{"tool":{"poetry":{"dependencies":{"Foo_Bar":{"source":"owned","version":"^1"},"foo-bar":"^9"}}}}',
  ],
  [
    "invalid-before-valid-alias",
    '[tool.poetry.dependencies]\nFoo_Bar.bar = "^0"\nfoo-bar = "^9"\n',
    '{"tool":{"poetry":{"dependencies":{"Foo_Bar":{"bar":"^0"},"foo-bar":"^9"}}}}',
  ],
  [
    "nested-before-bare-alias",
    '[tool.poetry.dependencies.Foo_Bar]\nsource = "owned"\nversion = "^1"\n[tool.poetry.dependencies]\nfoo-bar = "^9"\n',
    '{"tool":{"poetry":{"dependencies":{"Foo_Bar":{"source":"owned","version":"^1"},"foo-bar":"^9"}}}}',
  ],
  [
    "hybrid-phase",
    '[tool.poetry.group.test.dependencies]\nFoo_Bar = "^8"\n[project]\ndependencies = ["foo-bar>=99"]\n[tool.poetry.dependencies]\n"foo.bar" = "^1"\n[tool.poetry.dev-dependencies]\n"foo.bar" = "^2"\n',
    '{"tool":{"poetry":{"group":{"test":{"dependencies":{"Foo_Bar":"^8"}}},"dependencies":{"foo.bar":"^1"},"dev-dependencies":{"foo.bar":"^2"}}},"project":{"dependencies":["foo-bar>=99"]}}',
  ],
  [
    "fake-string-headers",
    "[tool.poetry.dependencies]\ncontrol = \"^1\"\nrequests = {version = \"^2\", markers = '''\n[tool.poetry.dependencies]\nphantom = \"^99\"\n''' }\n",
    '{"tool":{"poetry":{"dependencies":{"control":"^1","requests":{"version":"^2","markers":"[tool.poetry.dependencies]\\nphantom = \\"^99\\"\\n"}}}}}',
  ],
  [
    "fake-nested-marker",
    "[tool.poetry.dependencies.requests]\nversion = \"^2\"\nmarkers = '''\n[tool.poetry.dependencies]\nphantom = \"^99\"\n'''\n",
    '{"tool":{"poetry":{"dependencies":{"requests":{"version":"^2","markers":"[tool.poetry.dependencies]\\nphantom = \\"^99\\"\\n"}}}}}',
  ],
  [
    "fake-unrelated-metadata",
    '[tool.other]\ndescription = """\n[tool.poetry.dependencies]\nphantom = "^99"\n"""\n[tool.poetry.dependencies]\ncontrol = "^1"\n',
    '{"tool":{"other":{"description":"[tool.poetry.dependencies]\\nphantom = \\"^99\\"\\n"},"poetry":{"dependencies":{"control":"^1"}}}}',
  ],
  [
    "fake-inline-version",
    "[tool.poetry.dependencies]\nrequests = {source = 'version = \"^99\"'}\n",
    '{"tool":{"poetry":{"dependencies":{"requests":{"source":"version = \\"^99\\""}}}}}',
  ],
  [
    "duplicate-key-invalid",
    '[tool.poetry.dependencies]\nrequests = "^1"\n"requests" = "^2"\n',
    null,
  ],
  [
    "fake-only-unrelated-metadata",
    '[tool.other]\ndescription = """\n[tool.poetry.dependencies]\nphantom = "^99"\n"""\n',
    '{"tool":{"other":{"description":"[tool.poetry.dependencies]\\nphantom = \\"^99\\"\\n"}}}',
  ],
  [
    "namespace-single-component",
    '"tool.poetry".dependencies.requests = "^1"\n',
    '{"tool.poetry":{"dependencies":{"requests":"^1"}}}',
  ],
  [
    "fake-inline-marker",
    '[tool.poetry.dependencies]\nrequests = { markers = """os_name == "version = \'^99\'"""" }\n',
    '{"tool":{"poetry":{"dependencies":{"requests":{"markers":"os_name == \\"version = \'^99\'\\""}}}}}',
  ],
];

describe("bounded typed TOML metadata cursor", () => {
  it("orders inline dotted group containers by actual dependency occurrence", () => {
    const source =
      'tool.poetry.group = { docs.optional=true, web.dependencies.alpha="^1", docs.dependencies.ALPHA="^9" }';
    const result = scanTomlMetadata(source);
    expect(result.complete).toBe(true);
    expect(result.declarations.map((event) => event.path)).toEqual([["tool", "poetry", "group"]]);
    expect(result.occurrences.map((event) => event.path)).toEqual([
      ["tool", "poetry", "group"],
      ["tool", "poetry", "group", "docs", "optional"],
      ["tool", "poetry", "group", "web", "dependencies", "alpha"],
      ["tool", "poetry", "group", "docs", "dependencies", "ALPHA"],
    ]);
    expect(result.occurrences.slice(1).map(({ offset, end }) => source.slice(offset, end))).toEqual(
      ["docs.optional=true", 'web.dependencies.alpha="^1"', 'docs.dependencies.ALPHA="^9"']
    );
    const containers = result.occurrences.filter((event) => event.path[4] === "dependencies");
    expect(containers.map((event) => event.path[3])).toEqual(["web", "docs"]);
  });

  it("includes fully inline owning paths while keeping outer source slicing stable", () => {
    const source = 'tool={poetry={dependencies={requests="^2"}}}';
    const result = scanTomlMetadata(source);
    expect(result.complete).toBe(true);
    expect(result.declarations).toEqual([
      { kind: "assignment", path: ["tool"], offset: 0, end: source.length },
    ]);
    expect(result.occurrences.map((event) => event.path)).toEqual([
      ["tool"],
      ["tool", "poetry"],
      ["tool", "poetry", "dependencies"],
      ["tool", "poetry", "dependencies", "requests"],
    ]);
    expect(result.occurrences.map(({ offset, end }) => source.slice(offset, end))).toEqual([
      source,
      'poetry={dependencies={requests="^2"}}',
      'dependencies={requests="^2"}',
      'requests="^2"',
    ]);
  });

  it("keeps inline alternative occurrences under their semantic array owner and ignores fake strings", () => {
    const source = `[tool.poetry.dependencies]
foo = [{version="^1", markers='version="fake" # ignored'}, {version="^2", source="""
[tool.poetry.group.fake.dependencies]
phantom = "^99"
"""}]
`;
    const result = scanTomlMetadata(source);
    expect(result.complete).toBe(true);
    expect(result.declarations.map((event) => event.path)).toEqual([
      ["tool", "poetry", "dependencies"],
      ["tool", "poetry", "dependencies", "foo"],
    ]);
    expect(result.occurrences.map((event) => event.path)).toEqual([
      ["tool", "poetry", "dependencies"],
      ["tool", "poetry", "dependencies", "foo"],
      ["tool", "poetry", "dependencies", "foo", "version"],
      ["tool", "poetry", "dependencies", "foo", "markers"],
      ["tool", "poetry", "dependencies", "foo", "version"],
      ["tool", "poetry", "dependencies", "foo", "source"],
    ]);
    expect(result.occurrences.map((event) => event.offset)).toEqual(
      [...result.occurrences.map((event) => event.offset)].sort((left, right) => left - right)
    );
    expect(
      result.occurrences.some(
        (event) => event.path.includes("phantom") || event.path.includes("fake")
      )
    ).toBe(false);
  });

  it("does not publish inner occurrences from an unclosed inline assignment", () => {
    const result = scanTomlMetadata(
      'control="owned"\nbad={version="^1", source="unterminated\nphantom="^99"'
    );
    expect(result.complete).toBe(false);
    expect(result.occurrences.map((event) => event.path)).toEqual([["control"]]);
  });

  it.each(oracle)("matches independent tomllib structure: %s", (_name, source, expected) => {
    const result = scanTomlMetadata(source);
    expect(result.complete).toBe(expected !== null);
    if (expected !== null) {
      const tree = JSON.parse(expected, (_key, value: unknown) =>
        typeof value === "number" ? { kind: "opaque", raw: String(value) } : value
      );
      expect(plain(result.root)).toEqual(tree);
    }
  });

  it("tracks actual container/assignment occurrences, including current array elements", () => {
    const source = `# lead
[tool.poetry.dependencies.Foo_Bar]
source = "owned"
version = "^1"
[tool.poetry.dependencies]
foo-bar = "^9"
[[tool.poetry.dependencies.other]]
version = "^2"
[[tool.poetry.dependencies.other]]
version = "^3"
`;
    const result = scanTomlMetadata(source);
    expect(result.complete).toBe(true);
    expect(result.declarations.map(({ kind, path }) => [kind, path])).toEqual([
      ["table", ["tool", "poetry", "dependencies", "Foo_Bar"]],
      ["assignment", ["tool", "poetry", "dependencies", "Foo_Bar", "source"]],
      ["assignment", ["tool", "poetry", "dependencies", "Foo_Bar", "version"]],
      ["table", ["tool", "poetry", "dependencies"]],
      ["assignment", ["tool", "poetry", "dependencies", "foo-bar"]],
      ["table", ["tool", "poetry", "dependencies", "other"]],
      ["assignment", ["tool", "poetry", "dependencies", "other", "version"]],
      ["table", ["tool", "poetry", "dependencies", "other"]],
      ["assignment", ["tool", "poetry", "dependencies", "other", "version"]],
    ]);
    expect(result.declarations.map(({ offset, end }) => source.slice(offset, end))).toEqual([
      "[tool.poetry.dependencies.Foo_Bar]",
      'source = "owned"',
      'version = "^1"',
      "[tool.poetry.dependencies]",
      'foo-bar = "^9"',
      "[[tool.poetry.dependencies.other]]",
      'version = "^2"',
      "[[tool.poetry.dependencies.other]]",
      'version = "^3"',
    ]);
    expect(result.declarations.filter((event) => event.array)).toHaveLength(2);
    expect(plain(result.root)).toEqual({
      tool: {
        poetry: {
          dependencies: {
            Foo_Bar: { source: "owned", version: "^1" },
            "foo-bar": "^9",
            other: [{ version: "^2" }, { version: "^3" }],
          },
        },
      },
    });
  });

  it("decodes complete quoted components while preserving literal dots and backslashes", () => {
    const source = String.raw`["to\u006fl" . 'poetry' . "" . 'docs.prod']
"\u0072equests" . 'ver.sion' = "^1"
'\u0072equests' = "literal"
"equals=hash#key" = "value=#[]{}"
"\U0001F600" = true
`;
    const result = scanTomlMetadata(source);
    expect(result.complete).toBe(true);
    expect(result.declarations.map((event) => event.path)).toEqual([
      ["tool", "poetry", "", "docs.prod"],
      ["tool", "poetry", "", "docs.prod", "requests", "ver.sion"],
      ["tool", "poetry", "", "docs.prod", String.raw`\u0072equests`],
      ["tool", "poetry", "", "docs.prod", "equals=hash#key"],
      ["tool", "poetry", "", "docs.prod", "😀"],
    ]);
  });

  it("consumes multiline/nested values and comments without fabricated events", () => {
    const source = `description = """
[tool.poetry.dependencies]
phantom = '^99'
"""
values = [
 # fake = "x"
 "a=#[]{}", {nested.items = [true, false, {version = '''version = "fake"'''}]},
 ['''
[fake]
key = "x"
'''],
]
real = {version = "^2", markers = 'x == "version = fake"'} # tail
`;
    const result = scanTomlMetadata(source);
    expect(result.complete).toBe(true);
    expect(result.declarations.map((event) => event.path)).toEqual([
      ["description"],
      ["values"],
      ["real"],
    ]);
    expect(plain(result.root.get("real")!)).toEqual({
      version: "^2",
      markers: 'x == "version = fake"',
    });
    expect(result.root.has("fake")).toBe(false);
    expect(result.root.has("tool")).toBe(false);
  });

  it.each([
    "0",
    "-42",
    "+99",
    "1_000",
    "0xdead_beef",
    "0o755",
    "0b10_01",
    "1.2",
    "-2.0e+3",
    "1e-2",
    "inf",
    "+nan",
    "1979-05-27",
    "1979-05-27T07:32:00Z",
    "1979-05-27 07:32:00.999-07:00",
    "07:32:00.1",
  ])("keeps a complete numeric/date atom opaque: %s", (raw) => {
    const result = scanTomlMetadata(`atom = ${raw} # comment\n`);
    expect(result.complete).toBe(true);
    expect(result.root.get("atom")).toEqual({ kind: "opaque", raw });
  });

  it("uses maps for prototype-like keys", () => {
    const result = scanTomlMetadata('__proto__.constructor.prototype = "owned"\n');
    expect(result.complete).toBe(true);
    expect(result.root.get("__proto__")).toBeInstanceOf(Map);
    expect(({} as Record<string, unknown>).owned).toBeUndefined();
  });

  it("permits implicit supertables and correctly attaches nested array tables", () => {
    const source = `[[products]]
name = "first"
[[products.parts]]
name = "part 1"
[[products.parts]]
name = "part 2"
[[products]]
name = "second"
[products.details]
active = true
[a.b.c]
x = 1
[a]
y = false
`;
    const result = scanTomlMetadata(source);
    expect(result.complete).toBe(true);
    expect(plain(result.root)).toEqual({
      products: [
        { name: "first", parts: [{ name: "part 1" }, { name: "part 2" }] },
        { name: "second", details: { active: true } },
      ],
      a: { b: { c: { x: { kind: "opaque", raw: "1" } } }, y: false },
    });
  });

  it.each([
    'a = "unterminated',
    'a = "bad\\q"',
    'a = """unclosed',
    "a = '''unclosed",
    'a = ["x",',
    'a = {version = "x"',
    "a = {x = 1,}",
    "a = {x = 1,\n y = 2}",
    "a = {x = 1 # comment\n}",
    "a = [1 2]",
    "a = 1 2",
    "a = 1 = 2",
    "a = true false",
    "a = [1,,2]",
    'a = {x = "one", x = "two"}',
    'a = {x = {y = "one"}, x.z = "two"}',
    'a = {x = "one"} trailing',
    'a = "one" extra',
    'a = "control\u0001"',
    "a = 1\rbroken = 2",
    "[a",
    "[a]]",
    "[[a]",
    "[a] extra",
    "[a..b]",
    'a..b = "one"',
    'a. = "one"',
    '.a = "one"',
    'é = "one"',
    'a! = "one"',
    '"""key""" = "one"',
    "'''key''' = 'one'",
    '"key\u0001" = "one"',
    '"line\nkey" = "one"',
    '"bad\\q" = "one"',
    '"\\uD800" = "one"',
    '"\\U00110000" = "one"',
    'a = "one"\na.b = "two"',
    'a.b = "one"\n[a]\nx = "two"',
    '[a]\nx = "one"\n[a]\ny = "two"',
    'a = {x = "one"}\n[a]\ny = "two"',
    'a = {x = "one"}\na.y = "two"',
    'a = []\n[[a]]\nx = "two"',
    '[[a]]\nx = "one"\n[a]\ny = "two"',
    '[a]\nx = "one"\n[[a]]\ny = "two"',
    '[a.b]\nx = "one"\n[a]\nb.c = "two"',
    '[[a.b]]\nx = "one"\n[a]\nb.c = "two"',
    '[a.b.c]\nx = "one"\n[a]\nb.d = "two"\n[a.b]\ny = "three"',
  ])("fails closed at malformed structure without later phantom declarations: %s", (invalid) => {
    const source = `control = "owned"\n${invalid}\n[tool.poetry.dependencies]\nphantom = "^99"\n`;
    const result = scanTomlMetadata(source);
    expect(result.complete).toBe(false);
    expect(result.declarations[0].path).toEqual(["control"]);
    expect(result.declarations.some((event) => event.path.includes("phantom"))).toBe(false);
  });

  it("bounds recursive values and dotted components without throwing", () => {
    const nested = `value = ${"[".repeat(140)}"owned"${"]".repeat(140)}`;
    expect(scanTomlMetadata(nested).complete).toBe(false);
    expect(scanTomlMetadata(`${Array(140).fill("x").join(".")} = "owned"`).complete).toBe(false);
  });
});
