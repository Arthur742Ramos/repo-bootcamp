/**
 * Tests for CLI wiring in index.ts
 */

import { describe, it, expect } from "vitest";
import { program } from "../src/index.js";

describe("CLI program", () => {
  it("registers core subcommands", () => {
    const commandNames = program.commands.map((command) => command.name());
    expect(commandNames).toContain("ask");
    expect(commandNames).toContain("diff");
    expect(commandNames).toContain("web");
  });

  it("includes main options", () => {
    const optionFlags = program.options.map((option) => option.long);
    expect(optionFlags).toContain("--interactive");
    expect(optionFlags).toContain("--compare");
    expect(optionFlags).toContain("--watch");
  });

  it("includes output and format options", () => {
    const optionFlags = program.options.map((option) => option.long);
    expect(optionFlags).toContain("--output");
    expect(optionFlags).toContain("--format");
    expect(optionFlags).toContain("--json-only");
  });

  it("includes model and verbose options", () => {
    const optionFlags = program.options.map((option) => option.long);
    expect(optionFlags).toContain("--model");
    expect(optionFlags).toContain("--verbose");
  });

  it("includes style and audience options", () => {
    const optionFlags = program.options.map((option) => option.long);
    expect(optionFlags).toContain("--style");
    expect(optionFlags).toContain("--audience");
    expect(optionFlags).toContain("--focus");
  });

  it("includes issue creation options", () => {
    const optionFlags = program.options.map((option) => option.long);
    expect(optionFlags).toContain("--create-issues");
    expect(optionFlags).toContain("--dry-run");
  });

  it("includes clone and cache options", () => {
    const optionFlags = program.options.map((option) => option.long);
    expect(optionFlags).toContain("--no-clone");
    expect(optionFlags).toContain("--full-clone");
    expect(optionFlags).toContain("--keep-temp");
    expect(optionFlags).toContain("--no-cache");
  });

  it("includes diagram and stats options", () => {
    const optionFlags = program.options.map((option) => option.long);
    expect(optionFlags).toContain("--render-diagrams");
    expect(optionFlags).toContain("--stats");
  });

  it("has a version set", () => {
    expect(program.version()).toBeTruthy();
  });

  it("has correct program name", () => {
    expect(program.name()).toBe("bootcamp");
  });

  it("has a description", () => {
    expect(program.description()).toContain("onboarding");
  });

  describe("ask subcommand", () => {
    it("accepts a repo-url argument", () => {
      const askCmd = program.commands.find((c) => c.name() === "ask");
      expect(askCmd).toBeDefined();
      expect(askCmd!.description()).toContain("interactive");
    });

    it("has verbose and branch options", () => {
      const askCmd = program.commands.find((c) => c.name() === "ask");
      const optionFlags = askCmd!.options.map((o) => o.long);
      expect(optionFlags).toContain("--verbose");
      expect(optionFlags).toContain("--branch");
    });
  });

  describe("diff subcommand", () => {
    it("accepts a repo-pr argument", () => {
      const diffCmd = program.commands.find((c) => c.name() === "diff");
      expect(diffCmd).toBeDefined();
      expect(diffCmd!.description()).toContain("PR");
    });

    it("has output and format options", () => {
      const diffCmd = program.commands.find((c) => c.name() === "diff");
      const optionFlags = diffCmd!.options.map((o) => o.long);
      expect(optionFlags).toContain("--output");
      expect(optionFlags).toContain("--format");
      expect(optionFlags).toContain("--full-clone");
    });
  });

  describe("web subcommand", () => {
    it("has a serve alias", () => {
      const webCmd = program.commands.find((c) => c.name() === "web");
      expect(webCmd).toBeDefined();
      expect(webCmd!.aliases()).toContain("serve");
    });

    it("has a port option", () => {
      const webCmd = program.commands.find((c) => c.name() === "web");
      const optionFlags = webCmd!.options.map((o) => o.long);
      expect(optionFlags).toContain("--port");
    });
  });

  it("includes watch interval option", () => {
    const optionFlags = program.options.map((option) => option.long);
    expect(optionFlags).toContain("--watch-interval");
  });

  it("includes branch and max-files options", () => {
    const optionFlags = program.options.map((option) => option.long);
    expect(optionFlags).toContain("--branch");
    expect(optionFlags).toContain("--max-files");
  });

  it("includes transcript option", () => {
    const optionFlags = program.options.map((option) => option.long);
    expect(optionFlags).toContain("--transcript");
  });

  it("includes fast mode option", () => {
    const optionFlags = program.options.map((option) => option.long);
    expect(optionFlags).toContain("--fast");
  });
});
