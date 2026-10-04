import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  configurations,
  declarations,
  declarationCli,
  declarationExport,
  declarationFixture,
  expectedInventory,
  expectedTables,
  htmlTables,
  poetryMetadata,
} from "../helpers/declared-version-display.js";

describe("actual literal declared-version exports", () => {
  it.each(configurations)(
    "retains exact declaration data and existing display limits, mixed=$mixed capped=$capped",
    async (config) => {
      const owned = await declarationFixture(config);
      try {
        const expected = expectedInventory(config);
        const total = expected.runtime.length + expected.dev.length + expected.peer.length;
        const before = await readFile(join(owned.repo, "package.json"), "utf8");
        for (const declaration of Object.values(declarations(config)).flat()) {
          if (!declaration.target) continue;
          expect(
            JSON.parse(await readFile(join(owned.repo, declaration.target, "package.json"), "utf8"))
          ).toEqual({ name: declaration.name, version: "1.0.0" });
        }
        const result = await declarationCli(owned, ["deps", owned.repo, "--json"]);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const deps = JSON.parse(result.stdout);
        for (const kind of ["runtime", "dev", "peer"] as const)
          expect(deps[kind]).toEqual(expected[kind]);
        expect(deps.totalCount).toBe(total);
        expect(deps.counts).toEqual({
          runtime: expected.runtime.length,
          dev: expected.dev.length,
          peer: expected.peer.length,
        });
        expect(deps.packageManager).toBe("npm");
        if (config.mixed) expect(deps.packageManagers).toEqual(["npm", "cargo", "poetry", "go"]);
        else expect(deps).not.toHaveProperty("packageManagers");
        for (const format of ["markdown", "html", "pdf"] as const) {
          const { doc, summary, facts } = await declarationExport(owned, format);
          expect(facts.sources).toEqual(owned.facts.sources);
          expect(facts.structure).toEqual(owned.facts.structure);
          expect(facts.architecture).toEqual(owned.facts.architecture);
          expect(facts.description).toBe(owned.facts.description);
          expect(summary.deps).toEqual({
            total,
            runtime: expected.runtime.length,
            dev: expected.dev.length,
          });
          const tables = expectedTables(config, format === "markdown");
          if (format === "markdown") {
            for (const table of tables) {
              const heading =
                table.kind === "runtime"
                  ? "Runtime Dependencies"
                  : table.kind === "dev"
                    ? "Development Dependencies"
                    : "Peer Dependencies";
              const section = doc.split(`## ${heading}\n`)[1]?.split("\n## ")[0];
              expect(section).toBeDefined();
              const rows = section!.split("\n").filter((line) => line.startsWith("|"));
              expect(rows[0]).toBe(`| ${table.headers.join(" | ")} |`);
              expect(rows[1]).toBe(
                config.mixed
                  ? "|---------|---------|-----------|----------|"
                  : "|---------|---------|"
              );
              // Compare wire rows, including exact code fences, payload whitespace,
              // table pipe escapes and reversible malformed/control notation.
              expect(rows.slice(2)).toEqual(
                table.rows.map((row) =>
                  row[0] === "..." && config.mixed
                    ? `| ... | ${row[1]} | | |`
                    : `| ${row.join(" | ")} |`
                )
              );
            }
            if (!config.mixed) expect(doc).not.toContain("## Peer Dependencies");
          } else {
            const packages = htmlTables(doc).filter((table) => table.headers[0] === "Package");
            for (const [tableIndex, table] of tables.entries()) {
              for (const row of packages[tableIndex].rows) {
                const declaration = declarations(config)[table.kind].find(
                  (item) => item.name === row[0]
                );
                if (declaration?.display === "notation")
                  expect(JSON.parse(row[1])).toBe(declaration.value);
              }
            }
            expect(packages).toEqual(tables.map(({ headers, rows }) => ({ headers, rows })));
            const metadata = htmlTables(doc).filter((table) => table.headers[0] === "Dependency");
            if (config.mixed && !config.capped)
              expect(metadata).toEqual([
                {
                  headers: ["Dependency", "Kind", "Declaration", "Ecosystem", "Manifest"],
                  rows: [
                    [
                      "poetry-control",
                      "runtime",
                      JSON.stringify(poetryMetadata),
                      "python",
                      "pyproject.toml",
                    ],
                  ],
                },
              ]);
            else expect(metadata).toEqual([]);
          }
        }
        expect(await readFile(join(owned.repo, "package.json"), "utf8")).toBe(before);
        expect(JSON.parse(before)).toEqual(owned.packageJson);
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    },
    120_000
  );
});
