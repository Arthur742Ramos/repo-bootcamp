import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
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
});
