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
});
