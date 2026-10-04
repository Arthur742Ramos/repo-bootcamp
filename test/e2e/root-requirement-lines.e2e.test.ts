import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  expectedInventory,
  expectedTables,
  htmlTables,
  ownedProcess,
  rejectedNames,
  requirementCli,
  requirementConfigurations,
  requirementExport,
  requirementFixture,
} from "../helpers/root-requirement-lines.js";

function markdownPackageRows(doc: string, kind: "runtime" | "dev" | "peer") {
  const heading =
    kind === "runtime"
      ? "Runtime Dependencies"
      : kind === "dev"
        ? "Development Dependencies"
        : "Peer Dependencies";
  return doc
    .split(`## ${heading}\n`)[1]
    ?.split("\n## ")[0]
    .split("\n")
    .filter((line) => line.startsWith("|"));
}
function strictDocument(
  doc: string,
  config: (typeof requirementConfigurations)[number],
  markdown: boolean
) {
  const expected = expectedTables(config, markdown);
  if (markdown) {
    for (const table of expected) {
      const wire = markdownPackageRows(doc, table.kind);
      expect(wire).toEqual([
        `| ${table.headers.join(" | ")} |`,
        config.mixed ? "|---------|---------|-----------|----------|" : "|---------|---------|",
        ...table.rows.map((row) => `| ${row.join(" | ")} |`),
      ]);
    }
  } else
    expect(htmlTables(doc).filter((table) => table.headers[0] === "Package")).toEqual(
      expected.map(({ headers, rows }) => ({ headers, rows }))
    );
}
describe("actual bounded root requirements logical-line exports", () => {
  it.each(requirementConfigurations)(
    "joins root declarations without includes/expansion, mixed=$mixed ending=$ending pyproject=$pyproject",
    async (config) => {
      const owned = await requirementFixture(config);
      try {
        const original = await readFile(join(owned.repo, "requirements.txt"), "utf8");
        const expected = expectedInventory(config);
        const total = expected.runtime.length + expected.dev.length + expected.peer.length;
        const { result } = await requirementCli(owned, ["deps", owned.repo, "--json"]);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const deps = JSON.parse(result.stdout);
        for (const kind of ["runtime", "dev", "peer"] as const)
          expect(deps[kind]).toEqual(expected[kind]);
        expect(deps.counts).toEqual({
          runtime: expected.runtime.length,
          dev: expected.dev.length,
          peer: expected.peer.length,
        });
        expect(deps.totalCount).toBe(total);
        expect(deps.packageManager).toBe(config.mixed ? "npm" : "pip");
        if (config.mixed) expect(deps.packageManagers).toEqual(["npm", "cargo", "pip", "go"]);
        else expect(deps).not.toHaveProperty("packageManagers");
        const names = deps.runtime.map((dep: { name: string }) => dep.name);
        for (const name of rejectedNames) expect(names).not.toContain(name);
        if (config.pyproject) expect(names).not.toContain("envliteral");
        for (const format of ["markdown", "html", "pdf"] as const) {
          const exported = await requirementExport(owned, format);
          strictDocument(exported.doc, config, format === "markdown");
          expect(exported.summary.deps).toEqual({
            total,
            runtime: expected.runtime.length,
            dev: expected.dev.length,
          });
          expect(exported.facts.structure).toEqual(owned.facts.structure);
          expect(exported.facts.sources).toEqual(owned.facts.sources);
        }
        expect(await readFile(join(owned.repo, "requirements.txt"), "utf8")).toBe(original);
        expect(await readFile(join(owned.repo, "ignored-requirements.txt"), "utf8")).toBe(
          "outside_scope_package==99\n"
        );
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    },
    120_000
  );

  it("misses owned synthetic v8 deps while preserving every other phase cache identity", async () => {
    const config = { mixed: false, ending: "\n" as const };
    const owned = await requirementFixture(config, undefined, true);
    try {
      const first = await requirementExport(owned, "markdown", undefined, true);
      strictDocument(first.doc, config, true);
      const files = await readdir(first.owner.cache);
      const entries = await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map(async (file) => ({
            file,
            text: await readFile(join(first.owner.cache, file), "utf8"),
          }))
      );
      const deps = entries.find(({ text }) => JSON.parse(text).phase === "deps");
      expect(deps).toBeDefined();
      const entry = JSON.parse(deps!.text);
      const options = entry.generationOptions;
      const fingerprint = JSON.stringify([
        options.focus,
        options.style,
        options.model,
        options.audience,
        options.maxFiles,
        options.subdir,
        options.exclude,
        options.scanFingerprint,
      ]);
      const baseSeed =
        `${entry.repoFullName}@${entry.commitSha}` +
        (fingerprint === JSON.stringify(["", "", "", "", null, "", [], ""])
          ? ""
          : "|" + fingerprint);
      const name = entry.repoFullName.replace(/\//g, "-");
      const filename = (phase: string, projection = "") =>
        `${name}${phase === "facts" ? "" : "-" + phase}-${createHash("sha256")
          .update(baseSeed + (phase === "facts" ? "" : "|phase=" + phase) + projection)
          .digest("hex")
          .slice(0, 16)}.json`;
      const v8 = filename("deps", "|projection=mixed-ecosystems-v8-go-literals");
      const current = filename(
        "deps",
        "|projection=mixed-ecosystems-v11-tooling-pyproject-fallback"
      );
      expect(deps!.file).toBe(current);
      const second = await ownedProcess(owned);
      expect(second.home).not.toBe(first.owner.home);
      await mkdir(second.cache, { recursive: true });
      const retained = entries.filter(({ text }) => JSON.parse(text).phase !== "deps");
      expect(retained.map(({ text }) => JSON.parse(text).phase).sort()).toEqual([
        "cycles",
        "facts",
        "impact",
        "security",
      ]);
      for (const other of retained) {
        expect(other.file).toBe(filename(JSON.parse(other.text).phase));
        await writeFile(join(second.cache, other.file), other.text);
      }
      entry.value = {
        packageManager: "pip",
        totalCount: 3,
        runtime: [
          { name: "wheels", version: "*", type: "runtime" },
          { name: "ignored-requirements.txt", version: "*", type: "runtime" },
          { name: "requests", version: "2.28,\\", type: "runtime" },
        ],
        dev: [],
        peer: [],
        categories: [],
      };
      const stale = JSON.stringify(entry, null, 2);
      await writeFile(join(second.cache, v8), stale);
      await expect(readFile(join(second.cache, current))).rejects.toMatchObject({ code: "ENOENT" });
      const regenerated = await requirementExport(owned, "markdown", second, true);
      strictDocument(regenerated.doc, config, true);
      expect(JSON.parse(await readFile(join(second.cache, current), "utf8")).value.runtime).toEqual(
        expectedInventory(config).runtime
      );
      expect(await readFile(join(second.cache, v8), "utf8")).toBe(stale);
      for (const other of retained)
        expect(await readFile(join(second.cache, other.file), "utf8")).toBe(other.text);
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  }, 120_000);
});
