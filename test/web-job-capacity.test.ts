import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { Application, Request, RequestHandler, Response } from "express";
import type { RmOptions, PathLike } from "node:fs";
import type { BootcampOptions } from "../src/types.js";
import type { Server } from "node:http";

const cleanups: (() => Promise<void>)[] = [];

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
interface ResponseBody {
  jobId?: string;
  status?: string;
  result?: { outputDir: string };
}

function response() {
  const value = { statusCode: 200, body: {} as ResponseBody };
  return {
    value,
    status(code: number) {
      value.statusCode = code;
      return this;
    },
    json(body: unknown) {
      value.body = body as ResponseBody;
      return this;
    },
  };
}
async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Seed pre-existing jobs through the actual business handler; only the small
// concurrent request batch uses HTTP, preserving the real per-IP rate policy.
async function setup() {
  vi.resetModules();
  const root = await mkdtemp(join(tmpdir(), "owned-web-capacity-"));
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
  const heldAnalysis = deferred();
  const cleanupGate = deferred();
  let holdCleanup = false;
  let cleanupError: Error | undefined;
  const cleanupCalls: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args) =>
    errors.push(args.map(String).join(" "))
  );
  vi.doMock("os", async () => ({
    ...(await vi.importActual<typeof import("os")>("os")),
    homedir: () => join(root, "owned-cache-home"),
  }));
  vi.doMock("node:os", async () => ({
    ...(await vi.importActual<typeof import("node:os")>("node:os")),
    homedir: () => join(root, "owned-cache-home"),
  }));
  vi.doMock("../src/ingest.js", () => ({
    parseGitHubUrl: (url: string) => ({
      owner: "owned",
      repo: "repo",
      fullName: "owned/repo",
      url,
      branch: "main",
    }),
  }));
  vi.doMock("../src/interactive.js", () => ({ quickAsk: vi.fn() }));
  const resolveRunConfiguration = vi.fn(async (options: BootcampOptions) => {
    if (options.branch === "held") await heldAnalysis.promise;
    return { config: null, styleConfig: { firstTasksCount: 3 }, outputFormat: "markdown" };
  });
  vi.doMock("../src/services/config-resolution.js", () => ({
    normalizeScanScope: vi.fn(),
    resolveRunConfiguration,
  }));
  const clone = vi.fn(async () => join(root, "mock-checkout"));
  vi.doMock("../src/services/clone-service.js", () => ({
    cloneRepository: clone,
    scanRepositoryFiles: async () => ({
      files: [],
      keySourceFiles: new Map(),
      stack: { languages: [], frameworks: [], packageManager: null },
    }),
    cleanupRepository: vi.fn(),
  }));
  const facts = { firstTasks: [], stack: {}, quickstart: { commands: [] } };
  vi.doMock("../src/services/analysis-orchestration.js", () => ({
    orchestrateAnalysis: async () => ({ facts, toolCalls: 0, durationMs: 0, model: "owned-mock" }),
    prepareOutputDocuments: async () => ({
      documents: [{ name: "BOOTCAMP.md", content: "# Owned fixture" }],
      facts,
      security: { score: 100, findings: [], sourceFilesScanned: 0 },
      radar: { onboardingRisk: { score: 0, grade: "A", factors: [] } },
      deps: { totalCount: 0 },
      outputTargets: [],
    }),
  }));
  vi.doMock("../src/services/output-writer.js", () => ({
    writeGeneratedOutputs: async ({ outputDir }: { outputDir: string }) => {
      await writeFile(join(outputDir, "BOOTCAMP.md"), "# Owned fixture");
      return { documentCount: 1 };
    },
  }));
  vi.doMock("fs/promises", async () => ({
    ...(await vi.importActual<typeof import("fs/promises")>("fs/promises")),
    rm: async (path: PathLike, options?: RmOptions) => {
      cleanupCalls.push(String(path));
      if (holdCleanup) await cleanupGate.promise;
      if (cleanupError) throw cleanupError;
      await rm(path, options);
    },
  }));
  const { default: express } = await import("express");
  const routes = await import("../src/web/routes.js");
  const app = express();
  app.use(express.json());
  const handlers = new Map<string, RequestHandler>();
  const registration = {
    post(path: string, ...functions: RequestHandler[]) {
      handlers.set("POST " + path, functions.at(-1)!);
      app.post(path, ...functions);
    },
    get(path: string, ...functions: RequestHandler[]) {
      handlers.set("GET " + path, functions.at(-1)!);
      app.get(path, ...functions);
    },
  };
  routes.registerRoutes(registration as unknown as Application);
  const ids: string[] = [];
  async function start(held = true) {
    const res = response();
    await handlers.get("POST /api/analyze")!(
      {
        body: { repoUrl: "https://github.com/owned/repo", options: held ? { branch: "held" } : {} },
      } as unknown as Request,
      res as unknown as Response,
      () => {}
    );
    if (res.value.body.jobId) ids.push(res.value.body.jobId);
    return res.value;
  }
  function status(id: string) {
    const res = response();
    handlers.get("GET /api/jobs/:jobId")!(
      { params: { jobId: id } } as unknown as Request,
      res as unknown as Response,
      () => {}
    );
    return res.value;
  }
  function live() {
    return ids.filter((id) => status(id).statusCode === 200);
  }
  async function terminal(id: string) {
    await expect.poll(() => status(id).body?.status).toBe("complete");
  }
  let server: Server | undefined;
  async function listen() {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    return request(server);
  }
  cleanups.push(async () => {
    holdCleanup = false;
    cleanupError = undefined;
    cleanupGate.resolve();
    heldAnalysis.reject(new Error("Owned fixture shutdown"));
    await expect
      .poll(
        () => live().filter((id) => /^(pending|running)$/.test(status(id).body.status ?? "")).length
      )
      .toBe(0);
    await routes.pruneExpiredJobs(Date.now() + 31 * 60 * 1000);
    routes.stopJobPruner();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    cwd.mockRestore();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    start,
    status,
    live,
    terminal,
    ids,
    clone,
    resolveRunConfiguration,
    cleanupCalls,
    errors,
    routes,
    listen,
    failCleanup: (error: Error) => {
      cleanupError = error;
    },
    failOutputRoot: () => {
      cwd.mockImplementationOnce(() => {
        throw new Error("Owned output root failure");
      });
    },
    holdCleanup: () => {
      holdCleanup = true;
    },
    releaseCleanup: cleanupGate.resolve,
  };
}

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  vi.restoreAllMocks();
});

describe("web job capacity and owned output cleanup", () => {
  it("normal all-running cap rejects without removing an active job", async () => {
    const s = await setup();
    for (let i = 0; i < 100; i++) expect((await s.start()).statusCode).toBe(200);
    const rejected = await s.start();
    expect(rejected.statusCode).toBe(503);
    expect(s.live()).toHaveLength(100);
    expect(s.cleanupCalls).toHaveLength(0);
    expect(s.clone).not.toHaveBeenCalled();
  });
  it("sequential replacement retains 100 and cleans only owned terminal output", async () => {
    const s = await setup();
    const completed = (await s.start(false)).body.jobId!;
    await s.terminal(completed);
    const output = s.status(completed).body.result!.outputDir;
    for (let i = 0; i < 99; i++) await s.start();
    const admitted = await s.start();
    expect(admitted.statusCode).toBe(200);
    expect(s.live()).toHaveLength(100);
    expect(s.status(completed).statusCode).toBe(404);
    expect(await exists(dirname(output))).toBe(false);
    expect(s.cleanupCalls).toEqual([dirname(output)]);
  });
  it("reserves the slot even when an evicted error job has no output to remove", async () => {
    const s = await setup();
    s.resolveRunConfiguration.mockRejectedValueOnce(new Error("Owned analysis failure"));
    const failed = (await s.start(false)).body.jobId!;
    await expect.poll(() => s.status(failed).body.status).toBe("error");
    for (let i = 0; i < 99; i++) await s.start();
    const admitted = await Promise.all([s.start(), s.start()]);
    expect(admitted.map((result) => result.statusCode).sort()).toEqual([200, 503]);
    expect(s.live()).toHaveLength(100);
    expect(s.status(failed).statusCode).toBe(404);
    expect(s.cleanupCalls).toHaveLength(0);
    expect(s.clone).not.toHaveBeenCalled();
  });
  it("reserves the evicted slot before cleanup so a competing HTTP start is rejected", async () => {
    const s = await setup();
    const completed = (await s.start(false)).body.jobId!;
    await s.terminal(completed);
    for (let i = 0; i < 99; i++) await s.start();
    const http = await s.listen();
    s.holdCleanup();
    let firstResponded = false;
    const first = http
      .post("/api/analyze")
      .send({ repoUrl: "https://github.com/owned/repo", options: { branch: "held" } })
      .then((result) => {
        firstResponded = true;
        return result;
      });
    await expect.poll(() => s.cleanupCalls.length).toBe(1);
    expect(s.live()).toHaveLength(99);
    const second = await http
      .post("/api/analyze")
      .send({ repoUrl: "https://github.com/owned/repo", options: { branch: "held" } });
    expect(second.status).toBe(503);
    // The replacement is reserved but neither its analysis nor response starts before cleanup.
    expect(s.resolveRunConfiguration).toHaveBeenCalledTimes(100);
    expect(firstResponded).toBe(false);
    s.releaseCleanup();
    const resumed = await first;
    expect(resumed.status).toBe(200);
    expect(s.resolveRunConfiguration).toHaveBeenCalledTimes(101);
    s.ids.push(resumed.body.jobId);
    expect(s.live()).toHaveLength(100);
    const third = await http
      .post("/api/analyze")
      .send({ repoUrl: "https://github.com/owned/repo", options: { branch: "held" } });
    expect(third.status).toBe(503);
    await http.post("/api/analyze").send({});
    await http.post("/api/analyze").send({});
    const sixth = await http.post("/api/analyze").send({});
    expect(sixth.status).toBe(429);
    expect(sixth.headers["ratelimit-limit"]).toBe("5");
  });
  it("reserves each replacement in a concurrent batch without consuming active slots", async () => {
    const s = await setup();
    const completed: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = (await s.start(false)).body.jobId!;
      await s.terminal(id);
      completed.push(id);
    }
    for (let i = 0; i < 97; i++) await s.start();
    const http = await s.listen();
    s.holdCleanup();
    const pending = Array.from({ length: 3 }, () =>
      http
        .post("/api/analyze")
        .send({ repoUrl: "https://github.com/owned/repo", options: { branch: "held" } })
        .then((result) => result)
    );
    await expect.poll(() => s.cleanupCalls.length).toBe(3);
    const rejected = await http
      .post("/api/analyze")
      .send({ repoUrl: "https://github.com/owned/repo", options: { branch: "held" } });
    expect(rejected.status).toBe(503);
    expect(s.resolveRunConfiguration).toHaveBeenCalledTimes(100);
    s.releaseCleanup();
    for (const result of await Promise.all(pending)) {
      expect(result.status).toBe(200);
      s.ids.push(result.body.jobId);
    }
    expect(s.live()).toHaveLength(100);
    for (const id of completed) expect(s.status(id).statusCode).toBe(404);
    expect(s.resolveRunConfiguration).toHaveBeenCalledTimes(103);
  });
  it("retains admission and logs an owned filesystem cleanup failure", async () => {
    const s = await setup();
    const completed = (await s.start(false)).body.jobId!;
    await s.terminal(completed);
    const originalOutput = s.status(completed).body.result!.outputDir;
    for (let i = 0; i < 99; i++) await s.start();
    s.failCleanup(new Error("Owned rm failure"));
    const admitted = await s.start();
    expect(admitted.statusCode).toBe(200);
    expect(s.live()).toHaveLength(100);
    expect(s.status(completed).statusCode).toBe(404);
    expect(await exists(originalOutput)).toBe(true);
    expect(
      s.errors.some(
        (error) => error.includes("Failed to remove output") && error.includes("Owned rm failure")
      )
    ).toBe(true);
  });
  it("releases only its unstarted reservation after an unexpected cleanup rejection", async () => {
    const s = await setup();
    const completed = (await s.start(false)).body.jobId!;
    await s.terminal(completed);
    for (let i = 0; i < 99; i++) await s.start();
    s.failOutputRoot();
    const rejected = await s.start();
    expect(rejected.statusCode).toBe(500);
    expect(s.live()).toHaveLength(99);
    expect(s.resolveRunConfiguration).toHaveBeenCalledTimes(100);
    expect((await s.start()).statusCode).toBe(200);
    expect(s.live()).toHaveLength(100);
  });
  it("expiration preserves active jobs and refuses an output outside its owned job tree", async () => {
    const s = await setup();
    const valid = (await s.start(false)).body.jobId!;
    await s.terminal(valid);
    const originalOutput = s.status(valid).body.result!.outputDir;
    const malformed = (await s.start(false)).body.jobId!;
    await s.terminal(malformed);
    const outside = join(s.root, "outside-keep", "repo");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "sentinel"), "preserve");
    s.status(malformed).body.result!.outputDir = outside;
    const active = (await s.start()).body.jobId!;
    await s.routes.pruneExpiredJobs(Date.now() + 31 * 60 * 1000);
    expect(s.status(valid).statusCode).toBe(404);
    expect(s.status(malformed).statusCode).toBe(404);
    expect(s.status(active).body.status).toBe("running");
    expect(await exists(dirname(originalOutput))).toBe(false);
    expect(await exists(join(outside, "sentinel"))).toBe(true);
    expect(s.errors.some((e) => e.includes("Refusing to remove unexpected job output"))).toBe(true);
  });
});
