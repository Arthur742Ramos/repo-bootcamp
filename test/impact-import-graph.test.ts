import { mkdtemp, mkdir, rm, writeFile, symlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { buildImportGraph } from "../src/impact.js";
import type { FileInfo } from "../src/types.js";

const dirs: string[] = [];

async function makeRepo(
  files: Record<string, string>
): Promise<{ repoPath: string; fileInfos: FileInfo[] }> {
  const repoPath = await mkdtemp(join(tmpdir(), "bootcamp-graph-"));
  dirs.push(repoPath);
  const fileInfos: FileInfo[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoPath, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf-8");
    fileInfos.push({ path: rel, size: content.length, isDirectory: false });
  }
  return { repoPath, fileInfos };
}

describe("buildImportGraph import resolution", () => {
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("resolves ESM/TypeScript `.js` specifiers to their `.ts` source", async () => {
    const { repoPath, fileInfos } = await makeRepo({
      "src/util.ts": "export const add = (a: number, b: number): number => a + b;\n",
      "src/index.ts": 'import { add } from "./util.js";\n\nadd(1, 2);\n',
    });
    const graph = await buildImportGraph(repoPath, fileInfos);
    expect(graph.get("src/index.ts")?.imports).toContain("src/util.ts");
    expect(graph.get("src/util.ts")?.importedBy).toContain("src/index.ts");
  });

  it("resolves `.mjs` specifiers to their `.ts` source", async () => {
    const { repoPath, fileInfos } = await makeRepo({
      "src/helper.ts": "export const noop = (): void => {};\n",
      "src/app.ts": 'import { noop } from "./helper.mjs";\n\nnoop();\n',
    });
    const graph = await buildImportGraph(repoPath, fileInfos);
    expect(graph.get("src/app.ts")?.imports).toContain("src/helper.ts");
  });

  it("still resolves extensionless and index imports", async () => {
    const { repoPath, fileInfos } = await makeRepo({
      "src/lib/index.ts": "export const x = 1;\n",
      "src/main.ts": 'import { x } from "./lib";\n\nexport const y = x;\n',
    });
    const graph = await buildImportGraph(repoPath, fileInfos);
    expect(graph.get("src/main.ts")?.imports).toContain("src/lib/index.ts");
  });

  it("prefers a real `.js` file over a same-named `.ts` source", async () => {
    const { repoPath, fileInfos } = await makeRepo({
      "src/legacy.js": "export default {};\n",
      "src/legacy.ts": "export const y = 2;\n",
      "src/consumer.ts": 'import legacy from "./legacy.js";\n\nexport const z = legacy;\n',
    });
    const graph = await buildImportGraph(repoPath, fileInfos);
    expect(graph.get("src/consumer.ts")?.imports).toContain("src/legacy.js");
    expect(graph.get("src/legacy.ts")?.importedBy ?? []).not.toContain("src/consumer.ts");
  });

  it("resolves Go internal imports via the go.mod module prefix", async () => {
    const { repoPath, fileInfos } = await makeRepo({
      "go.mod": "module example.com/m\n\ngo 1.21\n",
      "main.go": 'package main\n\nimport "example.com/m/internal/x"\n\nfunc main() { x.Run() }\n',
      "internal/x/x.go": "package x\n\nfunc Run() {}\n",
    });
    const graph = await buildImportGraph(repoPath, fileInfos);
    expect(graph.get("main.go")?.imports).toContain("internal/x/x.go");
    expect(graph.get("internal/x/x.go")?.importedBy).toContain("main.go");
  });

  it("resolves every path in a grouped Go import block and skips stdlib", async () => {
    const { repoPath, fileInfos } = await makeRepo({
      "go.mod": "module mymod\n",
      "main.go": [
        "package main",
        "",
        "import (",
        '\t"fmt"',
        '\t"mymod/internal/a"',
        '\t"mymod/pkg/b"',
        ")",
        "",
        "func main() { fmt.Println(a.X, b.Y) }",
      ].join("\n"),
      "internal/a/a.go": "package a\n\nvar X = 1\n",
      "pkg/b/b.go": "package b\n\nvar Y = 2\n",
    });
    const graph = await buildImportGraph(repoPath, fileInfos);
    const imports = graph.get("main.go")?.imports ?? [];
    // Both grouped internal imports resolve (not just the last one).
    expect(imports).toContain("internal/a/a.go");
    expect(imports).toContain("pkg/b/b.go");
    // The stdlib "fmt" import has no module prefix, so it forms no internal edge.
    expect(imports).not.toContain("fmt");
  });

  it("resolves tsconfig `paths` aliases to their target files", async () => {
    const { repoPath, fileInfos } = await makeRepo({
      "tsconfig.json": '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
      "src/lib/db.ts": "export const db = 1;\n",
      "src/index.ts": 'import { db } from "@/lib/db";\n',
    });
    const graph = await buildImportGraph(repoPath, fileInfos);
    expect(graph.get("src/index.ts")?.imports).toContain("src/lib/db.ts");
    expect(graph.get("src/lib/db.ts")?.importedBy).toContain("src/index.ts");
  });

  it("resolves bare specifiers against tsconfig `baseUrl` (JSONC tolerated)", async () => {
    const { repoPath, fileInfos } = await makeRepo({
      // Includes a `//` comment and trailing comma to exercise JSONC parsing.
      "tsconfig.json": '{\n  // paths root\n  "compilerOptions": { "baseUrl": "src", },\n}',
      "src/helpers.ts": "export const u = 2;\n",
      "src/app.ts": 'import { u } from "helpers";\n',
    });
    const graph = await buildImportGraph(repoPath, fileInfos);
    expect(graph.get("src/app.ts")?.imports).toContain("src/helpers.ts");
  });

  it("still forms no edge for genuine external packages without an alias", async () => {
    const { repoPath, fileInfos } = await makeRepo({
      "src/app.ts": 'import express from "express";\nimport { x } from "@scope/pkg";\n',
    });
    const graph = await buildImportGraph(repoPath, fileInfos);
    expect(graph.get("src/app.ts")?.imports).toEqual([]);
  });

  it("refuses a go.mod symlinked outside the repo (does not read it)", async () => {
    const { repoPath, fileInfos } = await makeRepo({
      "main.go": 'package main\n\nimport "github.com/leaked/secret/internal/x"\n\nfunc main() { x.Run() }\n',
      "internal/x/x.go": "package x\n\nfunc Run() {}\n",
    });
    const outside = await mkdtemp(join(tmpdir(), "bootcamp-graph-outside-"));
    dirs.push(outside);
    await writeFile(join(outside, "go.mod"), "module github.com/leaked/secret\n", "utf-8");
    // A malicious repo commits go.mod as a symlink escaping the clone root; the
    // containment check must refuse it so the outside module prefix is never read
    // (else buildGraphContext would resolve the internal import as an edge).
    await symlink(join(outside, "go.mod"), join(repoPath, "go.mod"));

    const graph = await buildImportGraph(repoPath, fileInfos);
    expect(graph.get("main.go")?.imports ?? []).not.toContain("internal/x/x.go");
  });
});
