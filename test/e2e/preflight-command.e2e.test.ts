import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

const tempDirs: string[] = [];

async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-preflight-e2e-"));
  tempDirs.push(dir);
  const repoDir = join(dir, "repo");
  await mkdir(repoDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    await writeFile(join(repoDir, rel), content, "utf-8");
  }
  return repoDir;
}

describe("preflight command", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("checks the local machine against the repo's declared Node version (satisfied)", async () => {
    // The test runner uses Node >= 20, so `engines.node: >=20` is satisfied.
    const repoPath = await repoWith({
      "package.json": JSON.stringify({ name: "x", engines: { node: ">=20" } }),
    });
    const result = await runCli(["preflight", repoPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Preflight");
    expect(result.stdout).toContain("Node.js");
    expect(result.stdout).toContain("requires >=20");
  }, 60_000);

  it("emits JSON and fails the --check gate on an unsatisfiable requirement", async () => {
    const repoPath = await repoWith({
      "package.json": JSON.stringify({ name: "x", engines: { node: ">=99" } }),
    });

    const json = await runCli(["preflight", repoPath, "--json"]);
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.checks[0].tool).toBe("Node.js");
    expect(parsed.checks[0].status).toBe("mismatch");

    const gated = await runCli(["preflight", repoPath, "--check"]);
    expect(gated.exitCode).toBe(1);
    expect(`${gated.stdout}\n${gated.stderr}`).toContain("not satisfied");
  }, 60_000);
});
