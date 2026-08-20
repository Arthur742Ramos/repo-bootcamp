import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { gatherRequirements, satisfiesVersion } from "../src/commands/preflight-command.js";

describe("satisfiesVersion", () => {
  it("handles range operators", () => {
    expect(satisfiesVersion(">=20", "24.15.0")).toBe(true);
    expect(satisfiesVersion(">=20", "18.0.0")).toBe(false);
    expect(satisfiesVersion(">=3.10", "3.9.0")).toBe(false);
    expect(satisfiesVersion("^18.0.0", "18.5.0")).toBe(true);
    expect(satisfiesVersion("^18.0.0", "20.0.0")).toBe(false);
    expect(satisfiesVersion("~3.10", "3.10.5")).toBe(true);
    expect(satisfiesVersion("~3.10", "3.9.9")).toBe(false);
  });

  it("handles bare/exact versions by major(+minor)", () => {
    expect(satisfiesVersion("1.21", "1.21.5")).toBe(true); // go.mod
    expect(satisfiesVersion("1.21", "1.20.0")).toBe(false);
    expect(satisfiesVersion("8.6.0", "8.6.2")).toBe(true); // packageManager
  });

  it("returns null for non-numeric requirements", () => {
    expect(satisfiesVersion("lts/iron", "20.0.0")).toBeNull();
    expect(satisfiesVersion("stable", "1.2.3")).toBeNull();
  });

  it("evaluates compound comma-separated ranges (PEP 621 requires-python)", () => {
    // Both bounds must hold — the upper bound was previously ignored.
    expect(satisfiesVersion(">=3.8,<4.0", "3.11.2")).toBe(true);
    expect(satisfiesVersion(">=3.8,<4.0", "3.8.0")).toBe(true);
    expect(satisfiesVersion(">=3.8,<4.0", "4.0.0")).toBe(false); // excluded by <4.0
    expect(satisfiesVersion(">=3.8,<4.0", "3.7.9")).toBe(false); // below >=3.8
    expect(satisfiesVersion(">=3.8, <4.0", "3.9.0")).toBe(true); // tolerates spaces
  });

  it("returns null when any constraint in a compound range is non-numeric", () => {
    expect(satisfiesVersion(">=3.8,foo", "3.9.0")).toBeNull();
  });

  it("enforces the tilde upper bound and patch floor (~1.2.3 => >=1.2.3 <1.3.0)", () => {
    expect(satisfiesVersion("~1.2.3", "1.2.3")).toBe(true); // at the floor
    expect(satisfiesVersion("~1.2.3", "1.2.9")).toBe(true); // within the patch range
    expect(satisfiesVersion("~1.2.3", "1.2.0")).toBe(false); // below the patch floor
    expect(satisfiesVersion("~1.2.3", "1.9.0")).toBe(false); // above the <1.3.0 cap
    expect(satisfiesVersion("~1.2.3", "2.0.0")).toBe(false); // wrong major
    // No minor named → tilde only locks the major (~1 => >=1.0.0 <2.0.0).
    expect(satisfiesVersion("~1", "1.9.9")).toBe(true);
    expect(satisfiesVersion("~1", "2.0.0")).toBe(false);
    // Reachable case: engines.node style pin.
    expect(satisfiesVersion("~18.2.0", "18.2.5")).toBe(true);
    expect(satisfiesVersion("~18.2.0", "18.3.0")).toBe(false);
  });

  it("locks the caret range to the first non-zero component for 0.x (^0.2.3 => >=0.2.3 <0.3.0)", () => {
    expect(satisfiesVersion("^0.2.3", "0.2.3")).toBe(true); // at the floor
    expect(satisfiesVersion("^0.2.3", "0.2.9")).toBe(true); // within the minor range
    expect(satisfiesVersion("^0.2.3", "0.1.0")).toBe(false); // below the floor
    expect(satisfiesVersion("^0.2.3", "0.9.0")).toBe(false); // above the <0.3.0 cap
    expect(satisfiesVersion("^0.2.3", "1.0.0")).toBe(false); // wrong major
    // ^0.0.z locks through the patch (^0.0.3 => 0.0.3 only).
    expect(satisfiesVersion("^0.0.3", "0.0.3")).toBe(true);
    expect(satisfiesVersion("^0.0.3", "0.0.4")).toBe(false);
    // Caret on a >=1 major is unchanged: it locks the major only.
    expect(satisfiesVersion("^1.2.3", "1.9.0")).toBe(true);
    expect(satisfiesVersion("^1.2.3", "2.0.0")).toBe(false);
  });
});

const dirs: string[] = [];
async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-preflight-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    await writeFile(join(dir, rel), content, "utf-8");
  }
  return dir;
}

describe("gatherRequirements", () => {
  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("collects Node, package-manager, Python and Go requirements", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({
        name: "x",
        engines: { node: ">=20" },
        packageManager: "pnpm@8.6.0+sha512.abcdef",
      }),
      "pyproject.toml": '[project]\nrequires-python = ">=3.10"\n',
      "go.mod": "module x\n\ngo 1.21\n",
    });
    const reqs = await gatherRequirements(dir);
    const byTool = Object.fromEntries(reqs.map((r) => [r.tool, r]));

    expect(byTool["Node.js"]).toMatchObject({
      required: ">=20",
      source: "package.json engines.node",
    });
    expect(byTool["pnpm"]).toMatchObject({
      required: "8.6.0",
      source: "package.json packageManager",
    });
    expect(byTool["Python"]).toMatchObject({ required: ">=3.10", source: "pyproject.toml" });
    expect(byTool["Go"]).toMatchObject({ required: "1.21", source: "go.mod" });
  });

  it("falls back to .nvmrc for Node when engines.node is absent", async () => {
    const dir = await repoWith({ ".nvmrc": "20.11.0\n" });
    const reqs = await gatherRequirements(dir);
    expect(reqs).toEqual([
      expect.objectContaining({ tool: "Node.js", required: "20.11.0", source: ".nvmrc" }),
    ]);
  });

  it("returns nothing for a repo with no declared toolchain", async () => {
    const dir = await repoWith({ "README.md": "# hi\n" });
    expect(await gatherRequirements(dir)).toEqual([]);
  });
});
