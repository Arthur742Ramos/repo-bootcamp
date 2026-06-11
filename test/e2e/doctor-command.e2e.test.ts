import { describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

describe("doctor command", () => {
  it("prints a human-readable environment report including the tool version", async () => {
    const result = await runCli(["doctor"], { NO_COLOR: "1" }, 60_000);
    // `doctor` exits 0 when required checks pass; in CI Node/git are present.
    expect(result.stdout).toContain("repo-bootcamp environment check");
    expect(result.stdout).toMatch(/repo-bootcamp:\s*v\d+\.\d+\.\d+/);
    expect(result.stdout).toContain("Node.js runtime");
  }, 60_000);

  it("emits valid JSON with --json including environment.toolVersion", async () => {
    const result = await runCli(["doctor", "--json"], { NO_COLOR: "1" }, 60_000);
    const parsed = JSON.parse(result.stdout);
    expect(typeof parsed.ok).toBe("boolean");
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.some((c: { id: string }) => c.id === "version")).toBe(true);
    expect(typeof parsed.environment.toolVersion).toBe("string");
    expect(parsed.environment.toolVersion).toMatch(/^\d+\.\d+\.\d+/);
  }, 60_000);
});
