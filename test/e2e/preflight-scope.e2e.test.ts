import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./helpers.js";

const roots: string[] = [];
async function fixture(files: Record<string, string>): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-package-preflight-e2e-"));
  roots.push(base);
  const root = join(base, "repo");
  await mkdir(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe("package preflight CLI", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("checks the selected package rather than incompatible root or sibling pins", async () => {
    const root = await fixture({
      ".nvmrc": "99",
      "packages/api space/.nvmrc": ">=20",
      "packages/other/.nvmrc": "98",
    });
    const scoped = await runCli([
      "preflight",
      root,
      "--subdir",
      "packages/api space",
      "--json",
      "--check",
    ]);
    expect(scoped.exitCode).toBe(0);
    expect(JSON.parse(scoped.stdout)).toMatchObject({
      ok: true,
      subdir: "packages/api space",
      scope: "directory",
      checks: [{ tool: "Node.js", source: "packages/api space/.nvmrc", status: "ok" }],
    });
    const unscoped = await runCli(["preflight", root, "--json", "--check"]);
    expect(unscoped.exitCode).toBe(1);
    const reset = await runCli([
      "preflight",
      root,
      "--subdir",
      "packages/api space",
      "--subdir=",
      "--json",
      "--check",
    ]);
    expect(reset.exitCode).toBe(1);
    expect(JSON.parse(reset.stdout)).not.toHaveProperty("subdir");
    expect(JSON.parse(reset.stdout).checks[0].source).toBe(".nvmrc");
    expect(JSON.parse(unscoped.stdout)).toMatchObject({
      ok: false,
      checks: [{ required: "99", source: ".nvmrc" }],
    });
  }, 60_000);

  it("fails package mismatch gates and retains unknown requirements without falsely failing", async () => {
    const root = await fixture({ "packages/api/.nvmrc": "99" });
    const mismatch = await runCli([
      "preflight",
      root,
      "--subdir=packages/api",
      "--json",
      "--check",
    ]);
    expect(mismatch.exitCode).toBe(1);
    expect(JSON.parse(mismatch.stdout)).toMatchObject({
      ok: false,
      checks: [{ status: "mismatch" }],
    });
    await writeFile(join(root, "packages/api/.nvmrc"), "lts/unknown");
    const unknown = await runCli([
      "preflight",
      root,
      "--subdir",
      "packages/api",
      "--json",
      "--check",
    ]);
    expect(unknown.exitCode).toBe(0);
    expect(JSON.parse(unknown.stdout)).toMatchObject({ ok: true, checks: [{ status: "unknown" }] });
  }, 60_000);

  it("shows scope for an empty package without inheriting root declarations", async () => {
    const root = await fixture({ ".nvmrc": "99", "packages/api/README.md": "# API" });
    const output = await runCli(["preflight", root, "--subdir", "packages/api"]);
    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain("Package directory: packages/api (local declarations only)");
    expect(output.stdout).toContain("No declared toolchain requirements detected");
  }, 60_000);

  it.each([
    ["../outside", "Invalid subdir"],
    ["/", "Invalid subdir"],
    ["missing", "does not exist"],
    ["README.md", "not a directory"],
  ])(
    "rejects invalid selected directory %s",
    async (subdir, error) => {
      const root = await fixture({ "README.md": "# Root" });
      const output = await runCli(["preflight", root, "--subdir", subdir, "--json"]);
      expect(output.exitCode).toBe(1);
      expect(output.stderr).toContain(error);
      expect(output.stdout).toBe("");
    },
    60_000
  );

  it("rejects a junction or symlink outside the supplied repository", async () => {
    const root = await fixture({ "README.md": "# Root" });
    const outside = join(dirname(root), "outside");
    await mkdir(outside);
    await writeFile(join(outside, ".nvmrc"), "24");
    await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    const output = await runCli(["preflight", root, "--subdir", "escape", "--json"]);
    expect(output.exitCode).toBe(1);
    expect(output.stderr).toContain("escapes repository root");
    expect(output.stdout).toBe("");
  }, 60_000);
});
