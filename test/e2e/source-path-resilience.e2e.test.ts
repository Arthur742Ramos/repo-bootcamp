import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fixture,
  generate,
  validFiles,
  sourceUrls,
  literalPath,
  rejectedPaths,
  ref,
  directory,
  testDirectory,
  docsDirectory,
  workflow,
  command,
  example,
  encodedFiles,
} from "../helpers/source-path-resilience.js";

const documentNames = [
  "BOOTCAMP",
  "ONBOARDING",
  "CODEMAP",
  "ARCHITECTURE",
  "FIRST_TASKS",
  "RUNBOOK",
];
function htmlText(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}
function htmlCode(doc: string) {
  return [...doc.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)].map((match) => htmlText(match[1]));
}
describe("actual source-path resilience and literal display exports", () => {
  it("preserves real source names and malformed model facts without URI errors or fabricated links in every format", async () => {
    const owned = await fixture();
    try {
      for (const file of validFiles)
        expect(await readFile(join(owned.selected, file), "utf8")).toBe(
          "export const metadataOnly = true;\n"
        );
      for (const format of ["markdown", "html", "pdf"] as const) {
        const { result, output } = await generate(owned, format);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout + result.stderr).not.toContain("URI malformed");
        const facts = JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8"));
        expect(facts.structure).toEqual(owned.facts.structure);
        expect(facts.purpose).toBe(owned.facts.purpose);
        expect(facts.architecture).toEqual(owned.facts.architecture);
        expect(facts.firstTasks).toEqual(owned.facts.firstTasks);
        expect(facts.quickstart.commands).toContainEqual(owned.facts.quickstart.commands[0]);
        const manifest = JSON.parse(await readFile(join(output, "ANALYSIS_MANIFEST.json"), "utf8"));
        expect(manifest.repository.branch).toBe(ref);
        expect(manifest.repository.commitSha).toBe(owned.sha);
        const docs = new Map<string, string>();
        for (const name of documentNames)
          docs.set(
            name,
            await readFile(join(output, name + (format === "markdown" ? ".md" : ".html")), "utf8")
          );
        for (const name of ["CODEMAP", "ARCHITECTURE", "FIRST_TASKS"]) {
          const doc = docs.get(name)!;
          for (const [index, path] of validFiles.entries()) {
            if (format === "markdown")
              expect(doc).toContain(
                `[${literalPath(path, name === "ARCHITECTURE")}](${sourceUrls[index]})`
              );
            else {
              expect(doc).toContain(`href="${sourceUrls[index]}"`);
              expect(htmlCode(doc)).toContain(path);
            }
          }
          for (const path of rejectedPaths) {
            if (format === "markdown")
              expect(doc).toContain(literalPath(path, name === "ARCHITECTURE"));
            else
              expect(htmlCode(doc)).toContain(
                path.includes("outside") ? path : JSON.stringify(path)
              );
          }
          const links =
            format === "markdown"
              ? [...doc.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1])
              : [...doc.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
          const sourceLinks = links.filter(
            (link) => link.includes("/blob/") || link.startsWith("./src/")
          );
          expect(sourceLinks.length).toBeGreaterThan(0);
          expect(sourceLinks.every((link) => sourceUrls.includes(link))).toBe(true);
          expect(
            links.some((link) => /outside|%ED%A0|%ED%B0|%EF%BF%BD|ud800|udc00/.test(link))
          ).toBe(false);
        }
        const labels: [string, string[]][] = [
          ["BOOTCAMP", [directory]],
          ["ONBOARDING", [directory, testDirectory, docsDirectory]],
          ["CODEMAP", [directory, testDirectory, workflow]],
          ["ARCHITECTURE", [directory, testDirectory, workflow]],
        ];
        for (const [name, paths] of labels)
          for (const path of paths) {
            const doc = docs.get(name)!;
            if (format === "markdown")
              expect(doc).toContain(
                literalPath(path, ["ARCHITECTURE", "CODEMAP"].includes(name) && path !== directory)
              );
            else expect(htmlCode(doc)).toContain(path);
          }
        for (const name of ["ONBOARDING", "RUNBOOK"]) {
          if (format === "markdown") expect(docs.get(name)!).toContain(command);
          else expect(htmlCode(docs.get(name)!)).toContain(command);
        }
        if (format === "markdown")
          expect(docs.get("ARCHITECTURE")!).toContain("```typescript\n" + example + "\n```");
        else expect(htmlCode(docs.get("ARCHITECTURE")!)).toContain(example);
      }
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  }, 180_000);
  it("keeps local source links literal and rejects malformed/traversing relative destinations", async () => {
    const owned = await fixture();
    try {
      const { result, output } = await generate(owned, "markdown", undefined, true);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const codemap = await readFile(join(output, "CODEMAP.md"), "utf8");
      for (const [index, path] of validFiles.entries()) {
        const relative =
          (index === 0 ? "./src/" : "./src/core%60%5Blib%5D%28v2%29/") + encodedFiles[index];
        expect(codemap).toContain(`[${literalPath(path)}](${relative})`);
      }
      for (const path of rejectedPaths) expect(codemap).toContain(literalPath(path));
      expect(codemap).not.toMatch(/\]\([^\n)]*(?:outside|ud800|udc00|%EF%BF%BD)/);
      const architecture = await readFile(join(output, "ARCHITECTURE.md"), "utf8");
      expect(architecture).not.toContain("/blob/");
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  });
  it.each(["release/v2(candidate)", "release/v2#candidate", "release/v2%candidate"])(
    "retains the explicit clone-ref whitelist for %s",
    async (branch) => {
      const owned = await fixture();
      try {
        const { result } = await generate(owned, "markdown", branch);
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain("Branch contains unsafe characters");
      } finally {
        await rm(owned.base, { recursive: true, force: true });
      }
    }
  );
});
