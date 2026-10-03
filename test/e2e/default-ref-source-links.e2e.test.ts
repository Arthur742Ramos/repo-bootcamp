import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { runbookFacts } from "../helpers/runbook-facts.js";

const root = process.cwd();
const url = "https://github.com/owned/default-ref-fixture";

async function fixture(ref: string) {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-default-ref-"));
  const repo = join(base, "repo");
  const selected = join(repo, "packages", "ref app");
  await mkdir(join(selected, "src"), { recursive: true });
  await writeFile(join(selected, "package.json"), '{"name":"owned-ref-package"}\n');
  await writeFile(join(selected, "README.md"), "# Owned source-ref fixture\n");
  await writeFile(join(selected, "src", "index.ts"), "export const metadataOnly = true;\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-b", "main");
  git("config", "user.name", "Owned Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("commit", "--no-gpg-sign", "-m", "Owned metadata fixture");
  git("checkout", "-b", ref);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const facts = runbookFacts();
  facts.repoName = "owned/default-ref-fixture";
  const response = join(base, "response.json");
  await writeFile(response, JSON.stringify(facts));
  for (const dir of ["home", "cache", "tmp"]) await mkdir(join(base, dir));
  const preload = join(base, "owned-home.mjs");
  await writeFile(
    preload,
    "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>process.env.OWNED_REF_HOME;syncBuiltinESMExports();"
  );
  return { base, repo, sha, response, preload };
}

function generate(
  owned: Awaited<ReturnType<typeof fixture>>,
  format: "markdown" | "html" | "pdf",
  explicitRef?: string
) {
  const output = join(owned.base, format);
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(join(root, "node_modules", "tsx", "dist", "loader.mjs")).href,
      "--import",
      pathToFileURL(owned.preload).href,
      join(root, "src", "cli.ts"),
      url,
      "--subdir",
      "packages/ref app",
      "--no-cache",
      "--quiet",
      "--format",
      format,
      "--output",
      output,
      ...(explicitRef ? ["--branch", explicitRef] : []),
    ],
    {
      cwd: owned.base,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        NODE_ENV: "test",
        OWNED_REF_HOME: join(owned.base, "home"),
        HOME: join(owned.base, "home"),
        USERPROFILE: join(owned.base, "home"),
        XDG_CACHE_HOME: join(owned.base, "cache"),
        TMPDIR: join(owned.base, "tmp"),
        TSX_DISABLE_CACHE: "1",
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: owned.response,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.${pathToFileURL(owned.repo).href}.insteadOf`,
        GIT_CONFIG_VALUE_0: url + ".git",
      },
    }
  );
  return { result, output };
}

describe("actual detected default-ref source links", () => {
  it.each([
    ["release/v2#candidate", "release/v2%23candidate"],
    ["release/v2(candidate)", "release/v2%28candidate%29"],
    ["release/v2%complete", "release/v2%25complete"],
  ])("preserves source paths for default ref %s in all formats", async (ref, encodedRef) => {
    const owned = await fixture(ref);
    try {
      const sourceUrl = `${url}/blob/${encodedRef}/packages/ref%20app/src/index.ts`;
      for (const format of ["markdown", "html", "pdf"] as const) {
        const { result, output } = generate(owned, format);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const extension = format === "markdown" ? ".md" : ".html";
        for (const name of ["CODEMAP", "ARCHITECTURE"]) {
          const doc = await readFile(join(output, name + extension), "utf8");
          expect(doc).toContain(format === "markdown" ? `](${sourceUrl})` : `href="${sourceUrl}"`);
          expect(doc).not.toContain(`/blob/${ref}/packages/`);
        }
        const manifest = JSON.parse(await readFile(join(output, "ANALYSIS_MANIFEST.json"), "utf8"));
        expect(manifest.repository.branch).toBe(ref);
        expect(manifest.repository.commitSha).toBe(owned.sha);
        const facts = JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8"));
        expect(facts.structure.entrypoints[0].path).toBe("src/index.ts");
        const onboarding = await readFile(join(output, "ONBOARDING" + extension), "utf8");
        expect(onboarding).toContain(`git clone --branch '${ref}'`);
      }
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  });

  it("retains the explicit clone-ref whitelist", async () => {
    const owned = await fixture("release/v2#candidate");
    try {
      const { result } = generate(owned, "markdown", "release/v2#candidate");
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("Branch contains unsafe characters");
    } finally {
      await rm(owned.base, { recursive: true, force: true });
    }
  });
});
