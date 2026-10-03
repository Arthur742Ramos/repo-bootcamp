import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { access, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { createPackageMonorepo, packageFacts } from "./helpers/package-scope.js";
import { closeLoopbackServers, listenLoopback } from "./helpers/loopback-server.js";

let root: string;
let server: Server;
let routes: typeof import("../src/web/routes.js");
let agent: typeof import("../src/agent.js");
let analyze: ReturnType<typeof vi.spyOn>;
let clone: ReturnType<typeof vi.fn>;
let cleanup: ReturnType<typeof vi.fn>;
let scan: ReturnType<typeof vi.fn>;
let ask: ReturnType<typeof vi.fn>;
let readCache: ReturnType<typeof vi.fn>;
let phaseCache: ReturnType<typeof vi.fn>;
let holdClone: (() => Promise<void>) | undefined;
let alterClone: ((dir: string) => Promise<void>) | undefined;
const clones: string[] = [];

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function start(subdir?: unknown, extra: Record<string, unknown> = {}) {
  return request(server)
    .post("/api/analyze")
    .send({
      repoUrl: "https://github.com/fixture/monorepo",
      options: { subdir, ...extra },
    });
}
async function settle(id: string) {
  let body: any;
  await expect
    .poll(
      async () => {
        body = (await request(server).get(`/api/jobs/${id}`)).body;
        return body.status;
      },
      { timeout: 10000 }
    )
    .not.toMatch(/^(pending|running)$/);
  await expect.poll(async () => (await Promise.all(clones.map(exists))).some(Boolean)).toBe(false);
  return body;
}

beforeEach(async () => {
  vi.resetModules();
  clones.length = 0;
  holdClone = undefined;
  alterClone = undefined;
  root = await mkdtemp(join(tmpdir(), "bootcamp-web-scope-"));
  const response = join(root, "response.json");
  await writeFile(response, JSON.stringify(packageFacts()));
  vi.stubEnv("REPO_BOOTCAMP_TEST_LLM_RESPONSE_FILE", response);
  vi.stubEnv("NODE_ENV", "test");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.doMock("../src/services/clone-service.js", async () => {
    const actual = await vi.importActual<typeof import("../src/services/clone-service.js")>(
      "../src/services/clone-service.js"
    );
    clone = vi.fn(async (info, branch) => {
      const dir = await mkdtemp(join(root, "checkout-"));
      clones.push(dir);
      await createPackageMonorepo(dir);
      await symlink(
        join(dir, "packages", "app"),
        join(dir, "app-alias"),
        process.platform === "win32" ? "junction" : "dir"
      );
      await symlink(root, join(dir, "outside"), process.platform === "win32" ? "junction" : "dir");
      info.branch = branch || "main";
      info.commitSha = "a".repeat(40);
      if (alterClone) await alterClone(dir);
      if (holdClone) await holdClone();
      return dir;
    });
    cleanup = vi.fn(actual.cleanupRepository);
    scan = vi.fn(actual.scanRepositoryFiles);
    return {
      ...actual,
      cloneRepository: clone,
      cleanupRepository: cleanup,
      scanRepositoryFiles: scan,
    };
  });
  vi.doMock("../src/interactive.js", () => {
    ask = vi.fn(async () => "Read src/main.ts in the selected package.");
    return { quickAsk: ask };
  });
  vi.doMock("../src/cache.js", async () => {
    const actual = await vi.importActual<typeof import("../src/cache.js")>("../src/cache.js");
    readCache = vi.fn(async () => null);
    phaseCache = vi.fn(async () => ({ hit: false }));
    return {
      ...actual,
      readCache,
      readPhaseCache: phaseCache,
      writeCache: vi.fn(),
      writePhaseCache: vi.fn(),
    };
  });
  agent = await import("../src/agent.js");
  analyze = vi.spyOn(agent, "analyzeRepo");
  const { default: express } = await import("express");
  routes = await import("../src/web/routes.js");
  const app = express();
  app.use(express.json());
  routes.registerRoutes(app);
  server = await listenLoopback(app);
});
afterEach(async () => {
  await routes?.pruneExpiredJobs(Date.now() + 31 * 60 * 1000);
  await closeLoopbackServers();
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.doUnmock("../src/services/clone-service.js");
  vi.doUnmock("../src/interactive.js");
  vi.doUnmock("../src/cache.js");
});

describe("web selected package using contained scans and saved SDK responses", () => {
  it("scopes analysis, generated source links, follow-up, cache identity and restored metadata, while owning the entire checkout", async () => {
    const started = await start(" ./packages/app/ ", {
      branch: "feature/app",
      fullClone: true,
      noClone: true,
      model: "untrusted",
    });
    expect(started.status).toBe(200);
    const job = await settle(started.body.jobId);
    expect(job.status).toBe("complete");
    expect(job.subdir).toBe("packages/app");
    expect(job.result.manifest.options.subdir).toBe("packages/app");
    expect(job.result.manifest.scan.packageManager).toBe("pnpm");
    const [repoPath, info, scanResult, options] = analyze.mock.calls[0];
    expect(repoPath).toBe(join(clones[0], "packages/app"));
    expect(info.sourcePathPrefix).toBe("packages/app");
    expect(scanResult.readme).toContain("APP ONLY");
    expect(scanResult.files.map((file: any) => file.path)).toEqual(
      expect.arrayContaining(["src/main.ts", "package.json"])
    );
    expect(
      scanResult.files.some((file: any) => file.path.includes("core") || file.path === "root.js")
    ).toBe(false);
    expect(options).toMatchObject({ subdir: "packages/app", fullClone: false, noClone: false });
    expect(options.model).toBeUndefined();
    expect(clone.mock.calls[0].slice(1)).toEqual(["feature/app", false]);
    const cacheOptions = readCache.mock.calls[0][2];
    expect(cacheOptions).toMatchObject({ subdir: "packages/app", maxFiles: 200 });
    expect(phaseCache.mock.calls.length).toBeGreaterThan(0);
    expect(phaseCache.mock.calls.every((call) => call[3].subdir === "packages/app")).toBe(true);
    const codemap = await request(server).get(`/api/jobs/${job.id}/files/CODEMAP.md?view=preview`);
    expect(codemap.status).toBe(200);
    expect(codemap.body.html).toContain(
      "https://github.com/fixture/monorepo/blob/feature/app/packages/app/src/main.ts"
    );
    expect(codemap.body.content).not.toContain("packages/core");
    const onboarding = await request(server).get(
      `/api/jobs/${job.id}/files/ONBOARDING.md?view=preview`
    );
    expect(onboarding.body.content).toContain("pnpm dev");
    expect(onboarding.body.content).toContain("monorepo/packages/app");
    const followed = await request(server)
      .post(`/api/jobs/${job.id}/ask`)
      .send({ question: "Where do I start?" });
    expect(followed.status).toBe(200);
    expect(ask.mock.calls[0][0]).toBe(join(clones[1], "packages/app"));
    expect(ask.mock.calls[0][1].sourcePathPrefix).toBe("packages/app");
    expect(ask.mock.calls[0][2].readme).toContain("APP ONLY");
    expect(clone.mock.calls[1].slice(1)).toEqual(["feature/app", false]);
    expect(cleanup.mock.calls.map((call) => call[0])).toEqual(clones);
    // The answer is sent before the handler's finally block removes its checkout.
    await expect.poll(() => exists(clones[1])).toBe(false);
  });

  it("keeps blank scope at the checkout root and separates root and package cache identities", async () => {
    const rootJob = await settle((await start(" ./ ")).body.jobId);
    expect(rootJob.status).toBe("complete");
    expect(rootJob.subdir).toBe("");
    expect(rootJob.result.manifest.options).not.toHaveProperty("subdir");
    expect(analyze.mock.calls[0][0]).toBe(clones[0]);
    expect(scan.mock.calls[0]).toEqual([clones[0], 200]);
    expect(analyze.mock.calls[0][2].readme).toContain("ROOT ONLY");
    await settle((await start("packages/app")).body.jobId);
    expect(readCache.mock.calls[0][2].subdir).toBeUndefined();
    expect(readCache.mock.calls[1][2].subdir).toBe("packages/app");
    expect(readCache.mock.calls[0][2].scanFingerprint).not.toBe(
      readCache.mock.calls[1][2].scanFingerprint
    );
  });

  it("keeps provider tree URL paths separate from the explicitly selected package directory", async () => {
    const response = await request(server).post("/api/analyze").send({
      repoUrl: "https://github.com/fixture/monorepo/tree/main/packages/app",
      options: {},
    });
    const job = await settle(response.body.jobId);
    expect(job.status).toBe("complete");
    expect(job.subdir).toBe("");
    expect(analyze.mock.calls[0][0]).toBe(clones[0]);
    expect(analyze.mock.calls[0][1].sourcePathPrefix).toBeUndefined();
    expect(analyze.mock.calls[0][2].readme).toContain("ROOT ONLY");
  });

  it("uses the canonical in-checkout path for source links when a package alias is selected", async () => {
    const job = await settle((await start("app-alias")).body.jobId);
    expect(job.status).toBe("complete");
    expect(analyze.mock.calls[0][1].sourcePathPrefix).toBe("packages/app");
    expect(job.result.manifest.options.subdir).toBe("app-alias");
  });

  for (const invalid of [
    "../app",
    "packages/../app",
    "/packages/app",
    "packages\napp",
    "packages\u001bapp",
    42,
    "a".repeat(501),
  ]) {
    it(`rejects invalid package syntax before cloning: ${JSON.stringify(invalid).slice(0, 50)}`, async () => {
      const response = await start(invalid);
      expect(response.status).toBe(400);
      expect(response.body.field).toBe("subdir");
      expect(clone).not.toHaveBeenCalled();
      expect(analyze).not.toHaveBeenCalled();
      expect(response.body.error).not.toContain(root);
    });
  }
  for (const invalid of ["missing", "README.md", "outside"]) {
    it(`rejects ${invalid} without exposing filesystem paths and cleans the outer checkout`, async () => {
      const job = await settle((await start(invalid)).body.jobId);
      expect(job.status).toBe("error");
      expect(job.error).toContain("package directory");
      expect(JSON.stringify(job)).not.toContain(root);
      expect(analyze).not.toHaveBeenCalled();
      expect(cleanup.mock.calls.map((call) => call[0])).toEqual(clones);
    });
  }
  it("cleans the fresh outer checkout after a follow-up failure", async () => {
    const job = await settle((await start("packages/app")).body.jobId);
    ask.mockRejectedValueOnce(new Error("private provider failure"));
    const response = await request(server)
      .post(`/api/jobs/${job.id}/ask`)
      .send({ question: "Where?" });
    expect(response.status).toBe(500);
    expect(response.body.error).not.toContain("private provider failure");
    expect(cleanup.mock.calls.map((call) => call[0])).toEqual(clones);
    await expect.poll(() => exists(clones[1])).toBe(false);
  });
  it("rechecks package containment on follow-up and cleans a changed checkout", async () => {
    const job = await settle((await start("packages/app")).body.jobId);
    alterClone = async (dir) => {
      await rm(join(dir, "packages/app"), { recursive: true });
      await symlink(
        root,
        join(dir, "packages/app"),
        process.platform === "win32" ? "junction" : "dir"
      );
    };
    const response = await request(server)
      .post(`/api/jobs/${job.id}/ask`)
      .send({ question: "Where?" });
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain(root);
    expect(ask).not.toHaveBeenCalled();
    expect(cleanup.mock.calls.map((call) => call[0])).toEqual(clones);
    await expect.poll(() => exists(clones[1])).toBe(false);
  });
  it("cancels a selected-package run after cloning and cleans the outer checkout", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    holdClone = () => gate;
    const started = await start("packages/app");
    await expect.poll(() => clones.length).toBe(1);
    const pending = await request(server).get(`/api/jobs/${started.body.jobId}`);
    expect(pending.body.subdir).toBe("packages/app");
    expect((await request(server).post(`/api/jobs/${started.body.jobId}/cancel`)).status).toBe(202);
    release();
    const job = await settle(started.body.jobId);
    expect(job.status).toBe("cancelled");
    expect(analyze).not.toHaveBeenCalled();
    expect(cleanup.mock.calls.map((call) => call[0])).toEqual(clones);
  });
});
