import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { cargoManifest, hasCargoTasks } from "../src/cargo-tasks.js";
import { scanRepo } from "../src/ingest.js";
import { discoverTasks, suggestGettingStarted } from "../src/tasks.js";

const packageManifest = '[package]\nname="owned"\nversion="0.1.0"\nedition="2021"\n';
const source = "pub fn answer() -> u32 { 42 }\n";
const dirs: string[] = [];
async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cargo-tasks-owned-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs.length = 0;
});

describe("literal Cargo qualification", () => {
  it("recognizes quoted tables/keys and flag order without flattening dotted names", () => {
    expect(cargoManifest('["package"] # Native table\n"autobins"=false\nname="owned"\n')).toEqual({
      package: { name: "owned", autobins: false, autolib: true },
    });
    expect(cargoManifest("[package]\nname.workspace=true\n")).toBeUndefined();
  });
  it("shields incidental declarations in multiline strings/comments/arrays", () => {
    expect(
      cargoManifest(
        '[tool]\nexample="""\n[package]\nname="fake"\n"""\nvalues=["[workspace]", "members=[]"]\n# [package]\n'
      )
    ).toBeUndefined();
    expect(
      cargoManifest(
        packageManifest + '[package.metadata]\nexample="""\n[[bin]]\npath="outside.rs"\n"""\n'
      )
    ).toEqual({ package: { name: "owned", autolib: true, autobins: true } });
  });
  it("recognizes multiline literal member/default arrays with comments", () => {
    expect(
      cargoManifest(
        '[workspace]\nmembers=[\n "crates/core", # Library\n "crates/app",\n]\ndefault-members=["crates/core"]\n'
      )
    ).toEqual({ workspace: { members: ["crates/core", "crates/app"], defaults: ["crates/core"] } });
  });
  it.each([
    "[package]\nname=42",
    '[package]\nname=""',
    '[package]\nname="owned"\nautobins="false"',
    '[package]\nname="owned"\nname="other"',
    '[package]\nname="owned"\n[package]\nname="other"',
    '[package]\nname="owned"\nworkspace=".."',
    '[package]\nname="owned"\n[lib]\npath="custom.rs"',
    '[package]\nname="owned"\n[[bin]]\npath="custom.rs"',
    "[workspace]\nmembers=[]",
    '[workspace]\nmembers=["crates/*"]',
    '[workspace]\nmembers=["../outside"]',
    '[workspace]\nmembers=["crates/core","crates/core"]',
    '[workspace]\nmembers=["crates/core"]\nexclude=[]',
    '[workspace]\nmembers=["crates/core"]\ndefault-members=["crates/app"]',
    '[workspace]\nmembers=["crates/core"]\ndefault-members=[]',
    '[package]\nname="owned"\n[package.metadata]\nexample="""unfinished',
    '[package]\nname="owned"\n[package.metadata]\nvalues=["unfinished"',
    "[workspace]\nmembers=[" + Array.from({ length: 65 }, (_, i) => `"crate${i}"`).join(",") + "]",
  ])("keeps unsupported/relevant invalid manifest unknown: %s", (content) => {
    expect(cargoManifest(content)).toBeUndefined();
  });
});

describe("Cargo task discovery", () => {
  it.each(["src/lib.rs", "src/main.rs", "src/bin/one.rs", "src/bin/one/main.rs"])(
    "uses only native build/test defaults for implicit target %s",
    async (target) => {
      const dir = await fixture({ "Cargo.toml": packageManifest, [target]: source });
      const tasks = await discoverTasks(dir);
      expect(tasks).toEqual([
        { name: "build", command: "cargo build", source: "Cargo.toml", category: "build" },
        { name: "test", command: "cargo test", source: "Cargo.toml", category: "test" },
      ]);
      expect(suggestGettingStarted(tasks).map((t) => t.command)).toEqual([
        "cargo build",
        "cargo test",
      ]);
    }
  );
  it("preserves other ecosystems and never picks a binary from multiple targets", async () => {
    const dir = await fixture({
      "Cargo.toml": packageManifest,
      "src/bin/one.rs": source,
      "src/bin/two.rs": source,
      "package.json": JSON.stringify({ scripts: { build: "echo build", test: "echo test" } }),
    });
    const tasks = await discoverTasks(dir);
    expect(tasks.map((t) => t.command)).toEqual([
      "npm run build",
      "npm run test",
      "cargo build",
      "cargo test",
    ]);
    expect(suggestGettingStarted(tasks).map((t) => t.command)).toEqual([
      "npm run build",
      "npm run test",
    ]);
  });
  it("qualifies virtual/default-member, selected-member and root-package workspaces", async () => {
    const dir = await fixture({
      "Cargo.toml":
        '[workspace]\nmembers=["crates/core","crates/app"]\ndefault-members=["crates/core"]\nresolver="2"\n',
      "crates/core/Cargo.toml": packageManifest.replace('"owned"', '"core"'),
      "crates/core/src/lib.rs": source,
      "crates/app/Cargo.toml": packageManifest.replace('"owned"', '"app"'),
      "crates/app/src/main.rs": source,
      "docs/README.md": "# Documentation",
    });
    expect(await hasCargoTasks(dir)).toBe(true);
    expect(await hasCargoTasks(join(dir, "crates/core"))).toBe(true);
    expect(await hasCargoTasks(join(dir, "docs"))).toBe(false);
    await writeFile(
      join(dir, "Cargo.toml"),
      packageManifest + '[workspace]\nmembers=["crates/core","crates/app"]\nresolver="2"\n'
    );
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/lib.rs"), source);
    expect(await hasCargoTasks(dir)).toBe(true);
  });
  it("does not qualify missing/disabled targets or missing/nonpackage/nested members", async () => {
    const dir = await fixture({ "Cargo.toml": packageManifest });
    expect(await hasCargoTasks(dir)).toBe(false);
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/lib.rs"), source);
    await writeFile(join(dir, "Cargo.toml"), packageManifest + "autolib=false\nautobins=false\n");
    expect(await hasCargoTasks(dir)).toBe(false);
    await writeFile(join(dir, "Cargo.toml"), '[workspace]\nmembers=["child"]\n');
    expect(await hasCargoTasks(dir)).toBe(false);
    await mkdir(join(dir, "child"));
    await writeFile(join(dir, "child/Cargo.toml"), '[workspace]\nmembers=["nested"]\n');
    expect(await hasCargoTasks(dir)).toBe(false);
  });
  it("requires all qualifying manifests and targets in the selected inventory", async () => {
    const dir = await fixture({
      "Cargo.toml": '[workspace]\nmembers=["child"]\n',
      "child/Cargo.toml": packageManifest,
      "child/src/lib.rs": source,
    });
    const all = ["Cargo.toml", "child/Cargo.toml", "child/src/lib.rs"];
    expect(await hasCargoTasks(dir, { files: new Set(all) })).toBe(true);
    for (const omitted of all)
      expect(await hasCargoTasks(dir, { files: new Set(all.filter((p) => p !== omitted)) })).toBe(
        false
      );
  });
  it("does not advertise a workspace with duplicate package names", async () => {
    const dir = await fixture({
      "Cargo.toml": '[workspace]\nmembers=["one","two"]\n',
      "one/Cargo.toml": packageManifest,
      "one/src/lib.rs": source,
      "two/Cargo.toml": packageManifest,
      "two/src/lib.rs": source,
    });
    expect(await discoverTasks(dir)).toEqual([]);
  });
  it("rejects escaping symlinks for manifests, members and targets", async () => {
    const outside = await fixture({ "Cargo.toml": packageManifest, "src/lib.rs": source });
    const root = await fixture({});
    await symlink(join(outside, "Cargo.toml"), join(root, "Cargo.toml"));
    expect(await hasCargoTasks(root)).toBe(false);
    await rm(join(root, "Cargo.toml"));
    await writeFile(join(root, "Cargo.toml"), packageManifest);
    await symlink(join(outside, "src"), join(root, "src"));
    expect(await hasCargoTasks(root)).toBe(false);
    await rm(join(root, "src"));
    await writeFile(join(root, "Cargo.toml"), '[workspace]\nmembers=["child"]\n');
    await symlink(outside, join(root, "child"));
    expect(await hasCargoTasks(root)).toBe(false);
  });
  it("does not cross the cumulative manifest evidence budget", async () => {
    const dir = await fixture({
      "Cargo.toml":
        packageManifest + '[package.metadata]\nlarge="' + "x".repeat(2 * 1024 * 1024) + '"\n',
      "src/lib.rs": source,
    });
    expect(await hasCargoTasks(dir)).toBe(false);
  });
  it("respects scan exclusions/limits/child scopes and fingerprints loaded Cargo evidence", async () => {
    const dir = await fixture({
      "Cargo.toml": '[workspace]\nmembers=["child"]\n',
      "child/Cargo.toml": packageManifest,
      "child/src/lib.rs": source,
    });
    const first = await scanRepo(dir, 100);
    expect(first.commands.map((c) => c.command)).toEqual(["cargo build", "cargo test"]);
    expect(first.cargoFingerprint).toMatch(/^[a-f0-9]{64}$/);
    await writeFile(join(dir, "child/Cargo.toml"), packageManifest.replace("0.1.0", "0.2.0"));
    const second = await scanRepo(dir, 100);
    expect(second.commands).toEqual(first.commands);
    expect(second.cargoFingerprint).not.toBe(first.cargoFingerprint);
    for (const excluded of ["Cargo.toml", "child/Cargo.toml", "child/src/lib.rs"])
      expect((await scanRepo(dir, 100, { exclude: [excluded] })).commands).toEqual([]);
    expect((await scanRepo(dir, 1)).commands).toEqual([]);
    expect((await scanRepo(dir, 100, { subdir: "child" })).commands).toEqual(first.commands);
  });
});
