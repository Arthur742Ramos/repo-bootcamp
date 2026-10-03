import { describe, expect, it } from "vitest";
import { readTomlString, tomlArrayBodies, tomlArrayStrings } from "../src/toml-string-scan.js";

describe("bounded dependency TOML string scanning", () => {
  it.each([
    [String.raw`"requests; python_version >= \"3.10\""`, 'requests; python_version >= "3.10"'],
    [`'requests; python_version >= "3.10"'`, 'requests; python_version >= "3.10"'],
    [`"""\nrequests; platform_system == "Windows""""`, 'requests; platform_system == "Windows"'],
    [`'''\r\nrequests; platform_system == 'Windows''''`, "requests; platform_system == 'Windows'"],
    [
      String.raw`"\u0072equests\u005Bsecurity\u005D\u003E=2.28\u003B marker"`,
      "requests[security]>=2.28; marker",
    ],
    [String.raw`"\U00000072equests\U0000003E=2.28"`, "requests>=2.28"],
    ['"""requests\\ \n  [security]\\\n\n  >=2.28"""', "requests[security]>=2.28"],
    [String.raw`'\u0072equests'`, String.raw`\u0072equests`],
    ['"""a\r\nb"""', "a\nb"],
    [String.raw`"\b\t\n\f\r\"\\"`, '\b\t\n\f\r"\\'],
    ['"""a""b"""', 'a""b'],
    ['"""a"""""', 'a""'],
  ])("reads complete literal %s", (source, value) => {
    expect(readTomlString(source + ", next", 0)).toEqual({ value, end: source.length });
  });

  it.each([
    '"unterminated',
    '"line\nend"',
    String.raw`"bad\q"`,
    String.raw`"\uD800"`,
    String.raw`"\U00110000"`,
    String.raw`"\u123"`,
    '"""unterminated',
    '"""six""""""',
    '"""bare\rreturn"""',
    "'''bare\rreturn'''",
    '"""fold\\\n\rreturn"""',
    '"control\u007f"',
    '"control\u0001"',
  ])("rejects malformed literal %s", (source) => {
    expect(readTomlString(source, 0)).toBeNull();
    expect(tomlArrayBodies(`dependencies = [${source}, "phantom"]`, "dependencies")).toEqual([]);
  });

  it("ignores quoted metadata, brackets and nested group references", () => {
    const source = `description = 'dependencies = ["metadata"]'\ndependencies = ["requests; platform_system == '[Windows'", "flask", {include-group = "test"}, ["nested"]]\nclassifiers = ["Operating System"]`;
    const bodies = tomlArrayBodies(source, "dependencies");
    expect(bodies).toHaveLength(1);
    expect(tomlArrayStrings(bodies[0])).toEqual([
      "requests; platform_system == '[Windows'",
      "flask",
    ]);
    expect(tomlArrayBodies('dependencies = ["requests",')).toEqual([]);
    expect(tomlArrayStrings('"unterminated \\"phantom')).toEqual([]);
    expect(tomlArrayBodies('"dependencies" = ["requests"]', "dependencies")).toEqual([
      '"requests"',
    ]);
  });
});
