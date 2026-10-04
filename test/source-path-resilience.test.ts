import { describe, expect, it } from "vitest";
import {
  buildBlobUrl,
  buildRelativeSourceUrl,
  isWellFormedSourceText,
  sourcePathCode,
} from "../src/source-links.js";
import { markdownToHtml } from "../src/formatter.js";
import { generateCodemap, generateArchitecture, generateFirstTasks } from "../src/generator.js";
import { taskToIssuePayload } from "../src/issues.js";
import { runbookFacts } from "./helpers/runbook-facts.js";
import type { RepoInfo } from "../src/types.js";
const info: RepoInfo = {
  url: "https://github.com/owned/source-fixture",
  provider: "github",
  host: "github.com",
  owner: "owned",
  repo: "source-fixture",
  branch: "main",
  fullName: "owned/source-fixture",
  sourcePathPrefix: "packages/ref app",
};
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

describe("source path resilience and literal display", () => {
  it.each([
    "plain.ts",
    "src/é😀.ts",
    "src/\ud800.ts",
    "src/\udc00.ts",
    "src/\ud800x.ts",
    "src/\udc00\ud800.ts",
  ])("checks scalar integrity without replacing the input: %s", (value) => {
    expect(isWellFormedSourceText(value)).toBe(!/[\ud800-\udfff]/u.test(value));
  });
  it.each(["src/\ud800.ts", "src/\udc00.ts"])(
    "does not fabricate a remote or relative URL for malformed model paths: %s",
    (path) => {
      expect(() => buildBlobUrl(info, path)).not.toThrow();
      expect(buildBlobUrl(info, path)).toBeNull();
      expect(buildRelativeSourceUrl(path)).toBeNull();
      const literal = sourcePathCode(path);
      expect(literal).toContain(JSON.stringify(path));
      expect(text(markdownToHtml(literal)).trim()).toBe(JSON.stringify(path));
    }
  );
  it.each(["branch", "commitSha", "sourcePathPrefix", "owner", "repo", "host"] as const)(
    "fails gracefully for malformed URI metadata %s",
    (field) => {
      const target = { ...info, [field]: "broken\ud800" };
      if (field === "commitSha") target.branch = "HEAD";
      expect(() => buildBlobUrl(target, "src/index.ts")).not.toThrow();
      expect(buildBlobUrl(target, "src/index.ts")).toBeNull();
    }
  );
  it.each([
    "src/read`me.ts",
    "src/``wide``.ts",
    "`edge.ts",
    "edge.ts`",
    "src/[part](note)&é😀.ts",
    "src/[click](javascript:alert(1))_file.ts",
    "src/<img src=x onerror=alert(1)>.ts",
    'src/a\\b"quote.ts',
    " src/leading and trailing.ts ",
    "   ",
  ])("retains exact valid filename text with CommonMark code fences: %s", (path) => {
    const literal = sourcePathCode(path);
    const rendered = markdownToHtml(literal);
    const payload = rendered.match(/<code>([\s\S]*?)<\/code>/)?.[1];
    expect(payload).toBeDefined();
    expect(text(payload!)).toBe(path);
    const html = markdownToHtml(`[${literal}](${buildBlobUrl(info, path)})`);
    expect(html).toContain(
      '<a href="https://github.com/owned/source-fixture/blob/main/packages/ref%20app/'
    );
    expect(html).not.toMatch(/<img|<script|<iframe/);
    expect(html).not.toContain("<em>");
  });
  it.each(["src/a|b.ts", "src/a\\|b.ts", "src/a\\\\|b.ts", "src/`a|b`.ts"])(
    "preserves table-only pipe escaping without changing filename data: %s",
    (path) => {
      const html = markdownToHtml(`| Path |\n|---|\n| ${sourcePathCode(path, true)} |`);
      const cells = [...html.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
      expect(cells).toEqual([path]);
      expect(text(markdownToHtml(sourcePathCode(path))).trim()).toBe(path);
    }
  );
  it.each([
    "src/line\nsecond.ts",
    "src/tab\tname.ts",
    "src/carriage\rname.ts",
    "src/DEL\u007fname.ts",
  ])(
    "uses explicit notation for structural controls without splitting unrelated output: %s",
    (path) => {
      const html = markdownToHtml(`${sourcePathCode(path)}\n\nUnrelated output`);
      expect(html).toContain("Unrelated output");
      expect(text(html)).toContain(JSON.stringify(path).replace(/\u007f/g, "\\u007f"));
      expect(buildBlobUrl(info, path)).toContain(path.split("/").map(encodeURIComponent).join("/"));
    }
  );
  it("handles many delimiter runs without argument-spread failure", () => {
    const value = "`a".repeat(150_000);
    expect(() => sourcePathCode(value)).not.toThrow();
    expect(sourcePathCode(value)).toBe("`` " + value + " ``");
  });
  it("retains valid refs/URLs and selected-scope containment", () => {
    const source = { ...info, branch: "release/v2#candidate(α)%" };
    expect(buildBlobUrl(source, "src/file(name).ts")).toBe(
      "https://github.com/owned/source-fixture/blob/release/v2%23candidate%28%CE%B1%29%25/packages/ref%20app/src/file%28name%29.ts"
    );
    expect(buildBlobUrl(source, "../secret.ts")).toBeNull();
    expect(buildRelativeSourceUrl("../secret.ts")).toBeNull();
    expect(buildBlobUrl({ ...info, sourcePathPrefix: "/outside" }, "src/index.ts")).toBeNull();
    expect(buildRelativeSourceUrl("src/plain.ts")).toBe("./src/plain.ts");
    expect(buildRelativeSourceUrl("./src/space name.ts")).toBe("././src/space%20name.ts");
  });
  it("keeps commands/code snippets intact while malformed entrypoints no longer drop guides", () => {
    const facts = runbookFacts();
    facts.structure.entrypoints[0].path = "src/\ud800.ts";
    facts.architecture.codeExamples = [
      {
        title: "Protected source",
        file: "src/read`me.ts",
        code: "export const protectedCommand = `literal`;",
        explanation: "Owned control",
      },
    ];
    facts.firstTasks = [
      {
        title: "Owned task",
        description: "Preserved task",
        difficulty: "beginner",
        category: "test",
        files: ["src/read`me.ts"],
        why: "Owned control",
      },
    ];
    const map = generateCodemap(facts, info);
    expect(map).toContain("Code Map");
    expect(map).toContain("src/\\ud800.ts");
    expect(map).not.toContain("](./src/\ud800.ts)");
    const architecture = generateArchitecture(facts, undefined, info);
    expect(architecture).toContain("export const protectedCommand = `literal`;");
    expect(generateFirstTasks(facts, undefined, undefined, info)).toContain("src/read%60me.ts");
    expect(taskToIssuePayload(facts.firstTasks[0], info).body).toContain("src/read%60me.ts");
  });
});
