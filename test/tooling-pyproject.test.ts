import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractDependencies } from "../src/deps.js";
import { scanTomlMetadata } from "../src/toml-metadata-scan.js";
import { isToolingOnlyPyproject } from "../src/tooling-pyproject.js";

const admitted = [
  "[tool.ruff]\nline-length=88\n",
  '["tool"."ruff"]\n"line-length"=88\n',
  "tool.ruff.line-length=88\n",
  "tool={ruff={line-length=88,enabled=true,ignore=['E501']}}\n",
  "[tool]\n",
  "tool={}\n",
  "[tool.pytest.ini_options]\naddopts='-q'\n",
  '[tool.ruff]\ndescription="[project] dependencies=[\\\"phantom\\\"]"\n',
  '[tool.ruff]\nproject={dependencies=["not-owned"],dynamic=["dependencies"]}\n',
  "[[tool.ruff.rules]]\nname='first'\n[[tool.ruff.rules]]\nname='second'\n",
  '[tool.ruff."日本語"]\nlabel="café 🧪"\n',
  "[tool.mypy]\nstrict=true\n[tool.coverage.run]\nbranch=true\n",
  "[tool.ruff]\nvalues=[true,false,{nested=[1,2.5,'safe']}]\n",
  "[tool.ruff]\nvalue=9223372036854775807\n",
  "[tool.ruff]\nvalue=-9223372036854775808\n",
  "[tool.ruff]\nvalue=0x7fff_ffff_ffff_ffff\n",
  "[tool.ruff]\nvalue=0o777777777777777777777\n",
  "[tool.ruff]\nvalue=0b111111111111111111111111111111111111111111111111111111111111111\n",
  "[tool.ruff]\nvalues=[1.5,1e99,+inf,-inf,nan]\n",
  "[tool.ruff]\nvalue=2000-02-29\n",
  "[tool.ruff]\nvalue=2024-02-29T23:59:59.123Z\n",
  "[tool.ruff]\nvalue=2024-02-29t23:59:59+23:59\n",
  "[tool.ruff]\nvalue=12:34:56.123456\n",
];
const authoritative = [
  "",
  "# empty metadata\n",
  "[project]\n",
  "[project]\ndependencies=[]\n",
  "[project]\ndynamic=['dependencies']\n",
  "[project]\ndependencies=['fastapi>=1']\n",
  "project={dependencies=[]}\n",
  "project.dependencies=[]\n",
  "[project.optional-dependencies]\n",
  "[dependency-groups]\n",
  "dependency-groups={}\n",
  "[build-system]\nrequires=[]\n",
  "[tool.poetry]\n",
  "[tool.poetry.dependencies]\n",
  "tool.poetry={}\n",
  "[tool]\npoetry=false\n",
  "[tool.ruff]\nline-length=88\n[project]\ndependencies=[]\n",
  "[tool.ruff]\nline-length=88\n[other]\nvalue=true\n",
  "tool=[]\n",
  "tool='not-a-table'\n",
  '[tool."poetry.dependencies"]\nname="literal-unknown-tool-name"\n',
  "[tool.unknown]\nsetting=true\n",
  "[tool.uv]\ndev-dependencies=['pytest>=8']\n",
  "[tool.uv.sources]\nrequests={path='owned-origin'}\n",
  "[tool.pdm.dev-dependencies]\ntest=['pytest>=8']\n",
  "[tool.hatch.envs.default]\ndependencies=['httpx']\n",
  "[tool.setuptools.dynamic]\ndependencies={file=['requirements.txt']}\n",
  "[tool.rye]\ndev-dependencies=[]\n",
  "[tool.ruff]\nline-length=88\n[tool.uv]\n",
  "[tool]\nruff=false\n",
  "[[tool.ruff]]\nline-length=88\n",
];
const rejected = [
  "[tool.ruff\nline-length=88\n",
  "[tool.ruff]\nline-length=88 garbage\n",
  "[tool.ruff]\nline-length=88\nline-length=99\n",
  "[tool.ruff]\nline-length=88\n[tool.ruff]\n",
  "[tool.ruff]\ntext='unterminated\n",
  '[tool.ruff]\ntext="\\q"\n',
  "[tool.ruff]\nvalue=08\n",
  "[tool.ruff]\nvalue=2024-13-01\n",
  "[tool.ruff]\nvalue=2024-02-30\n",
  "[tool.ruff]\nvalue=1900-02-29\n",
  "[tool.ruff]\nvalue=0000-01-01\n",
  "[tool.ruff]\nvalue=2024-01-01T24:00:00Z\n",
  "[tool.ruff]\nvalue=2024-01-01T12:60:00Z\n",
  "[tool.ruff]\nvalue=2024-01-01T12:00:60Z\n",
  "[tool.ruff]\nvalue=2024-01-01T12:00:00+24:00\n",
  "[tool.ruff]\nvalue=2024-01-01T12:00:00+00:60\n",
  "[tool.ruff]\nvalue=24:00:00\n",
  "[tool.ruff]\nvalue=12:60:00\n",
  "[tool.ruff]\nvalue=12:00:60\n",
  "[tool.ruff]\nvalue=9223372036854775808\n",
  "[tool.ruff]\nvalue=-9223372036854775809\n",
  "[tool.ruff]\nvalue=0xffffffffffffffff\n",
  "[tool.ruff]\nvalue=0o1777777777777777777777\n",
  "[tool.ruff]\nvalue=0b1111111111111111111111111111111111111111111111111111111111111111\n",
];

describe("conservative non-owning Python tool metadata", () => {
  it.each(admitted)("admits structurally complete supported tooling: %s", (content) => {
    expect(isToolingOnlyPyproject(scanTomlMetadata(content))).toBe(true);
  });
  it.each([...authoritative, ...rejected])(
    "preserves owned/unsupported metadata: %s",
    (content) => {
      expect(isToolingOnlyPyproject(scanTomlMetadata(content))).toBe(false);
    }
  );
  it("rejects a huge integer without constructing a BigInt or inventing ownership", () => {
    const content = `[tool.ruff]\nvalue=${"9".repeat(100_000)}\n`;
    expect(isToolingOnlyPyproject(scanTomlMetadata(content))).toBe(false);
  });
  it("falls back to the existing root parser and preserves its literal admission conventions", async () => {
    const root = await mkdtemp(join(tmpdir(), "bootcamp-tool-only-unit-"));
    const requirements =
      "requests==2.31.0\n-r ignored.txt\n--index-url https://index.invalid\nowned/local\n./local\narchive.whl\nrequests==9\nname[extra]>=1; python_version<'4'\n";
    try {
      await writeFile(join(root, "pyproject.toml"), admitted[0]);
      await writeFile(join(root, "requirements.txt"), requirements);
      expect(await extractDependencies(root)).toEqual({
        packageManager: "pip",
        totalCount: 3,
        runtime: [
          { name: "requests", version: "2.31.0", type: "runtime" },
          { name: "requests", version: "9", type: "runtime" },
          { name: "name", version: "1", type: "runtime" },
        ],
        dev: [],
        peer: [],
        categories: [],
      });
      expect(await readFile(join(root, "requirements.txt"), "utf8")).toBe(requirements);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each(authoritative)(
    "does not replace declared/empty/dynamic precedence: %s",
    async (content) => {
      const root = await mkdtemp(join(tmpdir(), "bootcamp-tool-owned-unit-"));
      try {
        await writeFile(join(root, "pyproject.toml"), content);
        await writeFile(join(root, "requirements.txt"), "fallback-must-not-appear==9\n");
        const deps = await extractDependencies(root);
        expect(deps?.runtime.some((dep) => dep.name === "fallback-must-not-appear") ?? false).toBe(
          false
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );
  it("retains mixed-ecosystem source provenance for the selected requirements file", async () => {
    const root = await mkdtemp(join(tmpdir(), "bootcamp-tool-mixed-unit-"));
    try {
      await writeFile(join(root, "pyproject.toml"), admitted[0]);
      await writeFile(join(root, "requirements.txt"), "requests==2.31.0\n");
      await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { zod: "^4" } }));
      expect((await extractDependencies(root))?.runtime).toEqual([
        {
          name: "zod",
          version: "^4",
          type: "runtime",
          ecosystem: "node",
          sourceFile: "package.json",
        },
        {
          name: "requests",
          version: "2.31.0",
          type: "runtime",
          ecosystem: "python",
          sourceFile: "requirements.txt",
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
