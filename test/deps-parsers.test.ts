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
});
