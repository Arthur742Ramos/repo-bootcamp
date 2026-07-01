/**
 * Tests for utils.ts - Shared utility functions and constants
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  SKIP_DIRS,
  README_NAMES,
  readFileSafe,
  escapeRegex,
  getFlagValue,
  hasFlag,
  toPosixPath,
  isPathInsideDir,
  finiteOr,
  getErrorMessage,
  isTestFile,
} from "../src/utils.js";

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

describe("toPosixPath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(toPosixPath("a\\b\\c")).toBe("a/b/c");
  });

  it("leaves forward-slash paths unchanged", () => {
    expect(toPosixPath("a/b/c")).toBe("a/b/c");
  });

  it("converts a Windows-style absolute path", () => {
    expect(toPosixPath("C:\\Users\\me\\repo")).toBe("C:/Users/me/repo");
  });

  it("handles mixed separators", () => {
    expect(toPosixPath("a\\b/c\\d")).toBe("a/b/c/d");
  });

  it("returns an empty string unchanged", () => {
    expect(toPosixPath("")).toBe("");
  });
});

describe("isPathInsideDir", () => {
  const parent = resolve("/tmp/project");

  it("returns true for the same path", () => {
    expect(isPathInsideDir(parent, parent)).toBe(true);
  });

  it("returns true for a direct child", () => {
    expect(isPathInsideDir(parent, resolve(parent, "src"))).toBe(true);
  });

  it("returns true for a deeply nested descendant", () => {
    expect(isPathInsideDir(parent, resolve(parent, "src/a/b/c.ts"))).toBe(true);
  });

  it("returns false for a parent directory", () => {
    expect(isPathInsideDir(parent, resolve(parent, ".."))).toBe(false);
  });

  it("returns false for a sibling directory", () => {
    expect(isPathInsideDir(parent, resolve(parent, "../sibling"))).toBe(false);
  });

  it("returns false for a same-prefixed sibling directory", () => {
    // /tmp/project-evil shares a string prefix with /tmp/project but is not inside it.
    expect(isPathInsideDir(parent, resolve("/tmp/project-evil/file"))).toBe(false);
  });

  it("returns false for a traversal escape out of the parent", () => {
    expect(isPathInsideDir(parent, resolve(parent, "src/../../escape"))).toBe(false);
  });

  it("normalizes mixed/relative inputs before comparing", () => {
    expect(isPathInsideDir(parent, resolve(parent, "./nested/./file.ts"))).toBe(true);
  });
});

describe("finiteOr", () => {
  it("returns the value when it is a finite number", () => {
    expect(finiteOr(42, 7)).toBe(42);
    expect(finiteOr(0, 7)).toBe(0);
    expect(finiteOr(-3, 7)).toBe(-3);
    expect(finiteOr(3.14, 7)).toBe(3.14);
  });

  it("returns the fallback for NaN", () => {
    expect(finiteOr(NaN, 50)).toBe(50);
    expect(finiteOr(Number("not-a-number"), 50)).toBe(50);
  });

  it("returns the fallback for +/-Infinity", () => {
    expect(finiteOr(Infinity, 50)).toBe(50);
    expect(finiteOr(-Infinity, 50)).toBe(50);
  });

  it("returns the fallback for non-number inputs", () => {
    expect(finiteOr(undefined, 50)).toBe(50);
    expect(finiteOr(null, 50)).toBe(50);
    expect(finiteOr("100", 50)).toBe(50);
  });

  it("enforces opts.min when provided", () => {
    expect(finiteOr(5, 50, { min: 1 })).toBe(5);
    expect(finiteOr(1, 50, { min: 1 })).toBe(1); // >= min is allowed
    expect(finiteOr(0, 50, { min: 1 })).toBe(50); // below min -> fallback
    expect(finiteOr(-4, 50, { min: 1 })).toBe(50);
  });

  it("ignores min when it is not given", () => {
    expect(finiteOr(0, 50)).toBe(0);
    expect(finiteOr(-100, 50)).toBe(-100);
  });
});

describe("getErrorMessage", () => {
  it("returns the message of an Error instance", () => {
    expect(getErrorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("returns the message of an Error subclass", () => {
    expect(getErrorMessage(new TypeError("bad type"), "fallback")).toBe("bad type");
  });

  it("stringifies non-Error values", () => {
    expect(getErrorMessage("plain string", "fallback")).toBe("plain string");
    expect(getErrorMessage(404, "fallback")).toBe("404");
    expect(getErrorMessage({ toString: () => "obj" }, "fallback")).toBe("obj");
  });

  it("uses the fallback when the message is empty", () => {
    expect(getErrorMessage(new Error(""), "fallback")).toBe("fallback");
    expect(getErrorMessage("", "fallback")).toBe("fallback");
  });

  it("uses the fallback when the message is only whitespace", () => {
    expect(getErrorMessage(new Error("   \n"), "fallback")).toBe("fallback");
  });

  it("has a default fallback for empty input", () => {
    expect(getErrorMessage("")).toBe("Unknown error");
  });
});

describe("isTestFile", () => {
  it("matches the .test. infix", () => {
    expect(isTestFile("src/foo.test.ts")).toBe(true);
    expect(isTestFile("foo.test.js")).toBe(true);
    expect(isTestFile("a/b/c.test.tsx")).toBe(true);
  });

  it("matches the .spec. infix", () => {
    expect(isTestFile("src/foo.spec.ts")).toBe(true);
    expect(isTestFile("foo.spec.jsx")).toBe(true);
  });

  it("matches __tests__ and __mocks__ directories", () => {
    expect(isTestFile("src/__tests__/foo.ts")).toBe(true);
    expect(isTestFile("src/__mocks__/foo.ts")).toBe(true);
  });

  it("matches /test/ and /tests/ path segments", () => {
    expect(isTestFile("pkg/test/foo.ts")).toBe(true);
    expect(isTestFile("pkg/tests/foo.ts")).toBe(true);
    expect(isTestFile("test/foo.ts")).toBe(true);
  });

  it("matches spec and specs path segments", () => {
    expect(isTestFile("pkg/spec/foo.rb")).toBe(true);
    expect(isTestFile("pkg/specs/foo.rb")).toBe(true);
  });

  it("matches _test suffix for go, py and other languages", () => {
    expect(isTestFile("foo_test.go")).toBe(true);
    expect(isTestFile("foo_test.py")).toBe(true);
    expect(isTestFile("foo_test.rb")).toBe(true);
    // extension-agnostic: superset of the original cycles.ts predicate
    expect(isTestFile("foo_test.ts")).toBe(true);
    expect(isTestFile("foo_test.rs")).toBe(true);
  });

  it("matches _spec suffix for go, py and rb", () => {
    expect(isTestFile("foo_spec.rb")).toBe(true);
    expect(isTestFile("foo_spec.go")).toBe(true);
    expect(isTestFile("foo_spec.py")).toBe(true);
  });

  it("matches Python test_*.py files", () => {
    expect(isTestFile("test_foo.py")).toBe(true);
    expect(isTestFile("pkg/test_utils.py")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isTestFile("src/Foo.Test.TS")).toBe(true);
    expect(isTestFile("Tests/foo.ts")).toBe(true);
    expect(isTestFile("FOO_TEST.GO")).toBe(true);
    expect(isTestFile("TEST_foo.PY")).toBe(true);
  });

  it("normalizes Windows-style backslash separators", () => {
    expect(isTestFile("src\\__tests__\\foo.ts")).toBe(true);
    expect(isTestFile("src\\foo.test.ts")).toBe(true);
  });

  it("stays consistent with the cycles.ts variant", () => {
    // Mirrors src/cycles.ts isTestFile cases so coupling/cycles keep working.
    expect(isTestFile("a/b.test.ts")).toBe(true);
    expect(isTestFile("pkg/foo_test.go")).toBe(true);
    expect(isTestFile("pkg/test_thing.py")).toBe(true);
    expect(isTestFile("src/__mocks__/mod.ts")).toBe(true);
  });

  it("does not match non-test files", () => {
    expect(isTestFile("src/foo.ts")).toBe(false);
    expect(isTestFile("src/index.ts")).toBe(false);
    expect(isTestFile("README.md")).toBe(false);
  });

  it("does not treat substring matches as test segments or suffixes", () => {
    expect(isTestFile("src/latest/foo.ts")).toBe(false); // 'latest' is not 'test'
    expect(isTestFile("src/contest.ts")).toBe(false);
    expect(isTestFile("src/attestation.ts")).toBe(false);
    expect(isTestFile("src/testing/mod.ts")).toBe(false); // 'testing' is not a test segment
    expect(isTestFile("src/my_contest.go")).toBe(false); // no '_test.' boundary
  });
});
