import { describe, expect, it } from "vitest";

import { runCli } from "./helpers.js";

describe("styles command", () => {
  it("lists the built-in style packs in a human-readable report", async () => {
    const result = await runCli(["styles"], { NO_COLOR: "1" }, 60_000);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Built-in style packs");
    for (const name of ["corporate", "startup", "oss", "academic", "minimal"]) {
      expect(result.stdout).toContain(name);
    }
    expect(result.stdout).toContain("Section coverage");
    expect(result.stdout).toContain("default: oss");
  }, 60_000);

  it("emits a stable JSON payload with --json", async () => {
    const result = await runCli(["styles", "--json"], { NO_COLOR: "1" }, 60_000);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.default).toBe("oss");
    expect(parsed.count).toBe(5);
    expect(Array.isArray(parsed.styles)).toBe(true);
    expect(parsed.styles.map((s: { name: string }) => s.name)).toEqual([
      "corporate",
      "startup",
      "oss",
      "academic",
      "minimal",
    ]);

    const corporate = parsed.styles.find((s: { name: string }) => s.name === "corporate");
    expect(corporate.enabledSections.length).toBeGreaterThan(0);
    expect(corporate.firstTasksCount).toBe(10);

    const minimal = parsed.styles.find((s: { name: string }) => s.name === "minimal");
    expect(minimal.enabledSections).toEqual([]);
  }, 60_000);

  it("is reachable through the `style` alias", async () => {
    const result = await runCli(["style", "--json"], { NO_COLOR: "1" }, 60_000);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.count).toBe(5);
  }, 60_000);
});
