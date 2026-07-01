// Packaging invariants guard for repo-bootcamp.
//
// This project ships as a pure-ESM package (all runtime deps and the bin are
// ESM). A previous, broken CommonJS build shipped `require()` of ESM-only deps
// (chalk@5, ora@9), which throws ERR_REQUIRE_ESM on much of the supported Node
// range. That build has been removed; these assertions keep it from silently
// creeping back and keep the toolchain metadata (lint, engines, types, .nvmrc)
// self-consistent. Run via `npm run verify:packaging`; it is also wired into
// the CI build job and the release gate so a regression fails loudly.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8");

const pkg = JSON.parse(read("package.json"));
const errors = [];
const check = (cond, message) => {
  if (!cond) errors.push(message);
};

// Extract the first integer from a version-ish string ("20", ">=20.0.0" -> 20).
const majorOf = (value) => {
  const match = /(\d+)/.exec(String(value ?? ""));
  return match ? Number(match[1]) : null;
};

// --- ESM-only exports: no CommonJS `require` condition, no dist/cjs target. ---
const exportsJson = JSON.stringify(pkg.exports ?? {});
check(pkg.type === "module", `package.json "type" must be "module", got ${pkg.type}`);
check(
  !exportsJson.includes("dist/cjs"),
  "package.json exports must not reference dist/cjs (CJS build was dropped)"
);
const requireConditions = [];
const walk = (node, path) => {
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "require") requireConditions.push(`${path}.${key}`);
      walk(value, `${path}.${key}`);
    }
  }
};
walk(pkg.exports ?? {}, "exports");
check(
  requireConditions.length === 0,
  `package.json exports must not declare a "require" condition; found: ${requireConditions.join(", ")}`
);

// --- Build scripts must not resurrect the CJS pipeline. ---
const scripts = pkg.scripts ?? {};
check(!("build:cjs" in scripts), 'the "build:cjs" script must not exist');
check(!/build:cjs/.test(scripts.build ?? ""), 'the "build" script must not invoke build:cjs');
check(
  !/dist\/cjs/.test(scripts.build ?? "") && !/dist\/cjs/.test(scripts["copy:data"] ?? ""),
  "build/copy:data scripts must not create a dist/cjs tree"
);
check(
  !existsSync(new URL("../scripts/build-cjs.mjs", import.meta.url)),
  "scripts/build-cjs.mjs must be deleted (orphaned CJS build)"
);
check(
  !existsSync(new URL("../tsconfig.build.cjs.json", import.meta.url)),
  "tsconfig.build.cjs.json must be deleted (orphaned CJS build config)"
);

// --- Lint must fail on warnings so 'warn' severity is enforced in CI. ---
check(
  /--max-warnings[= ]0/.test(scripts.lint ?? ""),
  'the "lint" script must pass --max-warnings=0'
);

// --- @types/node must not be OLDER than the minimum supported engine. It may
// float AHEAD (dependabot manages it), so this is a floor, not an exact match. ---
const enginesFloor = majorOf(pkg.engines?.node);
check(enginesFloor !== null && enginesFloor >= 20, "engines.node floor must be >= 20");
const typesNodeMajor = majorOf(pkg.devDependencies?.["@types/node"]);
check(
  typesNodeMajor !== null && typesNodeMajor >= enginesFloor,
  `@types/node major (${typesNodeMajor}) must be >= engines.node floor (${enginesFloor})`
);

// --- .nvmrc must name a supported line, matching engines/CI (not EOL Node 18). ---
const nvmrcMajor = majorOf(read(".nvmrc").trim());
check(
  nvmrcMajor !== null && nvmrcMajor >= enginesFloor,
  `.nvmrc (${nvmrcMajor}) must be >= engines.node floor (${enginesFloor})`
);

if (errors.length > 0) {
  console.error("Packaging invariants failed:");
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(
  `Packaging invariants OK (${repoRoot}): ESM-only, lint/types/engines/.nvmrc consistent.`
);
