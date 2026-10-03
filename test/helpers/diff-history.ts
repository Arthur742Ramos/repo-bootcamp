import { execFileSync } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export function fixtureGit(cwd: string, args: string[], input?: string): string {
  return execFileSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/** Owned tiny Git histories only; no project recipes or provider connections. */
export async function createDiffHistory(base: string, extraMainCommits = 0) {
  const repo = join(base, "repo"),
    remote = join(base, "remote.git");
  await mkdir(join(repo, "packages/app"), { recursive: true });
  fixtureGit(repo, ["init", "-b", "main"]);
  fixtureGit(repo, ["config", "user.email", "owned@example.invalid"]);
  fixtureGit(repo, ["config", "user.name", "Owned Diff fixture"]);
  const manifest = {
    name: "owned",
    version: "1.0.0",
    scripts: { build: "echo build" },
    dependencies: { shared: "1" },
  };
  await writeFile(join(repo, "package.json"), JSON.stringify(manifest));
  await writeFile(join(repo, "README.md"), "# Owned repo\n");
  await writeFile(
    join(repo, "packages/app/package.json"),
    JSON.stringify({ name: "owned-app", scripts: { test: "echo test" } })
  );
  await writeFile(join(repo, "packages/app/index.js"), "export const owned = 1;\n");
  fixtureGit(repo, ["add", "."]);
  fixtureGit(repo, ["commit", "--no-gpg-sign", "-m", "ancestor"]);
  const ancestor = fixtureGit(repo, ["rev-parse", "HEAD"]);
  fixtureGit(repo, ["branch", "shared"]);
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({
      ...manifest,
      version: "3.0.0",
      scripts: {},
      dependencies: { ...manifest.dependencies, "main-only": "1" },
    })
  );
  fixtureGit(repo, ["commit", "--no-gpg-sign", "-am", "main-only package"]);
  if (extraMainCommits) {
    const initial = fixtureGit(repo, ["rev-parse", "HEAD"]),
      stream: string[] = [];
    for (let index = 1; index <= extraMainCommits; index++) {
      const message = `Owned metadata history ${index}`;
      stream.push(
        `commit refs/heads/main\nmark :${index}\nauthor Owned <owned@example.invalid> ${Math.floor(Date.now() / 1000) + index} +0000\ncommitter Owned <owned@example.invalid> ${Math.floor(Date.now() / 1000) + index} +0000\ndata ${Buffer.byteLength(message)}\n${message}\nfrom ${index === 1 ? initial : `:${index - 1}`}\n\n`
      );
    }
    fixtureGit(repo, ["fast-import", "--quiet"], stream.join(""));
  }
  const main = fixtureGit(repo, ["rev-parse", "main"]);
  fixtureGit(repo, ["checkout", "-b", "feature/readme", ancestor]);
  await writeFile(join(repo, "README.md"), "# Owned repo\n\nFeature documentation.\n");
  fixtureGit(repo, ["commit", "--no-gpg-sign", "-am", "readme feature"]);
  const readme = fixtureGit(repo, ["rev-parse", "HEAD"]);
  fixtureGit(repo, ["checkout", "-b", "feature/package", ancestor]);
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({
      ...manifest,
      version: "2.0.0",
      scripts: { ...manifest.scripts, "feature'check": "echo feature" },
      dependencies: { ...manifest.dependencies, "feature-only": "1" },
    })
  );
  fixtureGit(repo, ["commit", "--no-gpg-sign", "-am", "package feature"]);
  const feature = fixtureGit(repo, ["rev-parse", "HEAD"]);
  fixtureGit(repo, ["checkout", "--orphan", "unrelated"]);
  fixtureGit(repo, ["rm", "-rf", "."]);
  await writeFile(join(repo, "README.md"), "# Separate history\n");
  fixtureGit(repo, ["add", "."]);
  fixtureGit(repo, ["commit", "--no-gpg-sign", "-m", "unrelated"]);
  const unrelated = fixtureGit(repo, ["rev-parse", "HEAD"]);
  fixtureGit(repo, ["checkout", "main"]);
  fixtureGit(base, ["clone", "--bare", repo, remote]);
  for (const [number, sha] of [
    [1, readme],
    [2, feature],
    [3, unrelated],
  ] as const)
    fixtureGit(remote, ["update-ref", `refs/pull/${number}/head`, sha]);
  return { repo, remote, ancestor, main, readme, feature, unrelated };
}
