import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  expectedLocalInventory,
  expectedLocalTables,
  htmlTables,
  localReferenceCli,
  localReferenceConfigurations,
  localReferenceExport,
  localReferenceFixture,
  ownedProcess,
  rejectedLocalNames,
  type LocalReferenceConfig,
} from "../helpers/root-local-references.js";

function strictDocument(doc: string, config: LocalReferenceConfig, markdown: boolean) {
  const expected = expectedLocalTables(config, markdown);
  const inventory = expectedLocalInventory(config);
  const total = inventory.runtime.length + inventory.dev.length + inventory.peer.length;
  if (markdown) {
    expect(
      doc
        .split("## Summary\n")[1]
        ?.split("\n## ")[0]
        .split("\n")
        .filter((line) => line.startsWith("|"))
    ).toEqual([
      "| Type | Count |",
      "|------|-------|",
      `| Runtime | ${inventory.runtime.length} |`,
      `| Development | ${inventory.dev.length} |`,
      ...(inventory.peer.length ? [`| Peer | ${inventory.peer.length} |`] : []),
      `| **Total** | **${total}** |`,
    ]);
    for (const table of expected) {
      const heading =
        table.kind === "runtime"
          ? "Runtime Dependencies"
          : table.kind === "dev"
            ? "Development Dependencies"
            : "Peer Dependencies";
      const wire = doc
        .split(`## ${heading}\n`)[1]
        ?.split("\n## ")[0]
        .split("\n")
        .filter((line) => line.startsWith("|"));
      expect(wire).toEqual([
        `| ${table.headers.join(" | ")} |`,
        config.mixed ? "|---------|---------|-----------|----------|" : "|---------|---------|",
        ...table.rows.map((row) =>
          row[0] === "..." && config.mixed ? `| ... | ${row[1]} | | |` : `| ${row.join(" | ")} |`
        ),
      ]);
    }
    if (!inventory.dev.length) expect(doc).toContain("No development dependencies found.");
    if (!inventory.peer.length) expect(doc).not.toContain("## Peer Dependencies");
  } else {
    // Every table is accounted for: summary plus exact complete package tables.
    expect(htmlTables(doc)).toEqual([
      {
        headers: ["Type", "Count"],
        rows: [
          ["Runtime", String(inventory.runtime.length)],
          ["Development", String(inventory.dev.length)],
          ...(inventory.peer.length ? [["Peer", String(inventory.peer.length)]] : []),
          ["Total", String(total)],
        ],
      },
      ...expected.map(({ headers, rows }) => ({ headers, rows })),
    ]);
  }
  for (const phantom of [
    "local-origin-dependency",
    "owned-local-origin",
    "outside_scope_package",
    "constraint_scope_package",
  ])
    expect(doc).not.toContain(phantom);
}
function exactJson(config: LocalReferenceConfig) {
  const inventory = expectedLocalInventory(config);
  return {
    repo: "local/repo",
    packageManager: config.mixed ? "npm" : "pip",
    ...(config.mixed ? { packageManagers: ["npm", "cargo", "pip", "go"] } : {}),
    totalCount: inventory.runtime.length + inventory.dev.length + inventory.peer.length,
    counts: {
      runtime: inventory.runtime.length,
      dev: inventory.dev.length,
      peer: inventory.peer.length,
    },
    ...inventory,
    categories: [],
  };
}

describe("actual bounded root local-reference admission exports", () => {
  it.each(localReferenceConfigurations)(
    "keeps exact named metadata and rejects unnamed origins, mixed=$mixed pyproject=$pyproject capped=$capped",
    async (config) => {
      const owned = await localReferenceFixture(config);
      try {
        expect(owned.windowsMode).toBe(
          process.platform === "win32"
            ? "actual owned Windows drive path"
            : "lexical Windows drive-string negative"
        );
        if (process.platform === "win32") {
          expect(owned.windowsOrigin).toMatch(/^[A-Za-z]:[\\/]/);
          expect(await readFile(join(owned.windowsOrigin, "pyproject.toml"), "utf8")).toContain(
            'name="owned-local-origin"'
          );
        }
        for (const target of [
          join(owned.repo, "owned", "local"),
          join(owned.repo, "plain-project"),
        ])
          expect(await readFile(join(target, "pyproject.toml"), "utf8")).toContain(
            'build-backend="setuptools.build_meta"'
          );
        const wheel = await readFile(owned.wheel);
        expect(wheel.readUInt32LE(0)).toBe(0x04034b50);
        expect(wheel.readUInt32LE(wheel.length - 22)).toBe(0x06054b50);
        expect((await readFile(owned.source)).subarray(0, 3)).toEqual(
          Buffer.from([0x1f, 0x8b, 0x08])
        );

        const expected = exactJson(config);
        const { result, processOwner } = await localReferenceCli(owned, [
          "deps",
          owned.repo,
          "--json",
        ]);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const deps = JSON.parse(result.stdout);
        expect(deps).toEqual(expected);
        // The preload guards reads/stats/enumeration/existence checks of actual
        // owned origins and includes. Zero log confirms they were not probed.
        await expect(
          readFile(join(processOwner.home, "origin-access.jsonl"))
        ).rejects.toMatchObject({ code: "ENOENT" });
        const names = deps.runtime.map((dep: { name: string }) => dep.name);
        for (const phantom of rejectedLocalNames) expect(names).not.toContain(phantom);
        if (config.pyproject) expect(names).not.toContain("envliteral");
        const { result: diagram, processOwner: diagramOwner } = await localReferenceCli(owned, [
          "deps",
          owned.repo,
          "--diagram",
        ]);
        expect(diagram.status, diagram.stdout + diagram.stderr).toBe(0);
        await expect(
          readFile(join(diagramOwner.home, "origin-access.jsonl"))
        ).rejects.toMatchObject({ code: "ENOENT" });
        const labels = [...diagram.stdout.matchAll(/^    \w+\["([^"\n]*)"\]$/gm)].map(
          (match) => match[1]
        );
        const expectedLabels = (["runtime", "dev", "peer"] as const).flatMap((kind) => {
          const cap = kind === "runtime" ? 10 : 8;
          const list = expected[kind];
          return [
            ...list
              .slice(0, cap)
              .map((dep) => (config.mixed ? `${dep.name} (${dep.ecosystem})` : dep.name)),
            ...(list.length > cap ? [`+${list.length - cap} more`] : []),
          ];
        });
        expect(labels).toEqual(expectedLabels);
        let completeFacts: unknown;
        for (const format of ["markdown", "html", "pdf"] as const) {
          const exported = await localReferenceExport(owned, format);
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
          if (completeFacts === undefined) completeFacts = exported.facts;
          else expect(exported.facts).toEqual(completeFacts);
        }
        for (const { path, bytes } of owned.untouched) expect(await readFile(path)).toEqual(bytes);
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    },
    180_000
  );

  it("regenerates a two-process synthetic stale v9 deps entry without changing other phase filenames or bytes", async () => {
    const config = { mixed: false };
    const owned = await localReferenceFixture(config, true);
    try {
      const first = await localReferenceExport(owned, "markdown", undefined, true);
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
      const v9 = filename("deps", "|projection=mixed-ecosystems-v9-pip-logical-lines");
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
        totalCount: 4,
        runtime: [
          { name: "owned", version: "/local", type: "runtime" },
          { name: "C", version: ":\\owned\\local", type: "runtime" },
          { name: "owned-1.0-py3-none-any.whl", version: "*", type: "runtime" },
          { name: "owned-source-1.0.tar.gz", version: "*", type: "runtime" },
        ],
        dev: [],
        peer: [],
        categories: [],
      };
      const stale = JSON.stringify(entry, null, 2);
      await writeFile(join(second.cache, v9), stale);
      await expect(readFile(join(second.cache, current))).rejects.toMatchObject({ code: "ENOENT" });
      const regenerated = await localReferenceExport(owned, "markdown", second, true);
      strictDocument(regenerated.doc, config, true);
      expect(regenerated.facts).toEqual(first.facts);
      expect(regenerated.summary.deps).toEqual(first.summary.deps);
      expect(JSON.parse(await readFile(join(second.cache, current), "utf8")).value).toEqual({
        packageManager: "pip",
        totalCount: exactJson(config).totalCount,
        ...expectedLocalInventory(config),
        categories: [],
      });
      expect(await readFile(join(second.cache, v9), "utf8")).toBe(stale);
      for (const other of retained)
        expect(await readFile(join(second.cache, other.file), "utf8")).toBe(other.text);
      expect((await readdir(second.cache)).filter((file) => file.endsWith(".json")).sort()).toEqual(
        [v9, current, ...retained.map(({ file }) => file)].sort()
      );
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  }, 180_000);
});
