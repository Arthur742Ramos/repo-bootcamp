import { describe, expect, it } from "vitest";
import { generateDependencyDocs, type DependencyAnalysis } from "../src/deps.js";
import { markdownToHtml } from "../src/formatter.js";
import { POETRY_METADATA_PREFIX } from "../src/poetry-projection.js";

const decode = (value: string) =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const inventory = (version: string): DependencyAnalysis => ({
  packageManager: "npm",
  totalCount: 1,
  runtime: [{ name: "owned-case", version, type: "runtime" }],
  dev: [],
  peer: [],
  categories: [],
});
const row = (html: string) =>
  [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].find((match) =>
    match[1].includes("<td>owned-case</td>")
  )![1];

describe("literal declared-version display", () => {
  it.each([
    "file:packages/[alpha](target)",
    "file:packages/read`me",
    "file:packages/``wide``",
    "file:packages/[click](javascript:alert(1))",
    "file:packages/![image](https://example.invalid/image.png)",
    "file:packages/<img src=x onerror=alert(1)>",
    "file:packages/<123@example.invalid>",
    "file:packages/<?xml?>",
    "file:packages/<!--owned-->",
    "file:packages/*emphasis*",
    "*.*",
    "file:packages/***",
    "file:packages/*****",
    "***",
    "file:packages/_name_",
    "file:packages/~~name~~",
    String.raw`file:packages/a\|b`,
    String.raw`file:packages/a\\|b`,
    String.raw`file:packages/\[name\](target)`,
    "file:packages/a|b",
    "file:packages/café-🚀",
    "git+https://example.invalid/owned.git#read`me",
    ">=1.0.0 <2.0.0",
    " ^1.2.3 ",
    "\u00a0^1.2.3\u00a0",
    "   ",
    "javascript:alert(1)",
    "data:text/html,plain-data",
    "file:packages/&copy;",
  ])("preserves declaration as literal text without changing metadata: %s", (version) => {
    const deps = inventory(version);
    const before = JSON.stringify(deps);
    const markdown = generateDependencyDocs(deps, "Owned");
    const html = markdownToHtml(markdown);
    const ownedRow = row(html);
    expect(
      [...ownedRow.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => decode(match[1]))
    ).toEqual(["owned-case", version]);
    expect(ownedRow).not.toMatch(/<(?:a|img|script|iframe|em|strong)\b/);
    expect(JSON.stringify(deps)).toBe(before);
    expect(markdown).toContain("| Runtime | 1 |");
  });
  it.each([
    "file:packages/line\nname",
    "file:packages/tab\tname",
    "file:packages/carriage\rname",
    "file:packages/DEL\u007fname",
    "file:packages/\ud800",
    "file:packages/\udc00",
  ])(
    "shows controls and malformed UTF-16 reversibly rather than normalizing data: %s",
    (version) => {
      const deps = inventory(version);
      const before = JSON.stringify(deps);
      const html = markdownToHtml(generateDependencyDocs(deps, "Owned"));
      const payload = row(html).match(/<code>([\s\S]*?)<\/code>/)![1];
      const notation = decode(payload);
      expect(JSON.parse(notation)).toBe(version);
      expect(notation).toBe(JSON.stringify(version).replace(/\u007f/g, "\\u007f"));
      expect(html).not.toContain("\ufffd");
      expect(JSON.stringify(deps)).toBe(before);
    }
  );
  it.each([
    "^1.2.3",
    "*",
    "**",
    "1.*",
    "~1.2.3",
    "v1.2.3",
    ">=1.2.3",
    ">=2,<3",
    "2.28,<3",
    "( >= 5, < 6 )",
    "file:packages/<3>",
    "^1.0.0 || ^2.0.0",
    "file:packages/plain",
  ])("keeps plain legacy declaration markup stable: %s", (version) => {
    const markdown = generateDependencyDocs(inventory(version), "Owned");
    expect(markdown).toContain(`| owned-case | ${version.replace(/\|/g, "\\|")} |`);
    expect(row(markdownToHtml(markdown))).not.toContain("<code>");
  });
  it("preserves complete Poetry metadata and applies literal display across all displayed kinds", () => {
    const deps = inventory("file:packages/[runtime](target)");
    deps.packageManagers = ["npm", "pip"];
    deps.runtime[0].ecosystem = "node";
    deps.runtime[0].sourceFile = "package.json";
    deps.dev = [
      {
        name: "owned-dev",
        version: "file:packages/read`me",
        type: "dev",
        ecosystem: "node",
        sourceFile: "package.json",
      },
    ];
    deps.peer = [
      {
        name: "owned-peer",
        version: "file:packages/[peer](target)",
        type: "peer",
        ecosystem: "node",
        sourceFile: "package.json",
      },
    ];
    deps.runtime.push({
      name: "poetry-owned",
      version: "*",
      type: "runtime",
      ecosystem: "python",
      sourceFile: "pyproject.toml",
      description:
        POETRY_METADATA_PREFIX +
        JSON.stringify({ path: "./owned/[source](target)", markers: "python_version >= '3.10'" }),
    });
    deps.totalCount = 4;
    const before = JSON.stringify(deps);
    const html = markdownToHtml(generateDependencyDocs(deps, "Owned"));
    expect(html).toContain("<code>file:packages/[runtime](target)</code>");
    expect(html).toContain("<code>file:packages/read`me</code>");
    expect(html).toContain("<code>file:packages/[peer](target)</code>");
    expect(html).toContain("Declared Poetry metadata");
    expect(html).toContain("not resolved versions");
    expect(decode(html)).toContain(
      JSON.stringify({ path: "./owned/[source](target)", markers: "python_version >= '3.10'" })
    );
    expect(html).not.toContain("<a href=");
    expect(JSON.stringify(deps)).toBe(before);
  });
  it("does not expand the existing runtime, development or peer display caps", () => {
    const deps = inventory("^1");
    deps.packageManagers = ["npm", "pip"];
    for (const [kind, size, cap] of [
      ["runtime", 51, 50],
      ["dev", 31, 30],
      ["peer", 31, 30],
    ] as const) {
      deps[kind] = Array.from({ length: size }, (_, index) => ({
        name: `owned-${kind}-${index}`,
        version: `file:packages/[${index}](target)`,
        type: kind,
        ecosystem: "node",
        sourceFile: "package.json",
      }));
      expect(generateDependencyDocs(deps, "Owned")).toContain(`| owned-${kind}-${cap - 1} |`);
      expect(generateDependencyDocs(deps, "Owned")).not.toContain(`| owned-${kind}-${cap} |`);
    }
  });
});
