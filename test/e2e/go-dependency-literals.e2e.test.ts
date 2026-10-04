import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  goCli,
  goFixture,
  goExport,
  goExpectedRows,
  goDocumentRows,
} from "../helpers/go-literal-fixtures.js";

describe("actual Go require literal exports", () => {
  it.each([false, true])(
    "keeps exact declared inventory, first slots and exports, mixed=%s",
    async (mixed) => {
      const owned = await goFixture(mixed);
      try {
        const rows = goExpectedRows(mixed);
        const result = await goCli(owned, ["deps", owned.repo, "--json"]);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const deps = JSON.parse(result.stdout);
        expect(deps.totalCount).toBe(rows.runtime.length + rows.dev.length);
        expect(deps.counts).toEqual({
          runtime: rows.runtime.length,
          dev: rows.dev.length,
          peer: 0,
        });
        for (const kind of ["runtime", "dev"] as const)
          expect(deps[kind]).toEqual(
            rows[kind].map(([name, version, ecosystem, sourceFile]) => ({
              name,
              version,
              type: kind,
              ...(mixed ? { ecosystem, sourceFile } : {}),
            }))
          );
        expect(deps.peer).toEqual([]);
        expect(deps.packageManager).toBe(mixed ? "npm" : "go");
        if (mixed) expect(deps.packageManagers).toEqual(["npm", "cargo", "pip", "go"]);
        else expect(deps).not.toHaveProperty("packageManagers");
        for (const format of ["markdown", "html", "pdf"] as const) {
          const { doc, summary } = await goExport(owned, format);
          const data = goDocumentRows(doc, format === "markdown").filter(
            (row) =>
              row.length === (mixed ? 4 : 2) &&
              !["Type", "Runtime", "Development", "**Total**", "Total", "Package"].includes(row[0])
          );
          expect(data).toEqual([...rows.runtime, ...rows.dev]);
          expect(summary.deps).toEqual({
            total: rows.runtime.length + rows.dev.length,
            runtime: rows.runtime.length,
            dev: rows.dev.length,
          });
          for (const phantom of [
            "example.invalid/phantom",
            "example.invalid/excluded",
            "example.invalid/replaced",
            "v99.0.0",
            "v98.0.0",
            "v97.0.0",
            "v9.9.9",
          ])
            expect(doc).not.toContain(phantom);
        }
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    }
  );
  it.each([
    'require "example.invalid/owned" v1.2.3',
    'require example.invalid/owned "v1.2.3"',
    String.raw`require "example.invalid/\x6fwned" "v1\0562.3"`,
    'require (// comment (123)\n"example.invalid/owned" "v1.2.3"// indirect\n)',
  ])("projects equivalent valid double-quoted token syntax: %s", async (directive) => {
    const owned = await goFixture(false, `module example.invalid/main\ngo 1.22\n${directive}\n`);
    try {
      const result = await goCli(owned, ["deps", owned.repo, "--json"]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const deps = JSON.parse(result.stdout);
      expect(deps.runtime).toEqual([
        { name: "example.invalid/owned", version: "v1.2.3", type: "runtime" },
      ]);
      expect(deps.totalCount).toBe(1);
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  });
  it.each([
    "require `example.invalid/phantom` v9.9.9",
    String.raw`require "example.invalid/\wphantom" v9.9.9`,
    "require (\nexample.invalid/phantom v9.9.9",
  ])("does not coin dependencies from unsupported/malformed syntax: %s", async (directive) => {
    const owned = await goFixture(false, `module example.invalid/main\ngo 1.22\n${directive}\n`);
    try {
      const result = await goCli(owned, ["deps", owned.repo, "--json"]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ repo: "local/repo", dependencies: null });
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  });
});
