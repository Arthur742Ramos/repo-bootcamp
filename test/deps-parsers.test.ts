import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { extractDependencies, type Dependency } from "../src/deps.js";

const dirs: string[] = [];

async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bootcamp-deps-parse-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    await writeFile(join(dir, rel), content, "utf-8");
  }
  return dir;
}

function names(list: Dependency[]): string[] {
  return list.map((d) => d.name);
}

describe("dependency manifest parsers", () => {
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("npm: includes optionalDependencies", async () => {
    const dir = await repoWith({
      "package.json": JSON.stringify({
        name: "x",
        dependencies: { express: "^5.0.0" },
        optionalDependencies: { fsevents: "^2.3.0" },
      }),
    });
    const deps = await extractDependencies(dir);
    expect(deps?.packageManager).toBe("npm");
    expect(names(deps!.runtime)).toContain("fsevents");
    expect(deps!.totalCount).toBe(2);
  });

  it("Cargo: resets section state so [features]/[profile] are not parsed as deps", async () => {
    const dir = await repoWith({
      "Cargo.toml": [
        "[dependencies]",
        'serde = "1.0"',
        "[features]",
        'default = ["std"]',
        "std = []",
        "extra = []",
        "[profile.release]",
        "opt-level = 3",
        "lto = true",
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(deps?.packageManager).toBe("cargo");
    expect(names(deps!.runtime)).toEqual(["serde"]);
  });

  it("Cargo: parses inline-table and [dependencies.<crate>] versions", async () => {
    const dir = await repoWith({
      "Cargo.toml": [
        "[dependencies]",
        'serde = { version = "1.0", features = ["derive"] }',
        'anyhow = "1.0"',
        "[dependencies.tokio]",
        'version = "1.35"',
        'features = ["full"]',
        "[dev-dependencies]",
        'criterion = "0.5"',
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(deps!.runtime.find((d) => d.name === "serde")?.version).toBe("1.0");
    expect(deps!.runtime.find((d) => d.name === "tokio")?.version).toBe("1.35");
    expect(names(deps!.runtime)).not.toContain("version");
    expect(names(deps!.runtime).sort()).toEqual(["anyhow", "serde", "tokio"]);
    expect(names(deps!.dev)).toEqual(["criterion"]);
  });

  it("Cargo: classifies [build-dependencies] (and detailed tables) as dev", async () => {
    const dir = await repoWith({
      "Cargo.toml": [
        "[dependencies]",
        'serde = "1.0"',
        "[build-dependencies]",
        'cc = "1.0"',
        "[build-dependencies.bindgen]",
        'version = "0.69"',
        'features = ["runtime"]',
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(names(deps!.runtime)).toEqual(["serde"]);
    expect(names(deps!.dev).sort()).toEqual(["bindgen", "cc"]);
    // The detailed-table version still arrives on a later line.
    expect(deps!.dev.find((d) => d.name === "bindgen")?.version).toBe("0.69");
    expect(names(deps!.dev)).not.toContain("features");
  });

  it("Cargo: classifies [target.<spec>.dependencies] as runtime (cfg and triple)", async () => {
    const dir = await repoWith({
      "Cargo.toml": [
        "[target.'cfg(unix)'.dependencies]",
        'nix = "0.27"',
        "[target.x86_64-pc-windows-msvc.dependencies]",
        'winapi = "0.3"',
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(names(deps!.runtime).sort()).toEqual(["nix", "winapi"]);
    expect(deps!.dev).toHaveLength(0);
  });

  it("Cargo: classifies target dev/build deps as dev, target deps as runtime", async () => {
    const dir = await repoWith({
      "Cargo.toml": [
        "[target.'cfg(windows)'.build-dependencies]",
        'embed-resource = "2.4"',
        "[target.'cfg(unix)'.dev-dependencies]",
        'rstest = "0.18"',
        "[target.aarch64-apple-darwin.dependencies]",
        'core-foundation = "0.9"',
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(names(deps!.dev).sort()).toEqual(["embed-resource", "rstest"]);
    expect(names(deps!.runtime)).toEqual(["core-foundation"]);
  });

  it("Cargo: still ignores [features]/[profile] when build/target tables are present", async () => {
    const dir = await repoWith({
      "Cargo.toml": [
        "[dependencies]",
        'serde = "1.0"',
        "[features]",
        'default = ["std"]',
        "std = []",
        "[profile.release]",
        "opt-level = 3",
        "[build-dependencies]",
        'cc = "1.0"',
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(names(deps!.runtime)).toEqual(["serde"]);
    expect(names(deps!.dev)).toEqual(["cc"]);
    const all = names(deps!.runtime).concat(names(deps!.dev));
    expect(all).not.toContain("default");
    expect(all).not.toContain("opt-level");
    expect(all).not.toContain("std");
  });

  it("Cargo: dedups a crate present in both [dependencies] and a target table", async () => {
    const dir = await repoWith({
      "Cargo.toml": [
        "[dependencies]",
        'libc = "0.2"',
        "[target.'cfg(unix)'.dependencies]",
        'libc = "0.2.150"',
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(deps!.runtime.filter((d) => d.name === "libc")).toHaveLength(1);
    expect(deps!.runtime.find((d) => d.name === "libc")?.version).toBe("0.2.150");
  });

  it("Poetry: keeps deps after an inline-table line and parses versions", async () => {
    const dir = await repoWith({
      "pyproject.toml": [
        "[tool.poetry.dependencies]",
        'python = "^3.10"',
        'requests = "^2.31"',
        'black = { version = "^23.0", extras = ["d"] }',
        'flask = "^2.0"',
        "",
        "[tool.poetry.dev-dependencies]",
        'pytest = "^7.0"',
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(deps?.packageManager).toBe("poetry");
    expect(names(deps!.runtime)).toEqual(["requests", "black", "flask"]);
    expect(deps!.runtime.find((d) => d.name === "black")?.version).toBe("^23.0");
    expect(names(deps!.dev)).toEqual(["pytest"]);
  });

  it("Poetry 1.2+: parses [tool.poetry.group.<name>.dependencies] groups", async () => {
    const dir = await repoWith({
      "pyproject.toml": [
        "[tool.poetry.dependencies]",
        'python = "^3.11"',
        'httpx = "^0.27"',
        "[tool.poetry.group.dev.dependencies]",
        'pytest = "^8.0"',
        "[tool.poetry.group.test.dependencies]",
        'coverage = "^7.0"',
        "[tool.poetry.group.docs.dependencies]",
        'sphinx = "^7.0"',
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(deps?.packageManager).toBe("poetry");
    // dev + test groups → dev; runtime deps and other groups (docs) → runtime.
    expect(names(deps!.runtime).sort()).toEqual(["httpx", "sphinx"]);
    expect(names(deps!.dev).sort()).toEqual(["coverage", "pytest"]);
  });

  it("PEP 621: parses [project] dependencies and optional-dependencies", async () => {
    const dir = await repoWith({
      "pyproject.toml": [
        "[project]",
        'name = "myapp"',
        'requires-python = ">=3.10"',
        "dependencies = [",
        '  "flask>=2.0",',
        '  "requests[security]>=2.28",',
        '  "rich; python_version >= \'3.8\'",',
        "]",
        "[project.optional-dependencies]",
        'test = ["pytest>=7", "coverage"]',
        "[build-system]",
        'requires = ["hatchling"]',
        'build-backend = "hatchling.build"',
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(deps?.packageManager).toBe("pip");
    // Extras (`[security]`) and env markers (`; python_version …`) are stripped.
    expect(names(deps!.runtime).sort()).toEqual(["coverage", "flask", "pytest", "requests", "rich"]);
    expect(deps!.runtime.find((d) => d.name === "requests")?.version).toContain("2.28");
    // The build-system requires array must not leak in as a dependency.
    expect(names(deps!.runtime)).not.toContain("hatchling");
  });

  it("PEP 735: parses [dependency-groups] as dev dependencies", async () => {
    const dir = await repoWith({
      "pyproject.toml": [
        "[project]",
        'name = "x"',
        'dependencies = ["click"]',
        "[dependency-groups]",
        'dev = ["ruff", "mypy"]',
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(names(deps!.runtime)).toContain("click");
    expect(names(deps!.dev).sort()).toEqual(["mypy", "ruff"]);
  });

  it("PEP 621: does not split on commas inside an environment marker", async () => {
    const dir = await repoWith({
      "pyproject.toml": [
        "[project]",
        'name = "x"',
        "dependencies = [",
        '  "flask>=2.0",',
        "  \"pywin32; sys_platform in ('win32', 'cygwin')\",",
        "]",
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    // The comma inside the marker must not produce bogus win32/cygwin deps.
    expect(names(deps!.runtime).sort()).toEqual(["flask", "pywin32"]);
  });

  it("PEP 621: recognizes table headers with trailing inline comments", async () => {
    const dir = await repoWith({
      "pyproject.toml": [
        "[project]  # project metadata",
        'name = "x"',
        'dependencies = ["click"]',
        "[project.optional-dependencies]  # extras",
        'test = ["pytest"]',
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(names(deps!.runtime).sort()).toEqual(["click", "pytest"]);
  });

  it("requirements.txt: skips pip option/include lines", async () => {
    const dir = await repoWith({
      "requirements.txt": [
        "requests==2.31.0",
        "-r base.txt",
        "-e .",
        "--index-url https://pypi.org/simple",
        "flask>=2.0",
        "uvicorn[standard]>=0.20",
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(deps?.packageManager).toBe("pip");
    expect(names(deps!.runtime)).toEqual(["requests", "flask", "uvicorn"]);
    expect(deps!.runtime.find((d) => d.name === "requests")?.version).toBe("2.31.0");
  });

  it("requirements.txt: skips VCS, URL, archive, and local-path requirements", async () => {
    const dir = await repoWith({
      "requirements.txt": [
        "requests==2.31.0",
        "git+https://github.com/psf/requests.git#egg=requests2",
        "hg+https://bitbucket.org/x/y",
        "svn+https://svn.example.com/z",
        "https://example.com/pkg/archive.tar.gz",
        "./local/package",
        "/abs/path/pkg",
        "flask>=2.0",
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    // None of the VCS/URL/local lines should coin a bogus package name.
    expect(names(deps!.runtime).sort()).toEqual(["flask", "requests"]);
    expect(deps!.totalCount).toBe(2);
  });

  it("requirements.txt: keeps a normal requirement with a URL in its inline comment", async () => {
    const dir = await repoWith({
      "requirements.txt": [
        "requests==2.31.0  # see https://pypi.org/project/requests/",
        "flask>=2.0 # https://flask.palletsprojects.com",
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    // The URL lives in a trailing comment, so the requirement must not be skipped.
    expect(names(deps!.runtime).sort()).toEqual(["flask", "requests"]);
    expect(deps!.runtime.find((d) => d.name === "requests")?.version).toBe("2.31.0");
  });

  it("go.mod: reads every require block and dedupes", async () => {
    const dir = await repoWith({
      "go.mod": [
        "module example.com/m",
        "go 1.21",
        "require (",
        "\tgithub.com/gin-gonic/gin v1.9.1",
        "\tgithub.com/spf13/cobra v1.7.0",
        ")",
        "require (",
        "\tgithub.com/bytedance/sonic v1.9.1 // indirect",
        "\tgithub.com/davecgh/go-spew v1.1.1 // indirect",
        ")",
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(deps?.packageManager).toBe("go");
    expect(names(deps!.runtime).sort()).toEqual([
      "github.com/bytedance/sonic",
      "github.com/davecgh/go-spew",
      "github.com/gin-gonic/gin",
      "github.com/spf13/cobra",
    ]);
    expect(deps!.totalCount).toBe(4);
  });

  it("go.mod: keeps deps below a comment that contains ')'", async () => {
    // A paren inside a trailing comment must not terminate the require block
    // early (the old non-greedy `require ( ... )` regex stopped at the first ')'
    // and dropped every dependency below it).
    const dir = await repoWith({
      "go.mod": [
        "module example.com/m",
        "go 1.21",
        "require (",
        "\tgithub.com/a/a v1.0.0 // provides foo(bar)",
        "\tgithub.com/b/b v2.0.0 // see issue (123)",
        "\tgithub.com/c/c v3.0.0",
        ")",
      ].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(deps?.packageManager).toBe("go");
    expect(names(deps!.runtime).sort()).toEqual([
      "github.com/a/a",
      "github.com/b/b",
      "github.com/c/c",
    ]);
    expect(deps!.totalCount).toBe(3);
  });

  it("polyglot repo: first manifest wins (npm over cargo) — known single-manifest limitation", async () => {
    // extractDependencies returns the FIRST non-null extractor in the fixed
    // order npm -> cargo -> python -> go, so a repo carrying both package.json
    // and Cargo.toml reports only npm and silently drops the Rust deps. This
    // pins that lossy contract; aggregating across manifests would be a
    // deliberate, test-visible change rather than a silent regression.
    const dir = await repoWith({
      "package.json": JSON.stringify({ name: "poly", dependencies: { express: "^5.0.0" } }),
      "Cargo.toml": ["[dependencies]", 'serde = "1.0"'].join("\n"),
    });
    const deps = await extractDependencies(dir);
    expect(deps?.packageManager).toBe("npm");
    expect(names(deps!.runtime)).toEqual(["express"]);
    expect(names(deps!.runtime)).not.toContain("serde");
  });
});
