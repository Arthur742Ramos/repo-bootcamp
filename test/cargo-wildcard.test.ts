import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { hasCargoTasks } from "../src/cargo-tasks.js";
import { cargoDependencies, cargoMemberTopology } from "../src/cargo-workspace.js";
import { scanRepo } from "../src/ingest.js";
import { discoverTasks, suggestGettingStarted } from "../src/tasks.js";
const source = "pub fn owned() {}\n";
const pkg = (name: string) => `[package]\nname="${name}"\nversion="0.1.0"\nedition="2021"\n`;
const ws = '[workspace]\nmembers=["crates/*"]\nresolver="2"\n';
const dirs: string[] = [];
async function fixture(extra: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cargo-wildcard-owned-"));
  dirs.push(dir);
  const files = {
    "Cargo.toml": ws,
    "crates/a/Cargo.toml": pkg("owned_a"),
    "crates/a/src/lib.rs": source,
    "crates/b/Cargo.toml": pkg("owned_b"),
    "crates/b/src/lib.rs": source,
    ...extra,
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("bounded closed declared Cargo wildcards", () => {
  it.each([undefined, '["crates/b"]'])(
    "qualifies all declared packages with default %s",
    async (defaults) => {
      const dir = await fixture({
        "Cargo.toml": ws + (defaults ? `default-members=${defaults}\n` : ""),
      });
      expect((await discoverTasks(dir)).map((t) => t.command)).toEqual([
        "cargo build",
        "cargo test",
      ]);
      expect((await scanRepo(dir, 100)).commands.map((t) => t.command)).toEqual([
        "cargo build",
        "cargo test",
      ]);
    }
  );
  it("qualifies a root package, mixed literal members and native hidden matches", async () => {
    const dir = await fixture({
      "Cargo.toml":
        pkg("owned_root") +
        '[workspace]\nmembers=["crates/*","tools/cli"]\ndefault-members=["tools/cli"]\nresolver="2"\n',
      "src/lib.rs": source,
      "tools/cli/Cargo.toml": pkg("owned_cli"),
      "tools/cli/src/main.rs": "fn main() {}\n",
      "crates/.hidden/Cargo.toml": pkg("owned_hidden"),
      "crates/.hidden/src/lib.rs": source,
      "crates/notes.txt": "Owned notes",
    });
    expect(await hasCargoTasks(dir)).toBe(true);
    expect((await cargoMemberTopology(dir, ["crates/*", "tools/cli"])).members).toEqual([
      "crates/.hidden",
      "crates/a",
      "crates/b",
      "tools/cli",
    ]);
  });
  it.each([
    "dependencies",
    "dev-dependencies",
    "build-dependencies",
    "target.'cfg(target_os = \"windows\")'.dependencies",
  ])("closes literal sibling paths in %s", async (table) => {
    const dir = await fixture({
      "crates/b/Cargo.toml": pkg("owned_b") + `[${table}]\nowned_a={path="../a"}\n`,
    });
    expect(await hasCargoTasks(dir)).toBe(true);
    await writeFile(
      join(dir, "crates/b/Cargo.toml"),
      pkg("owned_b") + `[${table}.owned_a]\npath="../a"\n`
    );
    expect(await hasCargoTasks(dir)).toBe(true);
  });
  it("allows a member path to the declared root without inferring an ancestor", async () => {
    const dir = await fixture({
      "Cargo.toml": pkg("owned_root") + ws,
      "src/lib.rs": source,
      "crates/b/Cargo.toml": pkg("owned_b") + '[dependencies]\nowned_root={path="../.."}\n',
    });
    expect(await hasCargoTasks(dir)).toBe(true);
  });
  it.each(["1", "1.2", "1.2.3", "^1.2", "~0.1", "*"])(
    "proves literal registry version %s cannot add members",
    async (version) => {
      const dir = await fixture({
        "crates/b/Cargo.toml": pkg("owned_b") + `[dependencies]\nowned_registry="${version}"\n`,
      });
      expect(await hasCargoTasks(dir)).toBe(true);
    }
  );
  it.each([
    '[dependencies]\nowned_internal={path="../../internal"}\n',
    '[dev-dependencies]\nowned_internal={path="../../internal"}\n',
    '[target.\'cfg(target_os="windows")\'.build-dependencies]\nowned_internal={path="../../internal"}\n',
    '[dependencies]\nowned_a={path="../a",optional=true}\n',
    '[dependencies]\nalias={path="../a",package="owned_a"}\n',
    "[dependencies]\nowned_a.workspace=true\n",
    '[dependencies]\nowned_a={version="1",path="../a"}\n',
    '[dependencies]\nowned_registry="not a version"\n',
    '[dependencies]\nowned_registry=""\n',
    '[dependencies.owned_a]\nversion="1"\n',
    '[target.\'cfg(target_os="windows")\']\ndependencies={owned_a={path="../a"}}\n',
    '[patch.crates-io]\nowned_a={path="../a"}\n',
    '[replace]\n"owned_a:0.1.0"={path="../a"}\n',
    '[dependencies]\nowned_a={path="../a"}\n[dependencies.owned_a]\npath="../a"\n',
  ])("omits unsupported or auto-member dependency projection %s", async (extra) => {
    const dir = await fixture({
      "crates/b/Cargo.toml": pkg("owned_b") + extra,
      "internal/Cargo.toml": pkg("owned_internal"),
      "internal/src/lib.rs": source,
    });
    expect(await hasCargoTasks(dir)).toBe(false);
  });
  it.each(['dependencies.owned_a.path="../a"\n', 'dependencies={owned_a={path="../a"}}\n'])(
    "does not overlook root syntax %s",
    async (extra) => {
      const dir = await fixture({ "crates/b/Cargo.toml": extra + pkg("owned_b") });
      expect(await hasCargoTasks(dir)).toBe(false);
    }
  );
  it("shields metadata examples, declines inheritance and cycles", async () => {
    const dir = await fixture({
      "crates/b/Cargo.toml":
        pkg("owned_b") +
        '[package.metadata]\nexample="""\n[dependencies]\nowned_internal={path="../../internal"}\n"""\n',
    });
    expect(await hasCargoTasks(dir)).toBe(true);
    await writeFile(
      join(dir, "Cargo.toml"),
      ws + '[workspace.dependencies]\nowned_a={path="crates/a"}\n'
    );
    expect(await hasCargoTasks(dir)).toBe(false);
    await writeFile(join(dir, "Cargo.toml"), ws);
    await writeFile(
      join(dir, "crates/a/Cargo.toml"),
      pkg("owned_a") + '[dependencies]\nowned_b={path="../b"}\n'
    );
    await writeFile(
      join(dir, "crates/b/Cargo.toml"),
      pkg("owned_b") + '[dependencies]\nowned_a={path="../a"}\n'
    );
    expect(await hasCargoTasks(dir)).toBe(false);
  });
  it.each([
    '[dev_dependencies]\nowned_internal={path="../../internal"}\n',
    '[build_dependencies.owned_internal]\npath="../../internal"\n',
    "[target.'cfg(unix)'.dev_dependencies]\nowned_internal={path=\"../../internal\"}\n",
    "[target.'cfg(unix)'.build_dependencies.owned_internal]\npath=\"../../internal\"\n",
    'dev_dependencies={owned_internal={path="../../internal"}}\n',
    'build_dependencies.owned_internal.path="../../internal"\n',
    "target={'cfg(unix)'={dependencies={owned_internal={path=\"../../internal\"}}}}\n",
  ])("does not ignore legacy or whole-inline dependency declarations %s", async (extra) => {
    const dir = await fixture({
      "Cargo.toml": ws + 'default-members=["crates/b"]\n',
      "crates/a/Cargo.toml": extra.startsWith("[")
        ? pkg("owned_a") + extra
        : extra + pkg("owned_a"),
      "internal/Cargo.toml": pkg("owned_internal"),
      "internal/src/lib.rs": source,
    });
    expect(await hasCargoTasks(dir)).toBe(false);
  });
  it.each([
    "version.workspace=true\n",
    "version={workspace=true}\n",
    "[package.version]\nworkspace=true\n",
    "[lints]\nworkspace=true\n",
  ])("omits unsupported package inheritance %s", async (extra) => {
    const dir = await fixture({
      "crates/a/Cargo.toml": pkg("owned_a").replace('version="0.1.0"\n', "") + extra,
    });
    expect(await hasCargoTasks(dir)).toBe(false);
  });
  it.each([
    '[workspace.package]\nversion="0.1.0"\n',
    'package={version="0.1.0"}\n',
    'package.version="0.1.0"\n',
    '[workspace.lints.rust]\nunsafe_code="forbid"\n',
  ])("omits unsupported workspace inheritance %s", async (extra) => {
    const dir = await fixture({ "Cargo.toml": ws + extra });
    expect(await hasCargoTasks(dir)).toBe(false);
  });
  it("does not treat a legacy project root package as a virtual workspace", async () => {
    const dir = await fixture({
      "Cargo.toml": '[project]\nname="owned_root"\nversion="0.1.0"\n' + ws,
      "src/lib.rs": source,
    });
    expect(await hasCargoTasks(dir)).toBe(false);
    await rm(join(dir, "src/lib.rs"));
    expect(await hasCargoTasks(dir)).toBe(false);
  });
  it("keeps legacy and inheritance examples inside metadata opaque", async () => {
    const dir = await fixture({
      "Cargo.toml": ws + "[workspace.metadata.project]\npackage={version={workspace=true}}\n",
      "crates/a/Cargo.toml":
        pkg("owned_a") +
        'description="""\n[dev_dependencies]\nowned_internal={path="../../internal"}\n"""\n' +
        '[package.metadata.dev_dependencies]\nowned_internal={path="../../internal"}\n' +
        "[package.metadata.project]\nversion.workspace=true\n",
    });
    expect(await hasCargoTasks(dir)).toBe(true);
  });
  it("requires all nondefault selected members and targets, including budget evidence", async () => {
    const dir = await fixture({ "Cargo.toml": ws + 'default-members=["crates/a"]\n' });
    for (const exclude of [["crates/b/**"], ["crates/b/Cargo.toml"], ["crates/b/src/lib.rs"]])
      expect((await scanRepo(dir, 100, { exclude })).commands).toEqual([]);
    expect((await scanRepo(dir, 3)).commands).toEqual([]);
    await mkdir(join(dir, "crates/notes"));
    await writeFile(join(dir, "crates/notes/README.md"), "Owned notes");
    expect(await hasCargoTasks(dir)).toBe(false);
  });
  it("keeps topology-only negative edits distinct despite identical selected content", async () => {
    const dir = await fixture();
    const options = { exclude: ["crates/b/**", "crates/c/**"] };
    const before = await scanRepo(dir, 100, options);
    await rm(join(dir, "crates/b"), { recursive: true });
    await mkdir(join(dir, "crates/c"));
    const after = await scanRepo(dir, 100, options);
    expect(before.files).toEqual(after.files);
    expect(before.commands).toEqual([]);
    expect(after.commands).toEqual([]);
    expect(before.cargoFingerprint).toBe(after.cargoFingerprint);
    expect(before.cargoWorkspaceFingerprint).not.toBe(after.cargoWorkspaceFingerprint);
  });
  it("invalidates loaded same-size manifest edits without mixing callback identities", async () => {
    const dir = await fixture({
      "Taskfile.yml": "version: '3'\ntasks:\n  check:\n    cmds: [echo owned]\n",
      "go.mod": "module example.invalid/owned\n",
      "owned.go": "package owned\n",
    });
    const before = await scanRepo(dir, 100);
    await writeFile(join(dir, "crates/a/Cargo.toml"), pkg("owned_z"));
    const after = await scanRepo(dir, 100);
    expect(before.files).toEqual(after.files);
    expect(before.cargoFingerprint).not.toBe(after.cargoFingerprint);
    expect(before.taskfileFingerprint).toBe(after.taskfileFingerprint);
    expect(before.goModFingerprint).toBe(after.goModFingerprint);
    expect(before.goPackageFingerprint).toBe(after.goPackageFingerprint);
    const reads: Array<[string, string]> = [],
      witness: Array<[string, string]> = [];
    await discoverTasks(dir, {
      onCargoRead: (p, c) => reads.push([p, c]),
      onCargoWorkspaceEvidence: (p, c) => witness.push([p, c]),
    });
    expect(reads.map(([p]) => p)).toEqual([
      "Cargo.toml",
      "crates/a/Cargo.toml",
      "crates/b/Cargo.toml",
    ]);
    for (const [p, c] of reads) expect(c).toBe(await readFile(join(dir, p), "utf8"));
    expect(witness).toHaveLength(1);
    expect(JSON.parse(witness[0][1]).qualified).toBe(true);
    await writeFile(join(dir, "Cargo.toml"), '[workspace]\nmembers=["crates/a","crates/b"]\n');
    const literal = await scanRepo(dir, 100);
    expect(literal.cargoWorkspaceFingerprint).toBeUndefined();
  });
  it("rejects member, manifest and implicit-source link ambiguity", async () => {
    const dir = await fixture();
    await rm(join(dir, "crates/b"), { recursive: true });
    await symlink(join(dir, "crates/a"), join(dir, "crates/b"), "dir");
    expect(await hasCargoTasks(dir)).toBe(false);
    await rm(join(dir, "crates/b"));
    await mkdir(join(dir, "crates/b/src"), { recursive: true });
    await symlink(join(dir, "crates/a/Cargo.toml"), join(dir, "crates/b/Cargo.toml"), "file");
    await writeFile(join(dir, "crates/b/src/lib.rs"), source);
    expect(await hasCargoTasks(dir)).toBe(false);
    await rm(join(dir, "crates/b/Cargo.toml"));
    await writeFile(join(dir, "crates/b/Cargo.toml"), pkg("owned_b"));
    await rm(join(dir, "crates/b/src/lib.rs"));
    await symlink(join(dir, "crates/a/src/lib.rs"), join(dir, "crates/b/src/lib.rs"), "file");
    expect(await hasCargoTasks(dir)).toBe(false);
  });
  it("keeps the cumulative manifest budget and records omitted entry type changes", async () => {
    const dir = await fixture();
    const options = { exclude: ["crates/b", "crates/b/**", "crates/a/src/lib.rs"] };
    const before = await scanRepo(dir, 100, options);
    await rm(join(dir, "crates/b"), { recursive: true });
    await writeFile(join(dir, "crates/b"), "Owned regular file");
    const after = await scanRepo(dir, 100, options);
    expect(before.files).toEqual(after.files);
    expect(before.commands).toEqual([]);
    expect(after.commands).toEqual([]);
    expect(before.cargoFingerprint).toBe(after.cargoFingerprint);
    expect(before.cargoWorkspaceFingerprint).not.toBe(after.cargoWorkspaceFingerprint);
    const large = await fixture({
      "Cargo.toml": ws + "#" + "x".repeat(1024 * 1024),
      "crates/a/Cargo.toml": pkg("owned_a") + "#" + "x".repeat(1024 * 1024),
    });
    const reads: string[] = [];
    expect(await hasCargoTasks(large, { onRead: (path) => reads.push(path) })).toBe(false);
    expect(reads).toEqual(["Cargo.toml"]);
  });
  it("keeps other declared commands first and omits ambiguous overlaps/defaults", async () => {
    const dir = await fixture({ Makefile: "build:\n\t@echo owned\ntest:\n\t@echo owned\n" });
    expect(suggestGettingStarted(await discoverTasks(dir)).map((t) => t.command)).toEqual([
      "make build",
      "make test",
    ]);
    for (const manifest of [
      '[workspace]\nmembers=["crates/*","crates/a"]\n',
      ws + 'default-members=["missing"]\n',
      ws + "default-members=[]\n",
      ws + "exclude=[]\n",
    ]) {
      await writeFile(join(dir, "Cargo.toml"), manifest);
      expect(await hasCargoTasks(dir)).toBe(false);
    }
  });
  it("bounds complete member/topology enumeration and dependency declarations", async () => {
    expect(
      await cargoMemberTopology(
        "unused-owned-root",
        Array.from({ length: 65 }, (_, i) => `prefix${i}/*`)
      )
    ).toEqual({ status: "prefix-limit", prefixes: [] });
    const dir = await fixture();
    for (let i = 0; i < 62; i++) {
      await mkdir(join(dir, `crates/c${i}/src`), { recursive: true });
      await writeFile(join(dir, `crates/c${i}/Cargo.toml`), pkg(`owned_c${i}`));
      await writeFile(join(dir, `crates/c${i}/src/lib.rs`), source);
    }
    expect(await hasCargoTasks(dir)).toBe(true);
    await mkdir(join(dir, "crates/extra"));
    expect((await cargoMemberTopology(dir, ["crates/*"])).status).toBe("member-limit");
    expect(await hasCargoTasks(dir)).toBe(false);
    const flat = await fixture();
    for (let i = 0; i < 510; i++) await writeFile(join(flat, `crates/notes${i}`), "Owned");
    expect(await hasCargoTasks(flat)).toBe(true);
    await writeFile(join(flat, "crates/extra-note"), "Owned");
    const first = await cargoMemberTopology(flat, ["crates/*"]);
    expect(first).toEqual({
      status: "entry-limit",
      prefixes: [{ path: "crates", type: "directory" }],
    });
    const content =
      pkg("owned") +
      "[dependencies]\n" +
      Array.from({ length: 513 }, (_, i) => `registry${i}="1"`).join("\n");
    expect(cargoDependencies(content)).toBeUndefined();
  });
});
