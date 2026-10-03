import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractDependencies } from "../src/deps.js";

async function extract(manifest: string, mixed = false) {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-python-literals-"));
  try {
    await writeFile(join(dir, "pyproject.toml"), manifest);
    if (mixed)
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { express: "^5.0.0" } })
      );
    return await extractDependencies(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("Python requirement literal projection", () => {
  it.each([
    String.raw`"requests[security]>=2.28; python_version >= \"3.10\" and platform_system == \"Windows\""`,
    `'requests[security]>=2.28; python_version >= "3.10" and platform_system == "Windows"'`,
    `"""requests[security]>=2.28; python_version >= "3.10" and platform_system == "Windows""""`,
    `'''requests[security]>=2.28; python_version >= '3.10' and platform_system == 'Windows''''`,
    String.raw`"\u0072equests\u005Bsecurity\u005D\u003E=2.28\u003B python_version >= \"3.10\""`,
    String.raw`"\U00000072equests\U0000003E=2.28\U0000003B python_version >= \"3.10\""`,
    `"""\nrequests\\\n  [security]\\\n  >=2.28; sys_platform in 'win32,cygwin'"""`,
    `"requests>=2.28; platform_system == ']Windows'"`,
    `"requests>=2.28; platform_system == '[Windows'"`,
  ])("projects complete decoded requirement %s", async (literal) => {
    const deps = await extract(
      `[project]\ndependencies = [${literal}, "flask>=2.0", "requests>=9"]\nclassifiers = ["Operating System :: OS Independent"]`
    );
    expect(deps?.totalCount).toBe(2);
    expect(deps?.runtime).toEqual([
      { name: "requests", version: ">=2.28", type: "runtime" },
      { name: "flask", version: ">=2.0", type: "runtime" },
    ]);
  });

  it("preserves optional/dev groups, mixed provenance and order", async () => {
    const deps = await extract(
      String.raw`[project]
description = 'dependencies = ["metadata>=99"]'
dependencies = ["requests>=2.28; python_version >= \"3.10\" and platform_system == \"Windows\""]
[project.optional-dependencies]
web = ['flask>=2.0; platform_system == "[Windows"']
[dependency-groups]
test = ["pytest>=8; python_version >= \"3.10\"", {include-group = "another"}]
another = []
`,
      true
    );
    expect(deps?.totalCount).toBe(4);
    expect(deps?.runtime).toEqual([
      {
        name: "express",
        version: "^5.0.0",
        type: "runtime",
        ecosystem: "node",
        sourceFile: "package.json",
      },
      {
        name: "requests",
        version: ">=2.28",
        type: "runtime",
        ecosystem: "python",
        sourceFile: "pyproject.toml",
      },
      {
        name: "flask",
        version: ">=2.0",
        type: "runtime",
        ecosystem: "python",
        sourceFile: "pyproject.toml",
      },
    ]);
    expect(deps?.dev).toEqual([
      {
        name: "pytest",
        version: ">=8",
        type: "dev",
        ecosystem: "python",
        sourceFile: "pyproject.toml",
      },
    ]);
  });

  it.each([
    String.raw`'\u0072equests>=2.28'`,
    String.raw`"requests\q; python_version >= \"3.10\""`,
    '"requests; unclosed',
    '"""requests>=2.28;\rmarker"""',
    '"""requests\\\n\r>=2.28"""',
  ])("does not fabricate names from invalid/unterminated literals %s", async (literal) => {
    expect(await extract(`[project]\ndependencies = [${literal}]`)).toBeNull();
  });
});
