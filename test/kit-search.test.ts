import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { SEARCH_MAX_BYTES, searchDocument, searchKit } from "../src/web/kit-search.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "kit-search-"));
  roots.push(root);
  return root;
}

describe("kit content search", () => {
  it("finds literal case-insensitive matching lines with context, not regex expressions", () => {
    expect(searchDocument("guide.txt", "a.b\nA.B again a.b\naab", "a.b")).toMatchObject([
      { line: 1, snippet: "a.b", fragment: "" },
      { line: 2, snippet: "A.B again a.b" },
    ]);
    expect(searchDocument("guide.txt", "anything", "")).toEqual([]);
    expect(searchDocument("guide.txt", "İ".repeat(100) + "needle", "needle")[0].snippet).toContain(
      "needle"
    );
  });
  it("uses unique rendered Markdown headings and ignores code-fenced headings", () => {
    const doc =
      "# Guide\n## **Setup** & café\nNeedle\n~~~sh\n# fake\nneedle\n~~~\n## **Setup** & café\nneedle";
    expect(searchDocument("guide.md", doc, "needle")).toMatchObject([
      { line: 3, heading: "Setup & café", fragment: "setup-café" },
      { line: 6, heading: "Setup & café", fragment: "setup-café" },
      { line: 9, heading: "Setup & café", fragment: "setup-café-1" },
    ]);
  });
  it("retains Unicode and hostile markup as inert snippet text and bounds snippets", () => {
    expect(
      searchDocument("guide.md", '## 日本語\n<img onerror="evil()">日本語', "日本語")[1]
    ).toMatchObject({ heading: "日本語", snippet: '<img onerror="evil()">日本語' });
    expect(
      searchDocument("a.txt", "x".repeat(500) + "needle" + "y".repeat(500), "needle")[0].snippet
        .length
    ).toBeLessThan(200);
  });
  it("searches only unique supported inventory files, skips missing, oversized and unsafe paths", async () => {
    const root = await fixture();
    await writeFile(join(root, "GUIDE.md"), "# Start\nneedle");
    await writeFile(join(root, "facts.json"), '{"needle": true}');
    await writeFile(join(root, "large.txt"), "x".repeat(SEARCH_MAX_BYTES + 1));
    await mkdir(join(root, "directory.txt"));
    const report = await searchKit(
      root,
      [
        "GUIDE.md",
        "GUIDE.md",
        "facts.json",
        "missing.md",
        "large.txt",
        "directory.txt",
        "../escape.md",
        "a/b.md",
        "index.html",
        "report.pdf",
      ],
      "needle"
    );
    expect(report).toMatchObject({ searchedFiles: 2, skippedFiles: 7, truncated: false });
    expect(report.matches.map((match) => match.filename)).toEqual(["GUIDE.md", "facts.json"]);
  });
  it("refuses a symlink to a file outside the generated output", async (context) => {
    const root = await fixture();
    const outside = await fixture();
    await writeFile(join(outside, "private.txt"), "needle");
    try {
      await symlink(join(outside, "private.txt"), join(root, "escape.txt"), "file");
    } catch (error: unknown) {
      if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        context.skip();
        return;
      }
      throw error;
    }
    expect(await searchKit(root, ["escape.txt"], "needle")).toMatchObject({
      matches: [],
      searchedFiles: 0,
      skippedFiles: 1,
    });
  });

  it("caps result count and reports incomplete matches without losing search coverage", async () => {
    const root = await fixture();
    await writeFile(join(root, "many.md"), "needle\n".repeat(60));
    await writeFile(join(root, "last.txt"), "needle");
    const report = await searchKit(root, ["many.md", "last.txt"], "needle");
    expect(report.matches).toHaveLength(50);
    expect(report).toMatchObject({ searchedFiles: 2, truncated: true });
  });
  it("bounds attempted files including unreadable files", async () => {
    const root = await fixture();
    await writeFile(join(root, "last.md"), "needle");
    const report = await searchKit(
      root,
      [...Array.from({ length: 64 }, (_, i) => `${i}.md`), "last.md"],
      "needle"
    );
    expect(report).toMatchObject({ searchedFiles: 0, skippedFiles: 65, matches: [] });
  });
});
