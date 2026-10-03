import { execFileSync } from "child_process";
import { mkdtemp, realpath, rm, writeFile } from "fs/promises";
import { join, relative } from "path";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
// Vitest transforms URL specifiers itself; use Node's native importer for path identity.
async function loadPlugins(paths: string[]) {
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(join(process.cwd(), "node_modules/tsx/dist/loader.mjs")).href,
      "--input-type=module",
      "-e",
      `const {loadPlugins}=await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "src/plugins.ts")).href)});
     const warnings=[];console.log=()=>{};console.warn=(...args)=>warnings.push(args.join(' '));
     const plugins=await loadPlugins(${JSON.stringify(paths)});
     process.stdout.write(JSON.stringify({plugins:plugins.map(({name})=>({name})),warnings}));`,
    ],
    { encoding: "utf8", timeout: 15_000 }
  );
  const result = JSON.parse(output) as { plugins: { name: string }[]; warnings: string[] };
  for (const warning of result.warnings) console.warn(warning);
  return result.plugins;
}
const tempDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const dir = await mkdtemp(join(process.cwd(), "bootcamp-plugin-path-"));
  tempDirs.push(dir);
  vi.spyOn(console, "log").mockImplementation(() => {});
  return dir;
}
const analyzer = (name: string) =>
  `export default {name:${JSON.stringify(name)},analyze:async()=>({docs:[]})};`;
describe("literal local plugin paths", () => {
  it.each(["absolute", "relative"])(
    "loads %s space, hash, and percent filenames exactly",
    async (kind) => {
      const dir = await fixture();
      await writeFile(join(dir, "formatter.mjs"), analyzer("wrong-prefix"));
      const names = ["plugin space.mjs", "formatter.mjs#copy.mjs", "plugin%notes.mjs"];
      const paths = [];
      for (const name of names) {
        const path = join(dir, name);
        await writeFile(path, analyzer(name));
        paths.push(kind === "absolute" ? path : `./${relative(process.cwd(), path)}`);
      }
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect((await loadPlugins(paths)).map((plugin) => plugin.name)).toEqual(names);
      expect(warn).not.toHaveBeenCalled();
    }
  );
  it("preserves explicit file URL query and fragment semantics", async () => {
    const dir = await fixture();
    const path = join(dir, "plugin#notes.mjs");
    await writeFile(path, "export default {name:import.meta.url,analyze:async()=>({docs:[]})};");
    const base = pathToFileURL(await realpath(path)).href;
    const urls = [base + "?variant=one#first", base + "?variant=two#second"];
    expect((await loadPlugins(urls)).map((plugin) => plugin.name)).toEqual(urls);
  });
  it("retains analyzer, named formatter, and output-target export shapes", async () => {
    const dir = await fixture();
    const modules = [
      analyzer("analyzer"),
      "export const name='formatter';export const type='formatter';export const formatDocuments=async docs=>docs;",
      "export default {name:'output',type:'output-target',writeOutput:async()=>{}};",
    ];
    const paths = [];
    for (const [index, source] of modules.entries()) {
      const path = join(dir, `kind ${index}#%.mjs`);
      await writeFile(path, source);
      paths.push(path);
    }
    expect((await loadPlugins(paths)).map((plugin) => plugin.name)).toEqual([
      "analyzer",
      "formatter",
      "output",
    ]);
  });
  it("preserves package, package-subpath, and explicit module URL imports", async () => {
    await fixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dataUrl = "data:text/javascript," + encodeURIComponent(analyzer("data-plugin"));
    expect(
      (
        await loadPlugins(["cosmiconfig", "typescript/lib/typescript.js", "node:path", dataUrl])
      ).map((plugin) => plugin.name)
    ).toEqual(["data-plugin"]);
    expect(warn).not.toHaveBeenCalled();
  });
  it("warns on a failed module and continues to a valid literal path", async () => {
    const dir = await fixture();
    const valid = join(dir, "valid#%.mjs");
    await writeFile(valid, analyzer("valid"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      (await loadPlugins([join(dir, "missing.mjs"), valid])).map((plugin) => plugin.name)
    ).toEqual(["valid"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to load plugin"));
  });
});
