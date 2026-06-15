import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { analyzeSecurityPatterns, type SecurityAnalysis } from "../src/security.js";
import type { FileInfo } from "../src/types.js";

const dirs: string[] = [];

async function repoWith(
  files: Record<string, string>
): Promise<{ path: string; fileInfos: FileInfo[] }> {
  const path = await mkdtemp(join(tmpdir(), "bootcamp-sec-"));
  dirs.push(path);
  const fileInfos: FileInfo[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const full = join(path, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf-8");
    fileInfos.push({ path: rel, size: content.length, isDirectory: false });
  }
  return { path, fileInfos };
}

function titles(analysis: SecurityAnalysis): string[] {
  return analysis.findings.map((f) => f.title);
}

async function scan(files: Record<string, string>): Promise<SecurityAnalysis> {
  const { path, fileInfos } = await repoWith(files);
  return analyzeSecurityPatterns(path, fileInfos, undefined);
}

describe("security pattern detection", () => {
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("flags `SELECT … ${id}` (keyword before interpolation)", async () => {
    const a = await scan({
      "src/db.ts": "export function q(userId: string) {\n  return `SELECT * FROM users WHERE id = ${userId}`;\n}\n",
    });
    expect(titles(a)).toContain("Potential SQL injection");
  });

  it("SSL: ignores benign `verifyEmail: false`, flags `rejectUnauthorized: false`", async () => {
    const benign = await scan({ "src/a.ts": "const opts = { verifyEmail: false };\n" });
    expect(titles(benign)).not.toContain("SSL verification disabled");

    const real = await scan({
      "src/b.ts": "const agent = new https.Agent({ rejectUnauthorized: false });\n",
    });
    expect(titles(real)).toContain("SSL verification disabled");
  });

  it("eval: ignores `retrieval(`, flags `eval(`", async () => {
    const ok = await scan({ "src/r.ts": "const data = retrieval(key);\n" });
    expect(titles(ok)).not.toContain("Use of eval()");

    const bad = await scan({ "src/e.ts": "const r = eval(userInput);\n" });
    expect(titles(bad)).toContain("Use of eval()");
  });

  it("innerHTML: flags `+=` but not `===`", async () => {
    const cmp = await scan({ "src/c.ts": 'if (el.innerHTML === "") return;\n' });
    expect(titles(cmp)).not.toContain("Direct innerHTML assignment");

    const append = await scan({ "src/d.ts": "el.innerHTML += html;\n" });
    expect(titles(append)).toContain("Direct innerHTML assignment");
  });

  it("api-key: flags a token with non-alphanumeric separators (e.g. ghp_…)", async () => {
    const a = await scan({
      "src/k.ts": 'const apiKey = "ghp_AbCdEfGhIjKlMnOpQrStUvWx0123456789";\n',
    });
    expect(titles(a)).toContain("Potential hardcoded API key");
  });

  it(".env.sample is a template, not a real (secret-bearing) env file", async () => {
    const a = await scan({ ".env.sample": "API_KEY=\nDATABASE_URL=\n" });
    expect(a.secretsHandling.envFiles).not.toContain(".env.sample");
    expect(a.secretsHandling.hasEnvExample).toBe(true);
  });
});
