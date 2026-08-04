import { copyFile, readdir, stat } from "fs/promises";
import { join, resolve } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const PUBLISHABLE_FILE_PATTERN = /\.(?:md|json|mmd|html|pdf|svg|png)$/i;
const SAFE_BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

export interface PublishCommandOptions {
  apply?: boolean;
  createPr?: boolean;
  branch?: string;
  base?: string;
  title?: string;
  body?: string;
  verbose?: boolean;
}

interface PublishPlan {
  repoRoot: string;
  kitRoot: string;
  files: string[];
  branch: string;
  title: string;
  body: string;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function resolveRepoRoot(repoPath: string): Promise<string> {
  const root = await runGit(["rev-parse", "--show-toplevel"], repoPath);
  if (!root) throw new Error("The target path is not a Git repository");
  return resolve(root);
}

async function collectKitFiles(kitRoot: string): Promise<string[]> {
  const entries = await readdir(kitRoot, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && PUBLISHABLE_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => !name.includes("..") && !name.includes("/") && !name.includes("\\"))
    .sort();
  if (files.length === 0) {
    throw new Error("The kit directory contains no publishable generated files");
  }
  return files;
}

async function buildPlan(
  repoPath: string,
  kitPath: string,
  options: PublishCommandOptions
): Promise<PublishPlan> {
  const repoRoot = await resolveRepoRoot(resolve(repoPath));
  const kitRoot = resolve(kitPath);
  const kitStats = await stat(kitRoot);
  if (!kitStats.isDirectory()) throw new Error("The kit path must be a directory");

  const branch = options.branch || `bootcamp/onboarding-${Date.now()}`;
  if (!SAFE_BRANCH_PATTERN.test(branch) || branch.startsWith("-") || branch.includes("..")) {
    throw new Error("Branch contains unsafe characters");
  }

  const files = await collectKitFiles(kitRoot);
  return {
    repoRoot,
    kitRoot,
    files,
    branch,
    title: options.title || "docs: refresh Repo Bootcamp onboarding kit",
    body:
      options.body ||
      "This pull request refreshes the generated Repo Bootcamp onboarding kit.\n\nPlease review the evidence manifest and generated guidance before merging.",
  };
}

function printPlan(plan: PublishPlan): void {
  console.log("Repo Bootcamp publish plan");
  console.log(`  Repository: ${plan.repoRoot}`);
  console.log(`  Kit:        ${plan.kitRoot}`);
  console.log(`  Branch:     ${plan.branch}`);
  console.log(`  Files:      ${plan.files.join(", ")}`);
  console.log(`  Title:      ${plan.title}`);
}

/** Preview or publish a generated kit into a local checkout. */
export async function runPublishCommand(
  repoPath: string,
  kitPath: string,
  options: PublishCommandOptions = {}
): Promise<void> {
  const plan = await buildPlan(repoPath, kitPath, options);
  printPlan(plan);

  if (!options.apply && !options.createPr) {
    console.log(
      "\nDry run only. Pass --apply to copy and commit, or --create-pr to push and open a PR."
    );
    return;
  }

  const worktree = await runGit(["status", "--porcelain"], plan.repoRoot);
  if (worktree) {
    throw new Error("The target repository has uncommitted changes; publish into a clean checkout");
  }

  await runGit(["switch", "-c", plan.branch], plan.repoRoot);
  for (const file of plan.files) {
    await copyFile(join(plan.kitRoot, file), join(plan.repoRoot, file));
  }

  await runGit(["add", "--", ...plan.files], plan.repoRoot);
  const staged = await runGit(["diff", "--cached", "--name-only"], plan.repoRoot);
  if (!staged) {
    console.log("No generated files changed; nothing to commit.");
    return;
  }

  await runGit(["commit", "-m", plan.title], plan.repoRoot);
  console.log(`Committed ${plan.files.length} generated file(s) on ${plan.branch}.`);

  if (!options.createPr) {
    console.log(`Push with: git -C ${plan.repoRoot} push -u origin ${plan.branch}`);
    return;
  }

  await runGit(["push", "--set-upstream", "origin", plan.branch], plan.repoRoot);
  const baseArgs = options.base ? ["--base", options.base] : [];
  const { stdout } = await execFileAsync(
    "gh",
    ["pr", "create", "--title", plan.title, "--body", plan.body, ...baseArgs],
    { cwd: plan.repoRoot }
  );
  console.log(stdout.trim() || "Pull request created.");
}
