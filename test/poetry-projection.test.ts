import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanTomlMetadata } from "../src/toml-metadata-scan.js";
import { projectPoetryDependencies, POETRY_METADATA_PREFIX } from "../src/poetry-projection.js";
import { extractDependencies, generateDependencyDocs } from "../src/deps.js";
import { markdownToHtml } from "../src/formatter.js";

const fixtures = JSON.parse(
  await readFile(new URL("./fixtures/poetry-projection-oracle.json", import.meta.url), "utf8")
) as {
  name: string;
  toml: string;
  runtime: string[][];
  dev: string[][];
  decision: string | null;
  schemaErrors: string[];
}[];
async function extract(toml: string) {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-poetry-projection-"));
  try {
    await writeFile(join(dir, "pyproject.toml"), toml);
    return await extractDependencies(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("typed Poetry metadata projection", () => {
  it.each(fixtures.filter((f) => !f.decision))(
    "projects normative oracle $name",
    async (fixture) => {
      const deps = await extract(fixture.toml);
      expect(deps?.runtime.map(({ name, version }) => [name, version]) ?? []).toEqual(
        fixture.runtime
      );
      expect(deps?.dev.map(({ name, version }) => [name, version]) ?? []).toEqual(fixture.dev);
    }
  );
  it("serializes every ordered alternative identically across inline, multiline and array tables", async () => {
    const cases = fixtures.filter((f) =>
      ["array-inline", "array-multiline", "array-tables"].includes(f.name)
    );
    const deps = await Promise.all(cases.map((f) => extract(f.toml)));
    for (const value of deps) {
      expect(value?.runtime).toHaveLength(1);
      const record = value!.runtime[0];
      expect(JSON.parse(record.version)).toEqual([
        { version: "^1", python: ">=3.8,<3.10" },
        { version: "^2", python: ">=3.10" },
      ]);
      expect(record.description).toBe(POETRY_METADATA_PREFIX + record.version);
    }
    expect(deps.map((d) => d!.runtime)).toEqual(deps.map(() => deps[0]!.runtime));
  });
  it("retains every origin/marker branch when alternatives have no first version", async () => {
    const fixture = fixtures.find((entry) => entry.name === "array-origin-first")!;
    const deps = await extract(fixture.toml);
    expect(deps?.runtime).toHaveLength(1);
    expect(JSON.parse(deps!.runtime[0].version)).toEqual([
      { url: "https://example.invalid/owned.whl", markers: 'sys_platform == "linux"' },
      { version: "^2", markers: 'sys_platform == "win32"' },
    ]);
    expect(deps!.runtime[0].description).toBe(POETRY_METADATA_PREFIX + deps!.runtime[0].version);
  });
  it("orders nested inline dependency occurrences, not metadata-tree group insertion", () => {
    const doc = scanTomlMetadata(
      'tool.poetry.group = { docs.optional=true, web.dependencies.alpha="^1", docs.dependencies.ALPHA="^9" }'
    );
    expect(doc.complete).toBe(true);
    expect(
      projectPoetryDependencies(doc).dependencies.map(({ name, version }) => [name, version])
    ).toEqual([
      ["alpha", "^1"],
      ["ALPHA", "^9"],
    ]);
  });
  it("supports fully inline semantic namespace containers", () => {
    expect(
      projectPoetryDependencies(scanTomlMetadata('tool={poetry={dependencies={requests="^2"}}}'))
        .dependencies
    ).toEqual([{ name: "requests", version: "^2", type: "runtime" }]);
  });
  it("retains complete origin/marker data without reading fabricated version or package text", async () => {
    const marker =
      '[tool.poetry.dependencies]\nphantom = "^99"\n[x](https://example.invalid) ![y](data:text/html,bad) * | ` ``` \\path <img src=x>';
    const toml = `[tool.poetry.dependencies]\nrequests={source=${JSON.stringify('version = "^99"')},markers=${JSON.stringify(marker)}}\n`;
    const deps = await extract(toml);
    expect(deps?.runtime.map(({ name, version }) => [name, version])).toEqual([["requests", "*"]]);
    const metadata = JSON.stringify({ markers: marker, source: 'version = "^99"' });
    expect(deps!.runtime[0].description).toBe(POETRY_METADATA_PREFIX + metadata);
    const markdown = generateDependencyDocs(deps!, "Owned");
    const html = markdownToHtml(markdown);
    expect(html).toContain("Declared Poetry metadata");
    expect(html).not.toContain("<a href=");
    expect(html).not.toContain("<img ");
    expect(html).toContain("<td><code>*</code></td>");
    expect(html).toContain("[tool.poetry.dependencies]");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toContain("not resolved versions");
  });
  it("retains source/path/git/URL/options fields in descriptions and keeps exact version spacing", async () => {
    const toml = `[tool.poetry.dependencies]\nversioned={version=" >= 1, < 3 ",markers="python_version >= '3.10'",source="owned",extras=["feature"]}\ngitdep={git="https://example.invalid/repo.git",rev="owned"}\nfiledep={file="./owned.whl"}\npathdep={path="./owned",develop=true}\nurldep={url="https://example.invalid/a.whl;param#hash",optional=true}\noptions={source="owned"}\nempty={}\n`;
    const deps = await extract(toml);
    expect(deps?.totalCount).toBe(7);
    expect(deps?.runtime[0].version).toBe(" >= 1, < 3 ");
    expect(deps?.runtime.slice(1).map((d) => d.version)).toEqual(Array(6).fill("*"));
    for (const record of deps!.runtime)
      expect(() =>
        JSON.parse(record.description!.slice(POETRY_METADATA_PREFIX.length))
      ).not.toThrow();
    expect(markdownToHtml(generateDependencyDocs(deps!, "Owned"))).toContain(
      "<code> &gt;= 1, &lt; 3 </code>"
    );
  });
  it("invalid objects never reserve canonical identity and malformed namespaces cannot invent packages", async () => {
    const deps = await extract(
      '[tool.poetry.dependencies]\nFoo_Bar.bar="^99"\nFoo_Bar.version="^1"\nfoo-bar="^9"\nunknown={bar="^99"}\nwrong={version=false}\n'
    );
    expect(deps?.runtime).toEqual([{ name: "foo-bar", version: "^9", type: "runtime" }]);
    expect(await extract('"tool.poetry".dependencies.requests="^2"')).toBeNull();
    expect(
      await extract('[tool.poetry.dependencies]\nrequests="unterminated\nphantom="^99"')
    ).toBeNull();
  });
  it("bounds literal delimiter scanning without an argument-spread failure", async () => {
    const source = Array(140000).fill("`x").join("");
    const deps = await extract(
      `[tool.poetry.dependencies]\nrequests={source=${JSON.stringify(source)}}`
    );
    const html = markdownToHtml(generateDependencyDocs(deps!, "Owned"));
    expect(html).toContain(source);
    expect(html).not.toContain("<a ");
  });
});
