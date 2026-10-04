import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  cargoFixture,
  cargoCli,
  cargoExport,
  cargoDocumentRows,
} from "../helpers/cargo-literal-fixtures.js";

describe("actual indexed Cargo inventory", () => {
  it("retains complete large JSON counts/order and existing export caps", async () => {
    const count = 4000;
    const source =
      '[package]\nname="owned-index"\nversion="1.0.0"\nedition="2021"\n[dependencies]\n' +
      Array.from({ length: count }, (_, i) => `owned_${i}="1.0"`).join("\n");
    const owned = await cargoFixture(false, source);
    try {
      const result = await cargoCli(owned, ["deps", owned.repo, "--json"]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const deps = JSON.parse(result.stdout);
      expect(deps.totalCount).toBe(count);
      expect(deps.counts).toEqual({ runtime: count, dev: 0, peer: 0 });
      expect(deps.runtime).toEqual(
        Array.from({ length: count }, (_, i) => ({
          name: `owned_${i}`,
          version: "1.0",
          type: "runtime",
        }))
      );
      for (const format of ["markdown", "html", "pdf"] as const) {
        const { doc, summary } = await cargoExport(owned, format);
        const rows = cargoDocumentRows(doc, format === "markdown").filter(
          (row) =>
            row.length === 2 &&
            !["Type", "Runtime", "Development", "**Total**", "Total", "Package"].includes(row[0])
        );
        expect(rows).toEqual([
          ...Array.from({ length: 50 }, (_, i) => [`owned_${i}`, "1.0"]),
          ["...", `+${count - 50} more`],
        ]);
        expect(summary.deps).toEqual({ total: count, runtime: count, dev: 0 });
        expect(rows.some(([name]) => name === "owned_50")).toBe(false);
      }
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  });
});
