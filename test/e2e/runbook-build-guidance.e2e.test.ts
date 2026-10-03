import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runbookFacts } from "../helpers/runbook-facts.js";

const ownedDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    ownedDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "bootcamp-runbook-e2e-"));
  ownedDirectories.push(base);
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "index.ts"), "export const metadataOnly = true;\n");
  await writeFile(join(repo, "README.md"), "# Owned library fixture\nRecipes are not executed.\n");
  const response = join(base, "response.json");
  await writeFile(response, JSON.stringify(runbookFacts()));
  const wrapper = join(base, "owned-cli.mjs");
  await writeFile(
    wrapper,
    "import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';import {pathToFileURL} from 'node:url';os.homedir=()=>process.env.OWNED_RUNBOOK_HOME;syncBuiltinESMExports();process.argv[1]=process.env.OWNED_RUNBOOK_ENTRY;await import(pathToFileURL(process.env.OWNED_RUNBOOK_ENTRY));"
  );
  for (const dir of ["home", "tmp", "node-cache", "npm-cache"]) await mkdir(join(base, dir));
  return { base, repo, response, wrapper };
}

async function generate(owned: Awaited<ReturnType<typeof fixture>>, format: "markdown" | "html") {
  const output = join(owned.base, format);
  const originalHome = process.env.HOME;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      join(process.cwd(), "node_modules", "tsx", "dist", "loader.mjs"),
      owned.wrapper,
      owned.repo,
      "--no-clone",
      "--no-cache",
      "--style",
      "corporate",
      "--format",
      format,
      "--output",
      output,
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        NODE_ENV: "test",
        OWNED_RUNBOOK_HOME: join(owned.base, "home"),
        OWNED_RUNBOOK_ENTRY: join(process.cwd(), "src", "cli.ts"),
        REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE: owned.response,
        TMPDIR: join(owned.base, "tmp"),
        NODE_COMPILE_CACHE: join(owned.base, "node-cache"),
        npm_config_cache: join(owned.base, "npm-cache"),
        TSX_DISABLE_CACHE: "1",
        FORCE_COLOR: "0",
      },
    }
  );
  expect(result.status, result.stderr + result.stdout).toBe(0);
  expect(process.env.HOME).toBe(originalHome);
  const extension = format === "markdown" ? ".md" : ".html";
  return {
    bootcamp: await readFile(join(output, "BOOTCAMP" + extension), "utf8"),
    onboarding: await readFile(join(output, "ONBOARDING" + extension), "utf8"),
    runbook: await readFile(join(output, "RUNBOOK" + extension), "utf8"),
    facts: JSON.parse(await readFile(join(output, "repo_facts.json"), "utf8")),
  };
}

describe("actual library/tool runbook build guidance", () => {
  it.each(["build:prod", "compile", "bundle", "build prod", "build"])(
    "retains discovered npm %s in all three guides without running its recipe",
    async (name) => {
      const owned = await fixture();
      const sentinel = join(owned.repo, "recipe-was-executed.txt");
      await writeFile(
        join(owned.repo, "package.json"),
        JSON.stringify({
          name: "owned-runbook-fixture",
          scripts: {
            [name]: "node -e \"require('fs').writeFileSync('recipe-was-executed.txt','bad')\"",
          },
        })
      );
      const command = name === "build prod" ? "npm run 'build prod'" : `npm run ${name}`;
      for (const format of ["markdown", "html"] as const) {
        const documents = await generate(owned, format);
        expect(documents.facts.quickstart.commands).toContainEqual(
          expect.objectContaining({ name, command, source: "package.json" })
        );
        for (const document of [documents.bootcamp, documents.onboarding, documents.runbook]) {
          expect(document).toContain(command);
        }
        expect(documents.runbook).not.toContain("_No build command detected_");
      }
      await expect(readFile(sentinel)).rejects.toMatchObject({ code: "ENOENT" });
    }
  );

  it("retains native Make compile guidance", async () => {
    const owned = await fixture();
    await writeFile(join(owned.repo, "Makefile"), "compile:\n\t@touch recipe-was-executed.txt\n");
    const documents = await generate(owned, "markdown");
    expect(documents.runbook).toContain("```bash\nmake compile\n```");
    expect(documents.bootcamp).toContain("Build/verify: `make compile`");
    await expect(readFile(join(owned.repo, "recipe-was-executed.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps setup/dev/test-only kits without a build command", async () => {
    const owned = await fixture();
    await writeFile(
      join(owned.repo, "package.json"),
      JSON.stringify({
        name: "owned-runbook-fixture",
        scripts: { setup: "noop", dev: "noop", test: "noop" },
      })
    );
    const documents = await generate(owned, "markdown");
    expect(documents.runbook).toContain("_No build command detected_");
    expect(documents.runbook).not.toContain("```bash");
    expect(documents.onboarding).toContain("npm run test");
  });

  it.each(["npm install --save-dev build-tools", "npm run build --help", "npm test"])(
    "omits mislabeled build guidance for %s",
    async (command) => {
      const owned = await fixture();
      const facts = runbookFacts();
      facts.quickstart.commands = [{ name: "build", command, source: "README.md" }];
      await writeFile(owned.response, JSON.stringify(facts));
      for (const format of ["markdown", "html"] as const) {
        const documents = await generate(owned, format);
        expect(documents.runbook).toContain("_No build command detected_");
        expect(documents.runbook).not.toContain(command);
      }
    }
  );

  it("preserves multiline build fences and literal spacing in actual exports", async () => {
    const owned = await fixture();
    const facts = runbookFacts();
    const command = "printf '```'\n  npm run build\t-- --target='literal target'";
    facts.quickstart.commands = [{ name: "build", command, source: "README.md" }];
    await writeFile(owned.response, JSON.stringify(facts));
    const markdown = await generate(owned, "markdown");
    expect(markdown.runbook).toContain(`\`\`\`\`bash\n${command}\n\`\`\`\``);
    const html = await generate(owned, "html");
    expect(
      html.runbook.match(/<pre\b[^>]*><code class="language-bash">([\s\S]*?)<\/code><\/pre>/)?.[1]
    ).toBe(command);
    expect(html.facts.quickstart.commands).toEqual(facts.quickstart.commands);
  });

  it("preserves explicit operational exports when quickstart build guidance changes", async () => {
    const owned = await fixture();
    const facts = runbookFacts();
    facts.runbook = {
      applicable: true,
      deploySteps: ["Use the documented release procedure"],
      observability: ["Inspect service metrics"],
      incidents: [{ name: "Incident", check: "Follow the incident procedure" }],
      sources: ["docs/operations.md"],
    };
    const originals = new Map<string, string>();
    await writeFile(owned.response, JSON.stringify(facts));
    for (const format of ["markdown", "html"] as const) {
      originals.set(format, (await generate(owned, format)).runbook);
    }
    facts.quickstart.commands = [
      { name: "bundle", command: "npm run bundle", source: "README.md" },
    ];
    await writeFile(owned.response, JSON.stringify(facts));
    for (const format of ["markdown", "html"] as const) {
      const documents = await generate(owned, format);
      expect(documents.runbook).toBe(originals.get(format));
      expect(documents.runbook).toContain("Use the documented release procedure");
      expect(documents.runbook).not.toContain("Build &amp; Release");
    }
  });
});
