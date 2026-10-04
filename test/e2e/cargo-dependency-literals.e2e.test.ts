import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  cargoCli,
  cargoDocumentRows,
  cargoExpectedRows,
  cargoExport,
  cargoFixture,
} from "../helpers/cargo-literal-fixtures.js";

describe("actual Cargo literal declaration exports", () => {
  it("does not fabricate inventory from attributes, arrays, invalid version types or namespaces", async () => {
    const owned = await cargoFixture(
      false,
      '[dependencies]\nattribute.bar="99.0"\nwrong={version=false,path="./owned"}\nalternatives=["98.0","97.0"]\n"not.a.crate"="96.0"\n[package.metadata.dependencies]\nphantom="95.0"\n[workspace.dependencies]\ninherited="94.0"\n'
    );
    try {
      const result = await cargoCli(owned, ["deps", owned.repo, "--json"]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ repo: "local/repo", dependencies: null });
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  });
  it.each([false, true])(
    "retains exact declared names/versions/counts and provenance, mixed=%s",
    async (mixed) => {
      const owned = await cargoFixture(mixed);
      try {
        const expected = cargoExpectedRows(mixed);
        const result = await cargoCli(owned, ["deps", owned.repo, "--json"]);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const deps = JSON.parse(result.stdout);
        expect(deps.totalCount).toBe(expected.runtime.length + expected.dev.length);
        expect(deps.counts).toEqual({
          runtime: expected.runtime.length,
          dev: expected.dev.length,
          peer: 0,
        });
        for (const kind of ["runtime", "dev"] as const)
          expect(deps[kind]).toEqual(
            expected[kind].map(([name, version, ecosystem, sourceFile]) => ({
              name,
              version,
              type: kind,
              ...(mixed ? { ecosystem, sourceFile } : {}),
            }))
          );
        expect(deps.peer).toEqual([]);
        expect(deps.packageManager).toBe(mixed ? "npm" : "cargo");
        if (mixed) expect(deps.packageManagers).toEqual(["npm", "cargo", "pip", "go"]);
        else expect(deps).not.toHaveProperty("packageManagers");
        for (const format of ["markdown", "html", "pdf"] as const) {
          const { doc, summary } = await cargoExport(owned, format);
          const rows = cargoDocumentRows(doc, format === "markdown").filter(
            (row) =>
              row.length === (mixed ? 4 : 2) &&
              !["Type", "Runtime", "Development", "**Total**", "Total", "Package"].includes(row[0])
          );
          expect(rows).toEqual([...expected.runtime, ...expected.dev]);
          expect(summary.deps).toEqual({
            total: expected.runtime.length + expected.dev.length,
            runtime: expected.runtime.length,
            dev: expected.dev.length,
          });
          for (const phantom of [
            "phantom",
            "target_phantom",
            "not_a_package",
            "99.0",
            "98.0",
            "97.0",
          ])
            expect(doc).not.toContain(phantom);
        }
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    }
  );
  it.each([
    '["dependencies"]\n"owned"={"version"="1.0",path="./owned"}',
    "['dependencies'.'owned']\n'version'='1.0'\npath='./owned'",
    'dependencies.owned.path="./owned"\ndependencies.owned.version="1.0"',
    '[dependencies]\nowned.path="./owned"\nowned.version="1.0"',
    '[target."cfg(unix)".dependencies]\n"owned" . "version"="1.0"\nowned.path="./owned"',
  ])("projects equivalent complete syntax without attribute packages: %s", async (source) => {
    const owned = await cargoFixture(false, source);
    try {
      const result = await cargoCli(owned, ["deps", owned.repo, "--json"]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const deps = JSON.parse(result.stdout);
      expect(deps.runtime).toEqual([{ name: "owned", version: "1.0", type: "runtime" }]);
      expect(deps.totalCount).toBe(1);
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  });
});
