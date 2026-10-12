// Run after build. All installation and configuration work stays in a fresh
// temporary fixture; no global package, provider, or credential setup is used.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const npmEntry = process.env.npm_execpath;
assert(npmEntry, "Run this check through npm run verify:runtime");
const fixture = mkdtempSync(join(tmpdir(), "bootcamp-packed-runtime-"));
const installation = join(fixture, "install");
const env = { ...process.env, npm_config_cache: join(fixture, "npm-cache") };
const npm = (args, cwd = repo) =>
  execFileSync(process.execPath, [npmEntry, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 180_000,
  });

try {
  const packed = JSON.parse(
    npm(["pack", "--ignore-scripts", "--json", "--pack-destination", fixture])
  );
  const tarball = resolve(fixture, packed[0].filename);
  mkdirSync(installation);
  writeFileSync(
    join(installation, "package.json"),
    JSON.stringify({ private: true, type: "module" })
  );
  npm(
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--engine-strict",
      "--no-audit",
      "--no-fund",
      "--fetch-retries=0",
      "--fetch-timeout=30000",
      tarball,
    ],
    installation
  );
  const installed = join(installation, "node_modules", "repo-bootcamp");
  const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.equal(pkg.engines.node, "^22.18.0 || >=24.0.0");
  const cli = (...args) =>
    execFileSync(process.execPath, [join(installed, "dist", "cli.js"), ...args], {
      cwd: installation,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
  assert.match(cli("--version"), new RegExp(pkg.version.replaceAll(".", "\\.")));
  assert.match(cli("--help"), /bootcamp/);
  const selected = join(fixture, "repo");
  mkdirSync(selected);
  writeFileSync(
    join(selected, "package.json"),
    JSON.stringify({ dependencies: { fixture: "1.2.3" } })
  );
  assert.equal(JSON.parse(cli("deps", selected, "--json")).runtime[0].name, "fixture");
  const config = join(fixture, "bootcamp.config.json");
  const tsConfig = join(fixture, "bootcamp.config.ts");
  writeFileSync(config, JSON.stringify({ defaults: { style: "minimal" } }));
  writeFileSync(tsConfig, 'export default { defaults: { style: "startup" } };\n');
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import * as api from 'repo-bootcamp';
    import { loadConfig } from 'repo-bootcamp/plugins';
    assert.equal(typeof api.analyzeRepo, 'function');
    assert.equal(typeof api.runParallelAnalysis, 'function');
    assert.equal((await loadConfig(${JSON.stringify(config)}))?.defaults?.style, 'minimal');
    assert.equal((await loadConfig(${JSON.stringify(tsConfig)}))?.defaults?.style, 'startup');
  `,
    ],
    { cwd: installation, env, encoding: "utf8", timeout: 30_000 }
  );
  console.log(
    `Packed runtime smoke passed on ${process.version}: CLI, API, JSON and TypeScript configuration.`
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
