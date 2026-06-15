import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  analyzeCLIDrift,
  analyzeFrameworkDocs,
  analyzeVersionMismatches,
} from "../src/docs-analyzer.js";

const dirs: string[] = [];

async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-docs-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    await writeFile(join(dir, rel), content, "utf-8");
  }
  return dir;
}

describe("docs-analyzer correctness", () => {
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("does not flag a Corepack packageManager integrity hash as a version mismatch", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({ name: "x", packageManager: "pnpm@8.6.0+sha512.abcdef" }),
      "README.md": "# X\n\nRequires pnpm 8.6.0 to build.\n",
    });
    const mismatches = await analyzeVersionMismatches(dir);
    expect(mismatches.some((m) => (m.actual ?? "").includes("sha512"))).toBe(false);
  });

  it("flags undocumented TypeScript even when README contains 'scripts'/'tests' (no 'ts' substring false-negative)", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({ name: "x", devDependencies: { typescript: "^5.0.0" } }),
      "README.md": "# X\n\nSee the scripts and tests folders for details.\n",
    });
    const issues = await analyzeFrameworkDocs(dir);
    expect(issues.some((i) => i.framework === "typescript")).toBe(true);
  });

  it("resolves the CLI command from pkg.name when bin is a string (never '0')", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({ name: "mytool", bin: "cli.js" }),
      "cli.js": "console.log('Usage: mytool [--verbose] do things');\n",
      "README.md": "# mytool\n\n```\nmytool run\n```\n",
    });
    const drift = await analyzeCLIDrift(dir);
    expect(drift.length).toBeGreaterThan(0);
    expect(drift.every((d) => d.command === "mytool")).toBe(true);
    expect(drift.some((d) => d.command === "0")).toBe(false);
  }, 30_000);
});
