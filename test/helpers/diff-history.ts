import { execFileSync } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export function fixtureGit(cwd: string, args: string[], input?: string): string {
  return execFileSync("git", ["-c", "maintenance.auto=false", ...args], {
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
  fixtureGit(base, ["clone", "--bare", "--no-local", repo, remote]);
  for (const [number, sha] of [
    [1, readme],
    [2, feature],
    [3, unrelated],
  ] as const)
    fixtureGit(remote, ["update-ref", `refs/pull/${number}/head`, sha]);
  return { repo, remote, ancestor, main, readme, feature, unrelated };
}

/** A short first-parent route can expose an older base before a long merge route. */
export async function createMergedDiffHistory(base: string, crossed = false, topicCommits = 80) {
  const repo = join(base, "repo"),
    remote = join(base, "remote.git");
  await mkdir(repo, { recursive: true });
  fixtureGit(repo, ["init", "-b", "main"]);
  fixtureGit(repo, ["config", "user.email", "owned@example.invalid"]);
  fixtureGit(repo, ["config", "user.name", "Owned merged Diff fixture"]);
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({ version: "1.0.0", dependencies: { shared: "1" } })
  );
  await writeFile(join(repo, "README.md"), "# Owned repo\n");
  fixtureGit(repo, ["add", "."]);
  fixtureGit(repo, ["commit", "--no-gpg-sign", "-m", "A"]);
  const ancestor = fixtureGit(repo, ["rev-parse", "HEAD"]);
  fixtureGit(repo, ["checkout", "-b", "topic"]);
  const packageContent = JSON.stringify({
    version: "2.0.0",
    dependencies: { shared: "1", "already-merged": "1" },
  });
  await writeFile(join(repo, "package.json"), packageContent);
  fixtureGit(repo, ["commit", "--no-gpg-sign", "-am", "B"]);
  const newerBase = fixtureGit(repo, ["rev-parse", "HEAD"]);
  let topicBase = newerBase,
    featureBase = newerBase;
  if (crossed) {
    fixtureGit(repo, ["checkout", "-b", "other-topic", ancestor]);
    await writeFile(join(repo, "package.json"), packageContent);
    fixtureGit(repo, ["commit", "--no-gpg-sign", "-am", "C"]);
    const otherBase = fixtureGit(repo, ["rev-parse", "HEAD"]),
      tree = fixtureGit(repo, ["rev-parse", `${newerBase}^{tree}`]);
    topicBase = fixtureGit(repo, [
      "-c",
      "commit.gpgSign=false",
      "commit-tree",
      tree,
      "-p",
      newerBase,
      "-p",
      otherBase,
      "-m",
      "left crossed merge",
    ]);
    featureBase = fixtureGit(repo, [
      "-c",
      "commit.gpgSign=false",
      "commit-tree",
      tree,
      "-p",
      otherBase,
      "-p",
      newerBase,
      "-m",
      "right crossed merge",
    ]);
    fixtureGit(repo, ["update-ref", "refs/heads/topic", topicBase]);
  }
  const stream: string[] = [],
    timestamp = Math.floor(Date.now() / 1000);
  for (let index = 1; index <= topicCommits; index++) {
    const message = `Owned topic metadata ${index}`;
    stream.push(
      `commit refs/heads/topic\nmark :${index}\nauthor Owned <owned@example.invalid> ${timestamp + index} +0000\ncommitter Owned <owned@example.invalid> ${timestamp + index} +0000\ndata ${Buffer.byteLength(message)}\n${message}\nfrom ${index === 1 ? topicBase : `:${index - 1}`}\n\n`
    );
  }
  fixtureGit(repo, ["fast-import", "--quiet"], stream.join(""));
  fixtureGit(repo, ["checkout", "main"]);
  await writeFile(join(repo, "main.txt"), "Main-only changes\n");
  fixtureGit(repo, ["add", "."]);
  fixtureGit(repo, ["commit", "--no-gpg-sign", "-m", "main changes"]);
  fixtureGit(repo, ["merge", "--no-ff", "--no-gpg-sign", "topic", "-m", "merge long topic"]);
  const main = fixtureGit(repo, ["rev-parse", "HEAD"]);
  fixtureGit(repo, ["checkout", "-b", "feature/readme", featureBase]);
  await writeFile(join(repo, "README.md"), "# Owned repo\n\nFeature documentation.\n");
  fixtureGit(repo, ["commit", "--no-gpg-sign", "-am", "feature docs"]);
  const feature = fixtureGit(repo, ["rev-parse", "HEAD"]);
  fixtureGit(repo, ["checkout", "main"]);
  fixtureGit(base, ["clone", "--bare", "--no-local", repo, remote]);
  fixtureGit(remote, ["update-ref", "refs/pull/1/head", feature]);
  return { repo, remote, ancestor, newerBase, main, readme: feature, feature, unrelated: feature };
}
