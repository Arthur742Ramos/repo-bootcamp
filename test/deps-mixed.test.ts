import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  extractDependencies,
  generateDependencyDiagram,
  generateDependencyDocs,
} from "../src/deps.js";
import { markdownToHtml } from "../src/formatter.js";

const dirs: string[] = [];
async function fixture(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-mixed-deps-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const python = '[project]\ndependencies = ["fastapi>=0.110", "uvicorn>=0.29", "typer>=0.12"]\n';

describe("selected-root mixed dependencies", () => {
  it("retains Python runtime beside formatting-only Node tooling, including uncategorized graph nodes", async () => {
    const result = (await extractDependencies(
      await fixture({
        "package.json": JSON.stringify({ devDependencies: { prettier: "^3" } }),
        "pyproject.toml": python,
      })
    ))!;
    expect(result.packageManager).toBe("npm");
    expect(result.packageManagers).toEqual(["npm", "pip"]);
    expect(result.totalCount).toBe(4);
    expect(result.runtime.map((dep) => dep.name)).toEqual(["fastapi", "uvicorn", "typer"]);
    expect(
      result.runtime.every(
        (dep) => dep.ecosystem === "python" && dep.sourceFile === "pyproject.toml"
      )
    ).toBe(true);
    expect(result.dev).toEqual([
      {
        name: "prettier",
        version: "^3",
        type: "dev",
        ecosystem: "node",
        sourceFile: "package.json",
      },
    ]);
    const diagram = generateDependencyDiagram(result, "app");
    expect(diagram).toContain('Runtime_0["fastapi (python)"]');
    expect(diagram).toContain('Dev_0["prettier (node)"]');
    const doc = generateDependencyDocs(result, "app");
    expect(doc).not.toContain("No runtime dependencies found");
    expect(doc).toContain("| fastapi | >=0.110 | python | pyproject.toml |");
    expect(markdownToHtml(doc)).toContain("<td>fastapi</td>");
  });

  it("keeps equal names across all four ecosystems and Node optional/peer types", async () => {
    const result = (await extractDependencies(
      await fixture({
        "package.json": JSON.stringify({
          dependencies: { shared: "1" },
          optionalDependencies: { optional: "2" },
          peerDependencies: { peer: "3" },
          devDependencies: { shared: "4" },
        }),
        "Cargo.toml": '[dependencies]\nshared = "5"\n[dev-dependencies]\ntooling = "6"',
        "requirements.txt": "shared==7\n",
        "go.mod": "module demo\nrequire shared v8.0.0\n",
      })
    ))!;
    expect(result.packageManagers).toEqual(["npm", "cargo", "pip", "go"]);
    expect(result.totalCount).toBe(8);
    expect(
      result.runtime.map((dep) => [dep.name, dep.type, dep.ecosystem, dep.sourceFile])
    ).toEqual([
      ["shared", "runtime", "node", "package.json"],
      ["optional", "optional", "node", "package.json"],
      ["shared", "runtime", "rust", "Cargo.toml"],
      ["shared", "runtime", "python", "requirements.txt"],
      ["shared", "runtime", "go", "go.mod"],
    ]);
    expect(result.dev.map((dep) => dep.name)).toEqual(["shared", "tooling"]);
    expect(result.peer[0]).toMatchObject({ name: "peer", type: "peer", ecosystem: "node" });
    const diagram = generateDependencyDiagram(result, "app");
    expect(diagram).toContain('Runtime_0["shared (node)"]');
    expect(diagram).toContain('Runtime_2["shared (rust)"]');
    expect(diagram).toContain('Runtime_3["shared (python)"]');
    expect(diagram).toContain('Runtime_4["shared (go)"]');
    expect(diagram).toContain('Dev_0["shared (node)"]');
    expect(diagram).toContain('Peer_0["peer (node)"]');
    expect(generateDependencyDocs(result, "app")).toContain("## Peer Dependencies");
  });

  it("returns exact Python-only objects when an empty or malformed Node manifest contributes nothing", async () => {
    const only = await extractDependencies(await fixture({ "pyproject.toml": python }));
    for (const manifest of ["{}", "invalid JSON"]) {
      const withNode = await extractDependencies(
        await fixture({ "pyproject.toml": python, "package.json": manifest })
      );
      expect(withNode).toEqual(only);
      expect(generateDependencyDocs(withNode!, "app")).toBe(generateDependencyDocs(only!, "app"));
      expect(generateDependencyDiagram(withNode!, "app")).toBe(
        generateDependencyDiagram(only!, "app")
      );
    }
    expect(only).not.toHaveProperty("packageManagers");
    expect(only!.runtime[0]).not.toHaveProperty("ecosystem");
  });

  it("preserves the exact empty npm fallback and absent-manifest null", async () => {
    expect(await extractDependencies(await fixture({ "package.json": "{}" }))).toEqual({
      packageManager: "npm",
      totalCount: 0,
      runtime: [],
      dev: [],
      peer: [],
      categories: [],
    });
    expect(await extractDependencies(await fixture({ "package.json": "malformed" }))).toBeNull();
    expect(await extractDependencies(await fixture({}))).toBeNull();
  });

  it("does not read parent or nested manifests, and retains existing Python source precedence", async () => {
    const parent = await fixture({
      "package.json": JSON.stringify({ dependencies: { outer: "1" } }),
      "child/pyproject.toml": python,
      "child/requirements.txt": "ignored==1",
      "child/nested/go.mod": "require nested v1",
    });
    const result = (await extractDependencies(join(parent, "child")))!;
    expect(result.runtime.map((dep) => dep.name)).toEqual(["fastapi", "uvicorn", "typer"]);
    expect(result).not.toHaveProperty("packageManagers");
  });

  it("keeps mixed table payloads in four cells and graph identifiers unique for colliding names", async () => {
    const result = (await extractDependencies(
      await fixture({
        "package.json": JSON.stringify({ dependencies: { "shared|name\\x": "^1 || ^2\\path" } }),
        "Cargo.toml": '[dependencies]\nshared_name_x = "1"',
      })
    ))!;
    const html = markdownToHtml(generateDependencyDocs(result, "app"));
    expect(html).toContain("<td>shared|name\\x</td>");
    expect(html).toContain("<td>^1 || ^2\\path</td>");
    expect(html).toContain("<td>node</td><td>package.json</td>");
    const diagram = generateDependencyDiagram(result, "app");
    expect(diagram).toContain("Runtime_0[");
    expect(diagram).toContain("Runtime_1[");
  });

  it("retains runtime/dev graph and documentation caps on mixed results", async () => {
    const result = (await extractDependencies(
      await fixture({
        "package.json": JSON.stringify({
          dependencies: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`run${i}`, "1"])),
          devDependencies: Object.fromEntries(
            Array.from({ length: 31 }, (_, i) => [`dev${i}`, "1"])
          ),
        }),
        "requirements.txt": "python==1",
      })
    ))!;
    const diagram = generateDependencyDiagram(result, "app");
    expect(diagram).toContain('Runtime_more["+42 more"]');
    expect(diagram).toContain('Dev_more["+23 more"]');
    const doc = generateDependencyDocs(result, "app");
    expect(doc).toContain("| ... | +2 more | | |");
    expect(doc).toContain("| ... | +1 more | | |");
  });
});
