import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("chalk", () => {
  const makeChalk = (): any =>
    new Proxy((...args: any[]) => args.join(""), {
      get: () => makeChalk(),
      apply: (_t: any, _a: any, args: any[]) => args.join(""),
    });
  return { default: makeChalk() };
});

vi.mock("../src/ingest.js", () => ({
  parseGitHubUrl: vi.fn((url: string) => {
    if (url.includes("invalid")) throw new Error("Invalid GitHub URL");
    return { owner: "test", repo: "repo", fullName: "test/repo", url, branch: "main" };
  }),
}));

vi.mock("../src/services/clone-service.js", () => ({
  cloneRepository: vi.fn().mockResolvedValue("/tmp/cloned"),
  scanRepositoryFiles: vi.fn().mockResolvedValue({
    files: [{ path: "a.ts" }],
    keySourceFiles: new Set(),
    stack: { languages: ["TS"], packageManager: "npm" },
  }),
  cleanupRepository: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/services/config-resolution.js", () => ({
  resolveRunConfiguration: vi.fn().mockResolvedValue({
    config: null,
    styleConfig: { name: "oss", firstTasksCount: 5, sections: {} },
    outputFormat: "markdown",
  }),
  resolveOutputFormat: vi.fn((f: string) => f),
}));

vi.mock("../src/services/analysis-orchestration.js", () => ({
  orchestrateAnalysis: vi.fn().mockResolvedValue({
    facts: { firstTasks: [], stack: {} },
    toolCalls: 5,
    model: "test-model",
    analysisStats: { toolCalls: [] },
    durationMs: 100,
  }),
  prepareOutputDocuments: vi.fn().mockResolvedValue({
    documents: [{ name: "BOOTCAMP.md", content: "# Boot" }],
    facts: { firstTasks: [], stack: {} },
    security: { score: 90 },
    radar: { onboardingRisk: { score: 20, grade: "A" } },
    deps: { totalCount: 5, runtime: [1, 2], dev: [3, 4, 5] },
    outputTargets: [],
  }),
}));

vi.mock("../src/services/output-writer.js", () => ({
  writeGeneratedOutputs: vi.fn().mockResolvedValue({ documentCount: 1 }),
}));

vi.mock("../src/formatter.js", () => ({
  applyOutputFormat: vi.fn((docs: any[]) => docs),
}));

vi.mock("../src/security.js", () => ({
  getSecurityGrade: vi.fn().mockReturnValue("A"),
}));

vi.mock("../src/progress.js", () => {
  class MockProgressTracker {
    startPhase = vi.fn();
    succeed = vi.fn();
    fail = vi.fn();
    warn = vi.fn();
    update = vi.fn();
    stop = vi.fn();
  }
  return { ProgressTracker: MockProgressTracker };
});

vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue("# Generated content"),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

import express from "express";
import { registerRoutes, startJobPruner, stopJobPruner } from "../src/web/routes.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  registerRoutes(app);
  return app;
}

describe("web routes", () => {
  afterEach(() => {
    stopJobPruner();
  });

  describe("POST /api/analyze", () => {
    it("returns jobId for valid request", async () => {
      const app = createTestApp();
      const res = await request(app)
        .post("/api/analyze")
        .send({ repoUrl: "https://github.com/test/repo" });
      expect(res.status).toBe(200);
      expect(res.body.jobId).toBeDefined();
    });

    it("rejects missing repoUrl", async () => {
      const app = createTestApp();
      const res = await request(app).post("/api/analyze").send({});
      expect(res.status).toBe(400);
    });

    it("rejects non-string repoUrl", async () => {
      const app = createTestApp();
      const res = await request(app).post("/api/analyze").send({ repoUrl: 123 });
      expect(res.status).toBe(400);
    });

    it("rejects too-long repoUrl", async () => {
      const app = createTestApp();
      const res = await request(app)
        .post("/api/analyze")
        .send({ repoUrl: "x".repeat(501) });
      expect(res.status).toBe(400);
    });

    it("rejects invalid GitHub URL", async () => {
      const app = createTestApp();
      const res = await request(app).post("/api/analyze").send({ repoUrl: "invalid-url" });
      expect(res.status).toBe(400);
    });

    it("rejects non-object body", async () => {
      const app = createTestApp();
      const res = await request(app)
        .post("/api/analyze")
        .send("not json")
        .set("Content-Type", "application/json");
      expect(res.status).toBe(400);
    });

    it("rejects non-object options", async () => {
      const app = createTestApp();
      const res = await request(app)
        .post("/api/analyze")
        .send({ repoUrl: "https://github.com/test/repo", options: "bad" });
      expect(res.status).toBe(400);
    });

    it("accepts valid options object", async () => {
      const app = createTestApp();
      const res = await request(app)
        .post("/api/analyze")
        .send({ repoUrl: "https://github.com/test/repo", options: { branch: "dev" } });
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/jobs/:jobId", () => {
    it("returns 404 for unknown job", async () => {
      const app = createTestApp();
      const res = await request(app).get("/api/jobs/nonexistent");
      expect(res.status).toBe(404);
    });

    it("returns job status after creation", async () => {
      const app = createTestApp();
      const createRes = await request(app)
        .post("/api/analyze")
        .send({ repoUrl: "https://github.com/test/repo" });
      const jobId = createRes.body.jobId;
      const res = await request(app).get(`/api/jobs/${jobId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(jobId);
    });
  });

  describe("GET /api/jobs/:jobId/files/:filename", () => {
    it("rejects path traversal", async () => {
      const app = createTestApp();
      const res = await request(app).get("/api/jobs/somejob/files/..%2F..%2Fetc%2Fpasswd");
      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown job", async () => {
      const app = createTestApp();
      const res = await request(app).get("/api/jobs/nonexistent/files/test.md");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/jobs/:jobId/stream", () => {
    it("returns 404 for unknown job", async () => {
      const app = createTestApp();
      const res = await request(app).get("/api/jobs/nonexistent/stream");
      expect(res.status).toBe(404);
    });
  });

  describe("job pruner", () => {
    it("starts and stops without error", () => {
      startJobPruner();
      startJobPruner(); // idempotent
      stopJobPruner();
      stopJobPruner(); // idempotent
    });
  });
});
