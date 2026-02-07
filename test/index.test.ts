/**
 * Tests for CLI wiring in index.ts
 */

import { describe, it, expect } from "vitest";
import { program } from "../src/index.js";

describe("CLI program", () => {
  it("registers core subcommands", () => {
    const commandNames = program.commands.map((command) => command.name());
    expect(commandNames).toContain("ask");
    expect(commandNames).toContain("web");
  });

  it("includes main options", () => {
    const optionFlags = program.options.map((option) => option.long);
    expect(optionFlags).toContain("--interactive");
    expect(optionFlags).toContain("--compare");
    expect(optionFlags).toContain("--watch");
  });
});
