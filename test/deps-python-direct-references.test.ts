import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractDependencies } from "../src/deps.js";

async function extract(manifest: string, pip = false) {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-python-references-"));
  try {
    await writeFile(join(dir, pip ? "requirements.txt" : "pyproject.toml"), manifest);
    return await extractDependencies(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const urls = [
  "https://example.invalid/package.whl;owned#sha256=abc",
  "https://example.invalid/package.whl#sha256=abc;owned",
  "https://example.invalid/package.whl?sig=a;b&part=c#sha256=abc",
  "https://example.invalid/package.whl%3Bowned?part=%20x#sha256=%23abc",
  "https://example.invalid/package.whl;python_version=3.13",
];

describe("Python direct-reference marker boundaries", () => {
  it.each(urls)("preserves the complete URI %s in every array section", async (url) => {
    const deps = await extract(
      `[project]\ndependencies = [${JSON.stringify(`direct[security] @ ${url}`)}]\n[project.optional-dependencies]\nweb = [${JSON.stringify(`optional @${url} ; python_version < '3.13'`)}]\n[dependency-groups]\ntest = [${JSON.stringify(`dev @  ${url}\t;python_version < '3.13'`)}]`
    );
    expect(deps?.totalCount).toBe(3);
    expect(deps?.runtime).toEqual([
      { name: "direct", version: `@ ${url}`, type: "runtime" },
      { name: "optional", version: `@${url}`, type: "runtime" },
    ]);
    expect(deps?.dev).toEqual([{ name: "dev", version: `@  ${url}`, type: "dev" }]);
  });

  it.each(["<=", ">=", "<", ">", "!=", "===", "==", "~="])(
    "preserves ordinary comparator %s and no-space marker stripping",
    async (op) => {
      const deps = await extract(
        `[project]\ndependencies = [${JSON.stringify(`ordinary${op}2.0; platform_system == 'hash#;[]'`)}]`
      );
      expect(deps?.runtime).toEqual([{ name: "ordinary", version: `${op}2.0`, type: "runtime" }]);
    }
  );

  it("retains first occurrence, comma versions, compact extras and runtime/dev target independence", async () => {
    const url = urls[0];
    const deps = await extract(
      `[project]\ndependencies = [${JSON.stringify(`direct[one,two]@${url}`)}, "range>=2,<3;python_version < '3.13'", "direct>=9"]\n[project.optional-dependencies]\nweb = ["direct>=10"]\n[dependency-groups]\ntest = [${JSON.stringify(`direct @ ${url} ; python_version < '3.13'`)}]`
    );
    expect(deps?.totalCount).toBe(3);
    expect(deps?.runtime).toEqual([
      { name: "direct", version: `@${url}`, type: "runtime" },
      { name: "range", version: ">=2,<3", type: "runtime" },
    ]);
    expect(deps?.dev).toEqual([{ name: "direct", version: `@ ${url}`, type: "dev" }]);
  });

  it("does not silently broaden pip URL/path omissions or alter comparator/duplicate behavior", async () => {
    const deps = await extract(
      [
        "named @ https://example.invalid/pkg.whl;owned#hash",
        "namedfile @ file:///owned/pkg.whl;owned",
        "https://example.invalid/pkg.whl;owned",
        "git+https://example.invalid/repo.git#egg=ignored",
        "./pkg.whl",
        "/owned/pkg.whl",
        "-r other.txt",
        "--index-url https://example.invalid/",
        "requests==2.31 # see https://example.invalid/a;b",
        "requests>=2.32;python_version < '3.13'",
        "relative @ ./pkg.whl;owned",
      ].join("\n"),
      true
    );
    expect(deps?.runtime).toEqual([
      { name: "requests", version: "2.31", type: "runtime" },
      { name: "requests", version: "2.32", type: "runtime" },
      { name: "relative", version: "@ ./pkg.whl", type: "runtime" },
    ]);
  });

  it.each(["\n", "\r", "\v", "\u00a0"])(
    "does not treat non-PEP508 separator %s as a valid URL marker boundary",
    async (separator) => {
      const raw = `direct @ ${urls[0]}${separator};python_version < '3.13'`;
      const deps = await extract(`[project]\ndependencies = [${JSON.stringify(raw)}]`);
      // This metadata reader is not a requirement validator. Keep invalid suffix
      // data visible rather than erasing it using a broad JavaScript \s boundary.
      if (separator === "\n" || separator === "\r") expect(deps).toBeNull();
      else expect(deps?.runtime[0].version).toBe(raw.slice("direct ".length));
    }
  );
});
