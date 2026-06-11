/**
 * Tests for utils.ts - Shared utility functions and constants
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { SKIP_DIRS, README_NAMES, readFileSafe, escapeRegex, getFlagValue, hasFlag } from "../src/utils.js";

describe("SKIP_DIRS", () => {
  it("is a Set containing common directories to skip", () => {
    expect(SKIP_DIRS).toBeInstanceOf(Set);
    expect(SKIP_DIRS.has("node_modules")).toBe(true);
    expect(SKIP_DIRS.has(".git")).toBe(true);
    expect(SKIP_DIRS.has("dist")).toBe(true);
    expect(SKIP_DIRS.has("build")).toBe(true);
    expect(SKIP_DIRS.has("__pycache__")).toBe(true);
    expect(SKIP_DIRS.has(".venv")).toBe(true);
    expect(SKIP_DIRS.has("vendor")).toBe(true);
    expect(SKIP_DIRS.has("coverage")).toBe(true);
    expect(SKIP_DIRS.has("target")).toBe(true);
  });

  it("does not contain arbitrary directories", () => {
    expect(SKIP_DIRS.has("src")).toBe(false);
    expect(SKIP_DIRS.has("lib")).toBe(false);
  });
});

describe("README_NAMES", () => {
  it("is an array of common README filename variants", () => {
    expect(Array.isArray(README_NAMES)).toBe(true);
    expect(README_NAMES).toContain("README.md");
    expect(README_NAMES).toContain("readme.md");
    expect(README_NAMES).toContain("README.MD");
    expect(README_NAMES).toContain("Readme.md");
  });

  it("has exactly 4 entries", () => {
    expect(README_NAMES).toHaveLength(4);
  });
});

describe("readFileSafe", () => {
  let tmpDir: string;

  it("returns file content for an existing file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "utils-test-"));
    const filePath = join(tmpDir, "test.txt");
    await writeFile(filePath, "hello world", "utf-8");

    const result = await readFileSafe(filePath);
    expect(result).toBe("hello world");

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null for a non-existing file", async () => {
    const result = await readFileSafe("/non/existent/path/file.txt");
    expect(result).toBeNull();
  });

  it("returns null for an inaccessible path", async () => {
    const result = await readFileSafe("");
    expect(result).toBeNull();
  });
});

describe("escapeRegex", () => {
  it("escapes dots", () => {
    expect(escapeRegex("file.ts")).toBe("file\\.ts");
  });

  it("escapes asterisks and plus signs", () => {
    expect(escapeRegex("a*b+c")).toBe("a\\*b\\+c");
  });

  it("escapes question marks and carets", () => {
    expect(escapeRegex("a?b^c")).toBe("a\\?b\\^c");
  });

  it("escapes dollar signs and braces", () => {
    expect(escapeRegex("${foo}")).toBe("\\$\\{foo\\}");
  });

  it("escapes parentheses and pipes", () => {
    expect(escapeRegex("(a|b)")).toBe("\\(a\\|b\\)");
  });

  it("escapes square brackets and backslashes", () => {
    expect(escapeRegex("[a\\b]")).toBe("\\[a\\\\b\\]");
  });

  it("returns the same string when no special characters", () => {
    expect(escapeRegex("hello")).toBe("hello");
    expect(escapeRegex("")).toBe("");
  });

  it("handles a string with all special characters", () => {
    const input = ".*+?^${}()|[]\\";
    const expected = "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\";
    expect(escapeRegex(input)).toBe(expected);
  });
});

describe("getFlagValue", () => {
  it("reads a value from the `--flag value` form", () => {
    expect(getFlagValue(["--branch", "dev", "--json"], ["--branch", "-b"])).toBe("dev");
  });

  it("reads a value from the `--flag=value` form", () => {
    expect(getFlagValue(["--branch=dev"], ["--branch", "-b"])).toBe("dev");
  });

  it("matches any of the provided aliases", () => {
    expect(getFlagValue(["-b", "main"], ["--branch", "-b"])).toBe("main");
  });

  it("returns undefined when the flag is absent", () => {
    expect(getFlagValue(["--json"], ["--branch", "-b"])).toBeUndefined();
  });

  it("returns the first occurrence when repeated", () => {
    expect(getFlagValue(["--branch", "a", "--branch", "b"], ["--branch"])).toBe("a");
  });
});

describe("hasFlag", () => {
  it("detects a present boolean flag", () => {
    expect(hasFlag(["--full-clone", "--json"], ["--full-clone"])).toBe(true);
  });

  it("detects an alias", () => {
    expect(hasFlag(["-v"], ["--verbose", "-v"])).toBe(true);
  });

  it("detects the `--flag=value` form", () => {
    expect(hasFlag(["--keep-temp=true"], ["--keep-temp"])).toBe(true);
  });

  it("returns false when absent", () => {
    expect(hasFlag(["--json"], ["--full-clone"])).toBe(false);
  });
});
