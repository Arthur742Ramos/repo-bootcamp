import { describe, expect, it } from "vitest";

import { createZipArchive } from "../src/web/zip.js";

describe("createZipArchive", () => {
  it("creates a portable archive containing each generated file", () => {
    const archive = createZipArchive([
      { name: "BOOTCAMP.md", content: Buffer.from("# Bootcamp\n", "utf8") },
      { name: "repo_facts.json", content: Buffer.from('{"ok":true}', "utf8") },
    ]);

    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);
    expect(archive.toString("utf8")).toContain("BOOTCAMP.md");
    expect(archive.toString("utf8")).toContain("repo_facts.json");
    expect(archive.toString("utf8")).toContain("# Bootcamp");
    expect(archive.toString("utf8")).toContain('{"ok":true}');
  });

  it("supports an empty kit", () => {
    const archive = createZipArchive([]);
    expect(archive.readUInt32LE(0)).toBe(0x06054b50);
    expect(archive.length).toBe(22);
  });
});
