import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { analyzeChangeImpact, buildImportGraph } from "../src/impact.js";
import type { FileInfo } from "../src/types.js";

const dirs: string[] = [];

async function makeRepo(
  files: Record<string, string>
): Promise<{ repoPath: string; fileInfos: FileInfo[] }> {
  const repoPath = await mkdtemp(join(tmpdir(), "bootcamp-graph2-"));
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

function fi(path: string): FileInfo {
  return { path, size: 1, isDirectory: false };
}

describe("impact import graph — modern TS/Python forms", () => {
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("resolves `import type`, combined default+named, dynamic import, and `export type`", async () => {
    const { repoPath, fileInfos } = await makeRepo({
      "src/types.ts": "export type T = number;\n",
      "src/util.ts": "export const u = 1;\nexport default u;\n",
      "src/lazy.ts": "export const z = 1;\n",
      "src/index.ts":
        'import type { T } from "./types.js";\n' +
        'import U, { u } from "./util.js";\n' +
        'export type { T } from "./types.js";\n' +
        'export async function load() { return import("./lazy.js"); }\n',
    });
    const graph = await buildImportGraph(repoPath, fileInfos);
    const imports = graph.get("src/index.ts")?.imports ?? [];
    expect(imports).toContain("src/types.ts");
    expect(imports).toContain("src/util.ts");
    expect(imports).toContain("src/lazy.ts");
    expect(graph.get("src/types.ts")?.importedBy).toContain("src/index.ts");
  });

  it("resolves Python relative and package-absolute imports", async () => {
    const { repoPath, fileInfos } = await makeRepo({
      "pkg/__init__.py": "",
      "pkg/a.py": "from .b import thing\nfrom pkg.c import other\n",
      "pkg/b.py": "thing = 1\n",
      "pkg/c.py": "other = 2\n",
    });
    const graph = await buildImportGraph(repoPath, fileInfos);
    const imports = graph.get("pkg/a.py")?.imports ?? [];
    expect(imports).toContain("pkg/b.py");
    expect(imports).toContain("pkg/c.py");
    expect(graph.get("pkg/b.py")?.importedBy).toContain("pkg/a.py");
  });

  it("finds co-located tests for a repo-root file (dirname '.')", async () => {
    const files = [fi("index.ts"), fi("index.test.ts"), fi("index.spec.ts")];
    const impact = await analyzeChangeImpact("/repo", files, "index.ts", new Map());
    expect(impact.affectedTests).toContain("index.test.ts");
    expect(impact.affectedTests).toContain("index.spec.ts");
  });

  it("does not tie every docs/ file to an unrelated target", async () => {
    const files = [fi("src/auth.ts"), fi("docs/deployment.md"), fi("docs/auth.md")];
    const impact = await analyzeChangeImpact("/repo", files, "src/auth.ts", new Map());
    expect(impact.affectedDocs).toContain("docs/auth.md");
    expect(impact.affectedDocs).not.toContain("docs/deployment.md");
  });
});
