import { execFileSync } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { getChangedFiles } from "../src/diff.js";
import { markdownToHtml } from "../src/formatter.js";

const dirs: string[] = [];

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

describe("formatter inline code escaping", () => {
  it("HTML-escapes the contents of inline code spans", () => {
    const html = markdownToHtml("Returns a `Promise<void>` value.");
    expect(html).toContain("<code>Promise&lt;void&gt;</code>");
    expect(html).not.toContain("<code>Promise<void></code>");
  });
});

describe("diff getChangedFiles", () => {
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("records the new path for a rename (not a tab-joined old\\tnew string)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bootcamp-diff-"));
    dirs.push(dir);
    git(["init", "-b", "main"], dir);
    git(["config", "user.email", "t@example.com"], dir);
    git(["config", "user.name", "T"], dir);

    // Substantial, unchanged content so git detects the rename (R100).
    await writeFile(
      join(dir, "old.ts"),
      "export const greeting = 'hello world';\n".repeat(8),
      "utf-8"
    );
    git(["add", "-A"], dir);
    git(["commit", "-m", "init", "--no-gpg-sign"], dir);
    const base = git(["rev-parse", "HEAD"], dir);

    git(["mv", "old.ts", "new.ts"], dir);
    git(["commit", "-am", "rename", "--no-gpg-sign"], dir);
    const head = git(["rev-parse", "HEAD"], dir);

    const changed = await getChangedFiles(dir, base, head);
    const all = [...changed.added, ...changed.removed, ...changed.modified];
    expect(all).toContain("new.ts");
    expect(all.some((p) => p.includes("\t"))).toBe(false);
  }, 30_000);
});
