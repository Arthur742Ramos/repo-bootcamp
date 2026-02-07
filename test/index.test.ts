import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

async function runCli(args: string[]) {
  return execFileAsync(process.execPath, ["--no-warnings", "--import", "tsx", entry, ...args], {
    env: { ...process.env, NO_COLOR: "1" },
  });
}

describe("bootcamp CLI", () => {
  it("prints help", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("Usage: bootcamp");
    expect(stdout).toContain("--interactive");
    expect(stdout).toContain("web");
  });

  it("prints version", async () => {
    const { stdout } = await runCli(["--version"]);
    expect(stdout.trim()).toBe(pkg.version);
  });
});
