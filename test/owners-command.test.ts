import { describe, it, expect } from "vitest";

import { parseCodeowners, ownersForPath } from "../src/commands/owners-command.js";

describe("parseCodeowners", () => {
  it("parses rules, skipping comments and blank lines", () => {
    const rules = parseCodeowners(
      ["# top comment", "* @org/maintainers", "", "/src/ @alice @bob  # inline comment", "docs/ carol@example.com", "noowner/"].join("\n")
    );
    expect(rules).toEqual([
      { pattern: "*", owners: ["@org/maintainers"] },
      { pattern: "/src/", owners: ["@alice", "@bob"] },
      { pattern: "docs/", owners: ["carol@example.com"] },
    ]);
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
    // The owners command resolves each area against `${dir}/` so the common
    // `/packages/** @team` idiom matches. A bare dir name does not.
    const globRules = parseCodeowners(["* @default", "/packages/** @pkg-team"].join("\n"));
    expect(ownersForPath("packages/", globRules)).toEqual(["@pkg-team"]);
    // Without the trailing slash the `**` rule cannot match a single segment,
    // so it falls back to the default owner — this is the bug the command fix avoids.
    expect(ownersForPath("packages", globRules)).toEqual(["@default"]);
  });

  it("still matches bare `/dir` and `dir/` rules for a trailing-slash path", () => {
    const mixed = parseCodeowners(["/docs @docs-team", "src/ @src-team"].join("\n"));
    expect(ownersForPath("docs/", mixed)).toEqual(["@docs-team"]);
    expect(ownersForPath("src/", mixed)).toEqual(["@src-team"]);
  });
});
