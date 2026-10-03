import { execFileSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect } from "vitest";

import { parseCodeowners, ownersForPath } from "../src/commands/owners-command.js";

describe("parseCodeowners", () => {
  it("parses rules, skipping comments and blank lines", () => {
    const rules = parseCodeowners(
      [
        "# top comment",
        "* @org/maintainers",
        "",
        "/src/ @alice @bob  # inline comment",
        "docs/ carol@example.com",
        "noowner/",
      ].join("\n")
    );
    expect(rules).toEqual([
      { pattern: "*", owners: ["@org/maintainers"] },
      { pattern: "/src/", owners: ["@alice", "@bob"] },
      { pattern: "docs/", owners: ["carol@example.com"] },
      { pattern: "noowner/", owners: [] },
    ]);
  });

  it("skips GitHub's unsupported patterns and invalid owner text", () => {
    expect(parseCodeowners("!docs/ @x\n[ab].ts @x\n\\#file @x\n/docs/ invalid\n")).toEqual([]);
  });
});

describe("ownersForPath", () => {
  const rules = parseCodeowners(["* @default", "/src/ @core", "/src/web/ @web"].join("\n"));

  it("returns the last matching rule's owners (CODEOWNERS semantics)", () => {
    expect(ownersForPath("src", rules)).toEqual(["@core"]);
    expect(ownersForPath("src/web", rules)).toEqual(["@web"]);
    expect(ownersForPath("README.md", rules)).toEqual(["@default"]);
    expect(ownersForPath("docs", rules)).toEqual(["@default"]);
  });

  it("returns [] when no rule matches", () => {
    expect(ownersForPath("src", [{ pattern: "/lib/", owners: ["@x"] }])).toEqual([]);
  });

  it("matches a `/dir/**` glob rule when given a directory path (trailing slash)", () => {
    // Preserve directory-path callers: `/packages/** @team` matches a trailing
    // slash, while the bare directory name has no descendant to match.
    const globRules = parseCodeowners(["* @default", "/packages/** @pkg-team"].join("\n"));
    expect(ownersForPath("packages/", globRules)).toEqual(["@pkg-team"]);
    // Without the trailing slash the `**` rule cannot match a single segment,
    // so it falls back to the default owner.
    expect(ownersForPath("packages", globRules)).toEqual(["@default"]);
  });

  it("still matches bare `/dir` and `dir/` rules for a trailing-slash path", () => {
    const mixed = parseCodeowners(["/docs @docs-team", "src/ @src-team"].join("\n"));
    expect(ownersForPath("docs/", mixed)).toEqual(["@docs-team"]);
    expect(ownersForPath("src/", mixed)).toEqual(["@src-team"]);
  });

  it("allows later ownerless matches to clear ownership", () => {
    const clearing = parseCodeowners("* @default\n/apps/ @apps\n/apps/github\n");
    expect(ownersForPath("apps/github/index.ts", clearing, false)).toEqual([]);
    expect(ownersForPath("apps/other/index.ts", clearing, false)).toEqual(["@apps"]);
    expect(
      ownersForPath(
        "apps/github/index.ts",
        [...clearing, { pattern: "*", owners: ["@last"] }],
        false
      )
    ).toEqual(["@last"]);
  });

  it.each([
    ["docs/*", "docs/guide.md", true],
    ["docs/*", "docs/nested/guide.md", false],
    ["docs/*", "packages/docs/guide.md", false],
    ["/docs/", "docs/nested/guide.md", true],
    ["docs/", "packages/docs/guide.md", true],
    ["**/logs", "logs/output.txt", true],
    ["**/logs", "deep/nested/logs/output.txt", true],
    ["/a/**/b.ts", "a/b.ts", true],
    ["/a/**/b.ts", "a/deep/nested/b.ts", true],
    ["/a/**/b.ts", "nested/a/b.ts", false],
    ["/docs/*/", "docs/sub/guide.md", true],
    ["/docs/*/", "docs/guide.md", false],
    ["/docs/", "docs", false],
    ["*.ts", "SRC/a.ts", true],
    ["/src/", "SRC/a.ts", false],
  ] as const)("matches %s against file %s: %s", (pattern, file, matches) => {
    expect(ownersForPath(file, [{ pattern, owners: ["@owner"] }], false)).toEqual(
      matches ? ["@owner"] : []
    );
  });

  it("agrees with native Git for compatible anchoring, directory, and globstar patterns", async () => {
    const root = await mkdtemp(join(tmpdir(), "bootcamp-codeowners-git-"));
    const paths = [
      "src/a.ts",
      "src/deep/b.ts",
      "nested/src/a.ts",
      "logs/output.txt",
      "deep/logs/output.txt",
      "a/b.ts",
      "a/deep/b.ts",
      "docs/guide.md",
      "docs/sub/guide.md",
    ];
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: root });
      for (const path of paths) {
        await mkdir(join(root, path, ".."), { recursive: true });
        await writeFile(join(root, path), "fixture");
      }
      // GitHub's documented `docs/*` depth differs from Git's directory pruning;
      // its direct-file behavior is covered explicitly above rather than by Git.
      for (const pattern of [
        "*.ts",
        "/src/",
        "src/a.ts",
        "**/logs",
        "/a/**/b.ts",
        "/docs/**",
        "/docs/*/",
      ]) {
        await writeFile(join(root, ".gitignore"), `${pattern}\n`);
        const native = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
          cwd: root,
          input: paths.join("\n") + "\n",
          encoding: "utf-8",
        })
          .trim()
          .split("\n");
        const actual = paths.filter(
          (path) => ownersForPath(path, [{ pattern, owners: ["@owner"] }], false).length > 0
        );
        expect(actual, pattern).toEqual(native);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
