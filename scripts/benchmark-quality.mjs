import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsx = join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const cli = [
  tsx,
  "--tsconfig",
  join(projectRoot, "tsconfig.json"),
  join(projectRoot, "src", "cli.ts"),
];

function argumentsFrom(argv) {
  const options = {
    manifest: join(projectRoot, "scripts", "quality-benchmark.json"),
    check: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") options.check = true;
    else if (arg === "--live") options.live = true;
    else if (arg === "--manifest" || arg === "--responses") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`${arg} needs a path.`);
      options[arg === "--manifest" ? "manifest" : "responses"] = resolve(argv[++i]);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (options.live && options.responses) {
    throw new Error("Choose either --live or --responses, not both.");
  }
  return options;
}

function validManifest(manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    throw new Error("Expected a version 1 benchmark manifest with at least one case.");
  }
  const ids = new Set();
  for (const item of manifest.cases) {
    if (
      typeof item?.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.repository !== "string" ||
      (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.repository) &&
        !isAbsolute(item.repository)) ||
      typeof item.commit !== "string" ||
      !/^[a-f0-9]{40}$/.test(item.commit) ||
      (item.subdir !== undefined && typeof item.subdir !== "string") ||
      !Array.isArray(item.expected) ||
      item.expected.length === 0 ||
      !item.expected.every(
        (task) =>
          typeof task?.command === "string" &&
          task.command.length > 0 &&
          typeof task.source === "string" &&
          task.source.length > 0
      )
    ) {
      throw new Error("Invalid benchmark case.");
    }
    ids.add(item.id);
  }
}

function compareTasks(expected, actual) {
  const missing = expected.filter(
    (want) => !actual.some((task) => task.command === want.command && task.source === want.source)
  );
  return { matched: expected.length - missing.length, expected: expected.length, missing };
}

async function benchmarkCase(item, root, options) {
  const checkout = join(root, item.id);
  const hooks = join(root, "no-hooks");
  await mkdir(checkout);
  const git = (args) =>
    exec("git", ["-c", `core.hooksPath=${hooks}`, ...args], {
      cwd: checkout,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 180_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    });
  await git(["init", "--quiet"]);
  await git(["fetch", "--quiet", "--depth=1", "--no-tags", item.repository, item.commit]);
  await git(["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  const { stdout: head } = await git(["rev-parse", "HEAD"]);
  if (head.trim() !== item.commit) throw new Error(`${item.id}: checkout did not match its pin.`);

  const scope = item.subdir ? ["--subdir", item.subdir] : [];
  const runCli = (args, env = process.env) =>
    exec(process.execPath, [...cli, ...args], {
      cwd: root,
      env,
      maxBuffer: 16 * 1024 * 1024,
      timeout: options.live ? 900_000 : 180_000,
    });
  const { stdout } = await runCli(["tasks", checkout, "--json", ...scope]);
  const discovery = JSON.parse(stdout);
  if (!Array.isArray(discovery.tasks)) throw new Error(`${item.id}: invalid task report.`);
  const result = {
    id: item.id,
    repository: item.repository,
    commit: item.commit,
    subdir: item.subdir ?? null,
    deterministic: compareTasks(item.expected, discovery.tasks),
  };

  if (options.live || options.responses) {
    const output = join(root, `${item.id}-output`);
    const env = { ...process.env };
    delete env.REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE;
    env.NODE_ENV = options.live ? "production" : "test";
    if (options.responses) {
      const response = join(options.responses, `${item.id}.json`);
      await access(response);
      env.REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE = response;
    }
    await runCli(
      [
        checkout,
        "--no-clone",
        "--fast",
        "--json-only",
        "--no-cache",
        "--quiet",
        "--output",
        output,
        ...scope,
      ],
      env
    );
    const facts = JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(output, "ANALYSIS_MANIFEST.json"), "utf8"));
    const evidence = manifest.analysis?.guidanceEvidence;
    if (
      !Array.isArray(facts.quickstart?.commands) ||
      !Array.isArray(evidence?.commands) ||
      !Array.isArray(evidence?.firstTasks)
    ) {
      throw new Error(`${item.id}: invalid generated guidance or evidence.`);
    }
    const citations = [...evidence.commands, ...evidence.firstTasks];
    result.generation = {
      model: manifest.analysis.model,
      exactCommandMatches: compareTasks(item.expected, facts.quickstart.commands),
      matchedExcerpts: citations.filter((citation) => citation.status === "matched").length,
      guidanceItems: citations.length,
    };
  }
  return result;
}

try {
  const options = argumentsFrom(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(options.manifest, "utf8"));
  validManifest(manifest);
  await access(tsx);
  const root = await mkdtemp(join(tmpdir(), "bootcamp-quality-"));
  try {
    await mkdir(join(root, "no-hooks"));
    const cases = [];
    for (const item of manifest.cases) cases.push(await benchmarkCase(item, root, options));
    const totals = cases.reduce(
      (sum, item) => ({
        matched: sum.matched + item.deterministic.matched,
        expected: sum.expected + item.deterministic.expected,
      }),
      { matched: 0, expected: 0 }
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          version: 1,
          mode: options.live ? "live" : options.responses ? "saved-responses" : "deterministic",
          cases,
          totals,
          note: "Exact command/source recall covers only annotated expectations; matched excerpts locate text and do not prove semantic correctness.",
        },
        null,
        2
      )}\n`
    );
    if (options.check && totals.matched !== totals.expected) process.exitCode = 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
} catch (error) {
  console.error(`Quality benchmark failed: ${error.message}`);
  process.exitCode = 1;
}
