import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { writeGeneratedOutputs } from "../src/services/output-writer.js";
import type { BootcampOptions, RepoFacts, RepoInfo } from "../src/types.js";
import type { ProgressTracker } from "../src/progress.js";

function params(outputDir: string, documents: { name: string; content: string }[]) {
  return {
    outputDir,
    documents,
    outputFormat: "html" as const,
    options: {} as BootcampOptions,
    repoInfo: { owner: "local", repo: "inventory", fullName: "local/inventory" } as RepoInfo,
    facts: { firstTasks: [] } as unknown as RepoFacts,
    progress: { update() {} } as unknown as ProgressTracker,
  };
}

describe("successful output filesystem identity", () => {
  it.each([false, true])(
    "uses stored spelling and preserves distinct files with output alias=%s",
    async (alias) => {
      const root = await mkdtemp(join(tmpdir(), "bootcamp-output-identity-"));
      try {
        const actual = join(root, "OwnedOutput");
        await mkdir(actual);
        const output = alias ? join(root, "output-alias") : actual;
        if (alias) await symlink(actual, output, "junction");
        await writeFile(join(actual, "UNRELATED.txt"), "untouched");
        const result = await writeGeneratedOutputs(
          params(output, [
            { name: "BOOTCAMP.md", content: "first" },
            { name: "bootcamp.md", content: "second" },
            { name: "SUMMARY.json", content: "first metadata" },
            { name: "./summary.json", content: "second metadata" },
          ])
        );
        const files = (await readdir(actual)).filter((name) => name !== "UNRELATED.txt").sort();
        expect(result.emittedFiles.sort()).toEqual(files);
        expect(result.documentCount).toBe(4);
        const upper = await stat(join(actual, "BOOTCAMP.html"));
        const lower = await stat(join(actual, "bootcamp.html"));
        if (upper.dev === lower.dev && upper.ino === lower.ino) {
          expect(files).toEqual(["BOOTCAMP.html", "SUMMARY.json"]);
          expect(await realpath(join(output, "bootcamp.html"))).toBe(
            await realpath(join(actual, "BOOTCAMP.html"))
          );
        } else {
          expect(files).toEqual(["BOOTCAMP.html", "SUMMARY.json", "bootcamp.html", "summary.json"]);
          expect(await readFile(join(actual, "BOOTCAMP.html"), "utf8")).toContain("first");
        }
        expect(await readFile(join(actual, "UNRELATED.txt"), "utf8")).toBe("untouched");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it("records literal backslashes using native path semantics and existing external destinations", async () => {
    const root = await mkdtemp(join(tmpdir(), "bootcamp-output-destinations-"));
    try {
      const output = join(root, "out");
      await mkdir(join(output, "notes"), { recursive: true });
      const result = await writeGeneratedOutputs(
        params(output, [
          { name: "notes\\GUIDE.md", content: "guide" },
          { name: "../EXTERNAL.md", content: "external" },
        ])
      );
      expect(result.emittedFiles).toEqual([
        process.platform === "win32" ? "notes/GUIDE.html" : "notes\\GUIDE.html",
        "../EXTERNAL.html",
      ]);
      expect(await readFile(join(output, "notes\\GUIDE.html"), "utf8")).toContain("guide");
      expect(await readFile(join(root, "EXTERNAL.html"), "utf8")).toContain("external");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a failed write and preserves prior successful and unrelated files", async () => {
    const root = await mkdtemp(join(tmpdir(), "bootcamp-output-write-failure-"));
    try {
      await writeFile(join(root, "UNRELATED.txt"), "untouched");
      await mkdir(join(root, "BLOCK.html"));
      await expect(
        writeGeneratedOutputs(
          params(root, [
            { name: "FIRST.md", content: "first" },
            { name: "BLOCK.md", content: "blocked" },
          ])
        )
      ).rejects.toThrow();
      expect(await readFile(join(root, "FIRST.html"), "utf8")).toContain("first");
      expect(await readFile(join(root, "UNRELATED.txt"), "utf8")).toBe("untouched");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
