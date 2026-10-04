import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  cargoFixture,
  cargoCli as goCli,
  cargoExport as goExport,
  cargoDocumentRows as goDocumentRows,
} from "./cargo-literal-fixtures.js";

// Reuse the tested per-process owned HOME/cache/temp and saved-response runner.
// The non-mixed fixture removes Cargo entirely; no Go tool or origin is called.
export { goCli, goExport, goDocumentRows };
export const goLiteralManifest = String.raw`module example.invalid/main
go 1.22
require example.invalid/shared v1.2.3
require "example.invalid/owned" v2.0.0
require example.invalid/quoted_version "v3.0.0"
require (
 "example.invalid/\u0065scaped" "v4\x2e0.0"// indirect
 "example.invalid/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "v5.0.0"
 example.invalid/after_comment v6.0.0 // note (123)
 "example.invalid/shared" v9.9.9 // retain first
)
// require example.invalid/phantom v99.0.0
exclude example.invalid/excluded v98.0.0
replace (
 example.invalid/replaced v97.0.0 => ./owned
)
`;
export const goRuntime = [
  ["example.invalid/shared", "v1.2.3"],
  ["example.invalid/owned", "v2.0.0"],
  ["example.invalid/quoted_version", "v3.0.0"],
  ["example.invalid/escaped", "v4.0.0"],
  ["example.invalid/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "v5.0.0"],
  ["example.invalid/after_comment", "v6.0.0"],
];
export function goExpectedRows(mixed: boolean) {
  return {
    runtime: mixed
      ? [
          ["serde", "^20", "node", "package.json"],
          ["serde", "3", "rust", "Cargo.toml"],
          ["serde", ">=30", "python", "pyproject.toml"],
          ...goRuntime.map((row) => [...row, "go", "go.mod"]),
        ]
      : goRuntime,
    dev: mixed ? [["node-dev", "^21", "node", "package.json"]] : [],
  };
}
export async function goFixture(mixed: boolean, manifest = goLiteralManifest) {
  const owned = await cargoFixture(mixed, '[dependencies]\nserde="3"');
  if (!mixed) await rm(join(owned.repo, "Cargo.toml"));
  await writeFile(join(owned.repo, "go.mod"), manifest);
  return owned;
}
export async function goDocuments(mixed: boolean) {
  const owned = await goFixture(mixed);
  try {
    return {
      html: (await goExport(owned, "html")).doc,
      pdf: (await goExport(owned, "pdf")).doc,
    };
  } finally {
    await rm(owned.base, { recursive: true, force: true });
  }
}
