// Exercise the compiled CLI both directly and through an npm-style executable
// symlink. Checking only process exit status misses a silently inert entrypoint.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "dist", "cli.js");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const temp = mkdtempSync(join(tmpdir(), "bootcamp-cli-entry-"));
try {
  const link = join(temp, "bootcamp.mjs");
  symlinkSync(cli, link);
  for (const entry of [cli, link]) {
    const run = (...args) => execFileSync(process.execPath, [entry, ...args], { encoding: "utf8" });
    assert.equal(run("--version").trim(), version);
    assert.match(run("--help"), /Usage: bootcamp/);
  }
  console.log("Compiled CLI responds through direct and symlink entry points.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
