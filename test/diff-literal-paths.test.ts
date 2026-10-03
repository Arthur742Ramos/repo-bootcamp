import { execFileSync } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeDiff, generateDiffDocs, getChangedFiles } from "../src/diff.js";
import { markdownToHtml } from "../src/formatter.js";
import { markdownCodeSpan } from "../src/markdown-code.js";

const dirs: string[] = [];
const paths = [
  "ordinary",
  "with space",
  "café",
  "with`tick",
  "with\ttab",
  "with\nnewline",
  'with"quote',
  "with\\slash",
  " leading ",
];
// Windows cannot create these literal filenames; label tests below cover all hosts.
const nativePaths = process.platform === "win32" ? paths.slice(0, 4) : paths;
function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-literal-diff-"));
  dirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", "Owned fixture"]);
  git(dir, ["config", "user.email", "owned@example.invalid"]);
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "owned", version: "1.0.0" }));
  return dir;
}
function commit(dir: string, name: string): void {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "--no-gpg-sign", "-m", name]);
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("literal Git changed paths", () => {
  it.each(nativePaths)(
    "preserves native A/D/M paths and onboarding content in %j",
    async (name) => {
      const dir = await fixture();
      await mkdir(join(dir, name));
      await writeFile(
        join(dir, name, "index.ts"),
        "export const removedLiteral=1;\nexport const kept=2;\n"
      );
      await writeFile(join(dir, name, ".env.example"), "EXISTING=1\n");
      await writeFile(join(dir, name, "deleted.txt"), "deleted\n");
      commit(dir, "base");
      const base = git(dir, ["rev-parse", "HEAD"]).trim();
      await writeFile(
        join(dir, name, "index.ts"),
        "export const kept=2;\nconst value=process.env.CODE_LITERAL;\n"
      );
      await writeFile(join(dir, name, ".env.example"), "EXISTING=1\nENV_LITERAL=1\n");
      await rm(join(dir, name, "deleted.txt"));
      await writeFile(join(dir, name, "added.txt"), "added\n");
      commit(dir, "head");
      const expected = {
        added: [`${name}/added.txt`],
        removed: [`${name}/deleted.txt`],
        modified: [`${name}/.env.example`, `${name}/index.ts`],
      };
      expect(await getChangedFiles(dir, base, "HEAD")).toEqual(expected);
      // A different native output format confirms exact names independently of status parsing.
      expect(
        new Set(
          git(dir, ["diff", "--name-only", "-z", `${base}...HEAD`])
            .split("\0")
            .filter(Boolean)
        )
      ).toEqual(new Set([...expected.added, ...expected.removed, ...expected.modified]));
      const summary = await analyzeDiff(dir, base);
      expect(summary.filesChanged).toBe(4);
      expect(summary.onboardingDeltas.newEnvVars).toEqual(["ENV_LITERAL", "CODE_LITERAL"]);
      expect(summary.onboardingDeltas.breakingChanges).toHaveLength(1);
      expect(summary.onboardingDeltas.breakingChanges[0]).toContain(
        "Removed export: removedLiteral"
      );
      expect(generateDiffDocs(summary, "owned")).toContain("CODE_LITERAL");
      // Quoting configuration must not change the API's original paths.
      git(dir, ["config", "core.quotePath", "false"]);
      expect(await getChangedFiles(dir, base, "HEAD")).toEqual(expected);
    }
  );

  it("consumes native rename/copy source fields and retains destination ordering", async () => {
    const dir = await fixture();
    await writeFile(join(dir, "old.txt"), "rename literal\n".repeat(40));
    await writeFile(join(dir, "source.txt"), "copy literal\n".repeat(40));
    commit(dir, "base");
    const base = git(dir, ["rev-parse", "HEAD"]).trim();
    const renamed = process.platform === "win32" ? "café renamed.txt" : 'café renamed\t".txt';
    const copied = process.platform === "win32" ? "café copied.txt" : "café copied\n`.txt";
    git(dir, ["mv", "old.txt", renamed]);
    await writeFile(join(dir, "source.txt"), "copy literal\n".repeat(40) + "modified\n");
    await writeFile(join(dir, copied), "copy literal\n".repeat(40));
    git(dir, ["config", "diff.renames", "copies"]);
    commit(dir, "head");
    const raw = git(dir, ["diff", "--name-status", "-z", `${base}...HEAD`]);
    expect(raw).toContain(`C100\0source.txt\0${copied}\0`);
    expect(raw).toContain(`R100\0old.txt\0${renamed}\0`);
    expect(await getChangedFiles(dir, base, "HEAD")).toEqual({
      added: [],
      removed: [],
      modified: [copied, renamed, "source.txt"],
    });
    expect(await getChangedFiles(dir, "HEAD", "HEAD")).toEqual({
      added: [],
      removed: [],
      modified: [],
    });
  });
});

describe("literal changed-file labels", () => {
  it.each(["added", "removed", "modified"] as const)(
    "keeps %s paths literal without Markdown structure injection",
    async (kind) => {
      const dir = await fixture();
      commit(dir, "empty base");
      const summary = await analyzeDiff(dir, "HEAD");
      const labels = [
        "ordinary.ts",
        "with space.ts",
        "with`tick.ts",
        "newline\n```\n## Fake.ts",
        "tab\tfile.ts",
        "carriage\rfile.ts",
        "control\u001bfile.ts",
        "separator\u2028file.ts",
        "delete\u007ffile.ts",
      ];
      summary.filesAdded = kind === "added" ? labels : [];
      summary.filesRemoved = kind === "removed" ? labels : [];
      summary.filesModified = kind === "modified" ? labels : [];
      const doc = generateDiffDocs(summary, "owned");
      expect(doc).toContain("- `ordinary.ts`\n- `with space.ts`");
      expect(doc).toContain(`- ${markdownCodeSpan("with`tick.ts")}`);
      expect(doc).toContain('"newline\\n```\\n## Fake.ts"');
      expect(doc).toContain('"separator\\u2028file.ts"');
      expect(doc).toContain('"delete\\u007ffile.ts"');
      expect(doc).not.toContain("\n## Fake");
      const html = markdownToHtml(doc);
      expect(html).toContain("<code>with`tick.ts</code>");
      expect(html).not.toContain("<pre>");
      expect(html).not.toContain("<h2>Fake");
      expect(summary.filesAdded.concat(summary.filesRemoved, summary.filesModified)).toEqual(
        labels
      );
    }
  );
});
