import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authoritativePyprojects,
  htmlTables,
  observeRootRequirements,
  ownedProcess,
  toolingCli,
  toolingConfigurations,
  toolingExport,
  toolingFixture,
  toolingInventory,
  toolingJson,
  toolingTables,
  type ToolingConfig,
} from "../helpers/tooling-pyproject-fixtures.js";
import { rejectedLocalNames } from "../helpers/root-local-references.js";

function strictDocument(doc: string, config: ToolingConfig, markdown: boolean) {
  const inventory = toolingInventory(config);
  const total = inventory.runtime.length + inventory.dev.length + inventory.peer.length;
  const summary = [
    ["Runtime", String(inventory.runtime.length)],
    ["Development", String(inventory.dev.length)],
    ...(inventory.peer.length ? [["Peer", String(inventory.peer.length)]] : []),
    ["Total", String(total)],
  ];
  const tables = toolingTables(config, markdown);
  if (!markdown) {
    expect(htmlTables(doc)).toEqual([
      { headers: ["Type", "Count"], rows: summary },
      ...tables.map(({ headers, rows }) => ({ headers, rows })),
    ]);
  } else {
    const wire = (heading: string) =>
      doc
        .split(`## ${heading}\n`)[1]
        ?.split("\n## ")[0]
        .split("\n")
        .filter((line) => line.startsWith("|"));
    expect(wire("Summary")).toEqual([
      "| Type | Count |",
      "|------|-------|",
      ...summary.slice(0, -1).map((row) => `| ${row.join(" | ")} |`),
      `| **Total** | **${total}** |`,
    ]);
    for (const table of tables) {
      const heading =
        table.kind === "runtime"
          ? "Runtime Dependencies"
          : table.kind === "dev"
            ? "Development Dependencies"
            : "Peer Dependencies";
      expect(wire(heading)).toEqual([
        `| ${table.headers.join(" | ")} |`,
        config.mixed ? "|---------|---------|-----------|----------|" : "|---------|---------|",
        ...table.rows.map((row) =>
          row[0] === "..." && config.mixed ? `| ... | ${row[1]} | | |` : `| ${row.join(" | ")} |`
        ),
      ]);
    }
    if (!inventory.dev.length) expect(doc).toContain("No development dependencies found.");
    if (!inventory.peer.length) expect(doc).not.toContain("## Peer Dependencies");
  }
  expect(doc).not.toContain("string-owned-phantom");
  expect(doc).not.toContain("metadata-phantom");
  expect(doc).not.toContain("owned-local-origin");
}

describe("actual tooling-only pyproject fallback exports", () => {
  it.each(toolingConfigurations)(
    "preserves exact requirements rows and equivalent metadata for $id",
    async (config) => {
      const owned = await toolingFixture(config);
      try {
        const expected = toolingJson(config);
        const { result, processOwner } = await toolingCli(owned, ["deps", owned.repo, "--json"]);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const deps = JSON.parse(result.stdout);
        expect(deps).toEqual(expected);
        await expect(
          readFile(join(processOwner.home, "origin-access.jsonl"))
        ).rejects.toMatchObject({ code: "ENOENT" });
        for (const name of rejectedLocalNames)
          expect(deps.runtime.map((dep: { name: string }) => dep.name)).not.toContain(name);
        let previousFacts: unknown;
        for (const format of ["markdown", "html", "pdf"] as const) {
          const exported = await toolingExport(owned, format);
          strictDocument(exported.doc, config, format === "markdown");
          expect(exported.summary.deps).toEqual({
            total: expected.totalCount,
            runtime: expected.runtime.length,
            dev: expected.dev.length,
          });
          for (const field of [
            "repoName",
            "purpose",
            "description",
            "confidence",
            "sources",
            "structure",
            "architecture",
            "contrib",
            "ci",
            "firstTasks",
            "runbook",
          ] as const)
            expect(exported.facts[field]).toEqual(owned.facts[field]);
          if (previousFacts === undefined) previousFacts = exported.facts;
          else expect(exported.facts).toEqual(previousFacts);
        }
        for (const { path, bytes } of owned.untouched) expect(await readFile(path)).toEqual(bytes);
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    },
    180_000
  );

  it.each(authoritativePyprojects)(
    "retains authoritative/null behavior instead of merging root requirements: $id",
    async (entry) => {
      const config = { ...toolingConfigurations[0], toml: entry.toml };
      const owned = await toolingFixture(config);
      try {
        await observeRootRequirements(owned);
        const { result, processOwner } = await toolingCli(owned, ["deps", owned.repo, "--json"]);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const runtime = (entry.rows ?? []).map(([name, version]) => ({
          name,
          version,
          type: "runtime",
        }));
        const dev = (entry.dev ?? []).map(([name, version]) => ({ name, version, type: "dev" }));
        const totalCount = runtime.length + dev.length;
        expect(JSON.parse(result.stdout)).toEqual(
          totalCount
            ? {
                repo: "local/repo",
                packageManager: "pip",
                totalCount,
                counts: { runtime: runtime.length, dev: dev.length, peer: 0 },
                runtime,
                dev,
                peer: [],
                categories: [],
              }
            : { repo: "local/repo", dependencies: null }
        );
        await expect(
          readFile(join(processOwner.home, "root-requirement-access.jsonl"))
        ).rejects.toMatchObject({ code: "ENOENT" });
        for (const { path, bytes } of owned.untouched) expect(await readFile(path)).toEqual(bytes);
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    }
  );

  it.each(["missing", "empty", "directives-only"])(
    "does not invent a fallback inventory when root requirements are %s",
    async (control) => {
      const owned = await toolingFixture(toolingConfigurations[0]);
      try {
        const path = join(owned.repo, "requirements.txt");
        if (control === "missing") await rm(path);
        else
          await writeFile(
            path,
            control === "empty"
              ? ""
              : "-r ignored-requirements.txt\n./editable-owned\ngit+https://example.invalid/owned.git\n"
          );
        const { result, processOwner } = await toolingCli(owned, ["deps", owned.repo, "--json"]);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ repo: "local/repo", dependencies: null });
        await expect(
          readFile(join(processOwner.home, "origin-access.jsonl"))
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    }
  );

  it("hits current v11 deps, misses synthetic null v10, and preserves all other phase identities and bytes", async () => {
    const config = toolingConfigurations[0];
    const owned = await toolingFixture(config, true);
    try {
      const first = await toolingExport(owned, "markdown", undefined, true);
      strictDocument(first.doc, config, true);
      const entries = await Promise.all(
        (await readdir(first.owner.cache))
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
      const filename = (phase: string, projection = "") =>
        `${entry.repoFullName.replace(/\//g, "-")}${phase === "facts" ? "" : "-" + phase}-${createHash(
          "sha256"
        )
          .update(baseSeed + (phase === "facts" ? "" : "|phase=" + phase) + projection)
          .digest("hex")
          .slice(0, 16)}.json`;
      const current = filename(
        "deps",
        "|projection=mixed-ecosystems-v11-tooling-pyproject-fallback"
      );
      const v10 = filename("deps", "|projection=mixed-ecosystems-v10-root-local-references");
      expect(deps!.file).toBe(current);
      expect(entry.value).toEqual({
        packageManager: "pip",
        totalCount: 1,
        ...toolingInventory(config),
        categories: [],
      });
      const hit = await toolingExport(owned, "markdown", first.owner, true);
      expect(hit.doc).toBe(first.doc);
      expect(hit.facts).toEqual(first.facts);
      for (const other of entries)
        expect(await readFile(join(first.owner.cache, other.file), "utf8")).toBe(other.text);

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
      entry.value = null;
      const stale = JSON.stringify(entry, null, 2);
      await writeFile(join(second.cache, v10), stale);
      await expect(readFile(join(second.cache, current))).rejects.toMatchObject({ code: "ENOENT" });
      const regenerated = await toolingExport(owned, "markdown", second, true);
      strictDocument(regenerated.doc, config, true);
      expect(regenerated.facts).toEqual(first.facts);
      expect(regenerated.summary.deps).toEqual(first.summary.deps);
      expect(JSON.parse(await readFile(join(second.cache, current), "utf8")).value).toEqual({
        packageManager: "pip",
        totalCount: 1,
        ...toolingInventory(config),
        categories: [],
      });
      expect(await readFile(join(second.cache, v10), "utf8")).toBe(stale);
      for (const other of retained)
        expect(await readFile(join(second.cache, other.file), "utf8")).toBe(other.text);
      expect((await readdir(second.cache)).filter((file) => file.endsWith(".json")).sort()).toEqual(
        [v10, current, ...retained.map(({ file }) => file)].sort()
      );
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  }, 180_000);
});
