import { describe, expect, it } from "vitest";
import { projectCargoDependencies } from "../src/cargo-projection.js";
import { scanTomlMetadata } from "../src/toml-metadata-scan.js";
import { naiveCargoProjection } from "./helpers/cargo-naive-projection.js";
import { cargoLiteralToml } from "./helpers/cargo-literal-fixtures.js";

function same(source: string) {
  const document = scanTomlMetadata(source);
  expect(projectCargoDependencies(document)).toEqual(naiveCargoProjection(document));
  return document;
}
describe("Cargo source-offset occurrence index", () => {
  it.each([
    cargoLiteralToml,
    '[dependencies.owned]\nversion="1"\n[dependencies]\nnext="2"',
    'dependencies={owned={path="./owned",version="1"}, next="2"}',
    '[target."".dependencies]\nowned="1"\n[dependencies]\nowned="2"\n[target."null".dependencies]\nowned="3"',
    '[target."a.b".dev-dependencies]\nconstructor.version="1"\n[target.a.build-dependencies]\n__proto__.version="2"',
    '[dependencies]\ncafé={version="1"}\n工具="2"\n[package.metadata.dependencies]\nphantom="3"',
    '[dependencies]\nwrong={version=false,path="./owned"}\nalternatives=["1","2"]\nfeatures={optional=true}\nowned={workspace=true}',
    '[dependencies]\nowned="1"\nowned="2"',
    '[dependencies]\nowned="1"\n[',
  ])("retains the exact pre-index declared projection: %s", (source) => {
    same(source);
  });
  it("preserves a zero source offset and first occurrence before nested version fields", () => {
    const source =
      '[dependencies.owned]\npath="version = fake"\nversion="1"\n[target."cfg(unix)".dependencies]\nowned="2"\n[dependencies]\nnext="3"';
    const document = same(source);
    expect(document.occurrences[0].offset).toBe(0);
    expect(projectCargoDependencies(document)).toEqual([
      { section: "dependencies", name: "owned", version: "1" },
      { section: "dependencies", name: "owned", version: "2" },
      { section: "dependencies", name: "next", version: "3" },
    ]);
  });
  it("keeps long target strings in one scope without joined-key collisions", () => {
    const target = 'cfg(feature="' + "a".repeat(4096) + '")';
    const source = `[target.${JSON.stringify(target)}.dependencies]\nowned="1"\n[target.${JSON.stringify(target)}.dev-dependencies]\nowned="2"\n[dependencies]\nowned="3"`;
    const document = same(source);
    expect(document.complete).toBe(true);
    expect(projectCargoDependencies(document)).toHaveLength(3);
  });
  it("matches the previous lookup over deterministic namespace/value permutations", () => {
    const kinds = ["dependencies", "dev-dependencies", "build-dependencies"];
    const scopes = [null, "", "null", 'cfg(target_arch="x86")', "a.b"];
    for (let seed = 0; seed < 48; seed++) {
      const groups: string[] = [];
      for (const [scopeIndex, scope] of scopes.entries()) {
        for (const [kindIndex, kind] of kinds.entries()) {
          const header = scope === null ? [kind] : ["target", scope, kind];
          const lines = [`[${header.map((part) => JSON.stringify(part)).join(".")}]`];
          for (let i = 0; i < 12; i++) {
            const name = [
              "__proto__",
              "constructor",
              "café",
              "工具",
              ...Array.from({ length: 8 }, (_, n) => `owned_${n}`),
            ][i];
            const version = `${seed}.${scopeIndex}.${kindIndex}.${i}`;
            const values = [
              JSON.stringify(version),
              `{version=${JSON.stringify(version)},path='version = "fake"'}`,
              '{path="./owned"}',
              "{workspace=true}",
              '{version=false,path="./owned"}',
              '["fake","versions"]',
            ];
            lines.push(
              `${JSON.stringify(name)}=${values[(seed + scopeIndex + kindIndex + i) % values.length]}`
            );
          }
          groups.push(lines.join("\n"));
        }
      }
      const ordered = [
        ...groups.slice(seed % groups.length),
        ...groups.slice(0, seed % groups.length),
      ];
      const source =
        ordered.join("\n") + '\n[package.metadata]\ntext="""[dependencies]\\nphantom=\\"99\\""""\n';
      const document = same(source);
      expect(document.complete).toBe(true);
      expect(projectCargoDependencies(document).length).toBeGreaterThan(100);
    }
  });
  it("projects a large inventory with exactly one occurrence traversal and no repeated find", () => {
    const count = 16000;
    const source =
      "[dependencies]\n" + Array.from({ length: count }, (_, i) => `owned_${i}="1.0"`).join("\n");
    const document = scanTomlMetadata(source);
    expect(document.complete).toBe(true);
    let visits = 0;
    const occurrences = new Proxy(document.occurrences, {
      get(target, property, receiver) {
        if (property === "find")
          return () => {
            throw new Error("repeated occurrence find");
          };
        if (property === Symbol.iterator)
          return function* () {
            for (const entry of target) {
              visits++;
              yield entry;
            }
          };
        return Reflect.get(target, property, receiver);
      },
    });
    const input = { ...document, occurrences };
    expect(() => naiveCargoProjection(input)).toThrow("repeated occurrence find");
    const projected = projectCargoDependencies(input);
    expect(visits).toBe(document.occurrences.length);
    expect(projected).toHaveLength(count);
    expect(projected.map(({ name, version, section }) => [name, version, section])).toEqual(
      Array.from({ length: count }, (_, i) => [`owned_${i}`, "1.0", "dependencies"])
    );
  });
});
