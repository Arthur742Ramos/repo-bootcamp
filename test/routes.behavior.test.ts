import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepoFacts } from "../src/types.js";

type SetupOverrides = {
  scanRepositoryFilesError?: Error;
  cleanupRepositoryError?: Error;
};

async function setupRoutes(overrides: SetupOverrides = {}) {
  vi.resetModules();

  const parseGitHubUrl = vi.fn().mockReturnValue({
    owner: "owner",
    repo: "repo",
    url: "https://github.com/owner/repo",
    branch: "main",
    fullName: "owner/repo",
  });
  const resolveRunConfiguration = vi.fn().mockResolvedValue({
    config: null,
    styleConfig: { firstTasksCount: 3 },
    outputFormat: "markdown",
  });
  const cloneRepository = vi.fn().mockResolvedValue("/tmp/mock-routes-repo");
  const scanRepositoryFiles = overrides.scanRepositoryFilesError
    ? vi.fn().mockRejectedValue(overrides.scanRepositoryFilesError)
    : vi.fn().mockResolvedValue({
        files: [{ path: "src/index.ts", size: 10, isDirectory: false }],
        stack: {
          languages: ["TypeScript"],
          frameworks: [],
          buildSystem: "npm",
          packageManager: "npm",
          hasDocker: false,
          hasCi: true,
        },
        commands: [],
        ciWorkflows: [],
        readme: "# repo",
        contributing: null,
        keySourceFiles: new Map([["src/index.ts", "export const x = 1;"]]),
      });
  const cleanupRepository = overrides.cleanupRepositoryError
    ? vi.fn().mockRejectedValue(overrides.cleanupRepositoryError)
    : vi.fn().mockResolvedValue(undefined);

  const facts = {
    firstTasks: [],
    stack: {
      packageManager: "npm",
    },
  } as unknown as RepoFacts;
  const orchestrateAnalysis = vi.fn().mockResolvedValue({
    facts,
    durationMs: 1,
    toolCalls: 2,
    model: "mock-model",
  });
  const prepareOutputDocuments = vi.fn().mockResolvedValue({
    documents: [
      { name: "BOOTCAMP.md", content: "# Bootcamp" },
      { name: "repo_facts.json", content: '{"ok":true}' },
    ],
    facts,
    security: { score: 82, findings: [], sourceFilesScanned: 1 },
    radar: { onboardingRisk: { score: 30, grade: "B", factors: [] } },
    deps: { totalCount: 5 },
    outputTargets: [],
  });
  const writeGeneratedOutputs = vi.fn().mockResolvedValue({ documentCount: 2 });
  const quickAsk = vi.fn().mockResolvedValue("Start with src/index.ts, then run the test task.");
  const applyOutputFormat = vi.fn().mockImplementation((docs) => docs);
  const readFile = vi.fn().mockResolvedValue("# Bootcamp");
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const mkdir = vi.fn().mockResolvedValue(undefined);
  const rm = vi.fn().mockResolvedValue(undefined);

  vi.doMock("../src/ingest.js", () => ({
    parseGitHubUrl,
  }));
  vi.doMock("../src/interactive.js", () => ({ quickAsk }));
  vi.doMock("../src/services/config-resolution.js", () => ({
    resolveRunConfiguration,
  }));
  vi.doMock("../src/services/clone-service.js", () => ({
    cloneRepository,
    scanRepositoryFiles,
    cleanupRepository,
  }));
  vi.doMock("../src/services/analysis-orchestration.js", () => ({
    orchestrateAnalysis,
    prepareOutputDocuments,
  }));
  vi.doMock("../src/services/output-writer.js", () => ({
    writeGeneratedOutputs,
  }));
  vi.doMock("../src/formatter.js", async () => {
    const actual =
      await vi.importActual<typeof import("../src/formatter.js")>("../src/formatter.js");
    return {
      ...actual,
      applyOutputFormat,
    };
  });
  vi.doMock("fs/promises", async () => {
    const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
    return {
      ...actual,
      readFile,
      writeFile,
      mkdir,
      rm,
    };
  });

  const { default: express } = await import("express");
  const { registerRoutes, pruneExpiredJobs, startJobPruner, stopJobPruner } =
    await import("../src/web/routes.js");
  const app = express();
  app.use(express.json());
  registerRoutes(app);

  return {
    app,
    mocks: {
      parseGitHubUrl,
      cloneRepository,
      scanRepositoryFiles,
      cleanupRepository,
      orchestrateAnalysis,
      prepareOutputDocuments,
      writeGeneratedOutputs,
      quickAsk,
      applyOutputFormat,
      readFile,
      writeFile,
      rm,
    },
    pruneExpiredJobs,
    startJobPruner,
    stopJobPruner,
  };
}

async function waitForTerminalStatus(app: ReturnType<typeof request>, jobId: string) {
  for (let i = 0; i < 40; i++) {
    const statusResponse = await app.get(`/api/jobs/${jobId}`);
    const status = statusResponse.body.status as string;
    if (status === "complete" || status === "error") {
      return statusResponse;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for job to finish");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("web routes analysis lifecycle", () => {
  it("completes an analysis job and serves generated files", async () => {
    const { app, mocks } = await setupRoutes();
    const http = request(app);

    const startResponse = await http
      .post("/api/analyze")
      .send({ repoUrl: "https://github.com/owner/repo" });

    expect(startResponse.status).toBe(200);
    expect(startResponse.body.jobId).toMatch(
      /^job_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );

    const jobId = startResponse.body.jobId as string;
    const statusResponse = await waitForTerminalStatus(http, jobId);
    expect(statusResponse.body.status).toBe("complete");
    expect(statusResponse.body.result.files).toContain("BOOTCAMP.md");
    expect(statusResponse.body.result.files).toContain("ANALYSIS_MANIFEST.json");
    expect(statusResponse.body.result.quickstartCommands).toEqual([]);
    expect(statusResponse.body.result.scoreDetails).toEqual({
      security: { findings: 0, scannedFiles: 1 },
      onboardingRisk: { factors: [] },
    });

    const streamResponse = await http.get(`/api/jobs/${jobId}/stream`);
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.text).toContain('"type":"complete"');
    expect(streamResponse.headers["cache-control"]).toContain("no-transform");
    expect(streamResponse.headers["x-accel-buffering"]).toBe("no");

    const fileResponse = await http.get(`/api/jobs/${jobId}/files/BOOTCAMP.md`);
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.text).toContain("Bootcamp");
    // Generated files are served as inert text/plain (stored-XSS defense),
    // never as an active content type the dashboard origin would render.
    expect(fileResponse.headers["content-type"]).toContain("text/plain");

    const jsonFileResponse = await http.get(`/api/jobs/${jobId}/files/repo_facts.json`);
    expect(jsonFileResponse.status).toBe(200);
    expect(jsonFileResponse.headers["content-type"]).toContain("text/plain");
    expect(jsonFileResponse.headers["content-type"]).not.toContain("application/json");

    const downloadResponse = await http.get(`/api/jobs/${jobId}/download`);
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers["content-type"]).toContain("application/zip");
    expect(downloadResponse.headers["content-disposition"]).toContain("bootcamp.zip");

    const completedCancelResponse = await http.post(`/api/jobs/${jobId}/cancel`);
    expect(completedCancelResponse.status).toBe(409);

    const askResponse = await http.post(`/api/jobs/${jobId}/ask`).send({
      question: "Where should I start reading?",
    });
    expect(askResponse.status).toBe(200);
    expect(askResponse.body.answer).toContain("src/index.ts");
    expect(mocks.quickAsk).toHaveBeenCalledWith(
      "/tmp/mock-routes-repo",
      expect.objectContaining({ fullName: "owner/repo" }),
      expect.anything(),
      "Where should I start reading?",
      false,
      "mock-model"
    );

    expect(mocks.parseGitHubUrl).toHaveBeenCalled();
    expect(mocks.cloneRepository).toHaveBeenCalled();
    expect(mocks.orchestrateAnalysis).toHaveBeenCalled();
    expect(mocks.prepareOutputDocuments).toHaveBeenCalled();
    expect(mocks.writeGeneratedOutputs).toHaveBeenCalled();
  });

  it("marks jobs as error and reports cleanup failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = await setupRoutes({
      scanRepositoryFilesError: new Error("scan failed"),
      cleanupRepositoryError: new Error("cleanup failed"),
    });
    const http = request(app);

    const startResponse = await http
      .post("/api/analyze")
      .send({ repoUrl: "https://github.com/owner/repo" });
    const jobId = startResponse.body.jobId as string;

    const statusResponse = await waitForTerminalStatus(http, jobId);
    expect(statusResponse.body.status).toBe("error");
    // Client sees a generic message; the raw "scan failed" detail (which for
    // real clone/scan failures embeds git stderr / FS paths) is logged instead.
    expect(statusResponse.body.error).toBe(
      "Analysis failed. Please check the repository URL and try again."
    );
    expect(statusResponse.body.error).not.toContain("scan failed");

    const streamResponse = await http.get(`/api/jobs/${jobId}/stream`);
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.text).toContain('"type":"error"');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[web] Failed to clean up temporary repository:")
    );
  });

  it("rejects unsafe filenames and returns file read errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app, mocks } = await setupRoutes();
    const http = request(app);

    const startResponse = await http
      .post("/api/analyze")
      .send({ repoUrl: "https://github.com/owner/repo" });
    const jobId = startResponse.body.jobId as string;
    await waitForTerminalStatus(http, jobId);

    const invalidResponse = await http.get(`/api/jobs/${jobId}/files/sub%5Cfile.md`);
    expect(invalidResponse.status).toBe(400);

    mocks.readFile.mockRejectedValueOnce(new Error("disk failure"));
    const failedReadResponse = await http.get(`/api/jobs/${jobId}/files/BOOTCAMP.md`);
    expect(failedReadResponse.status).toBe(500);
    // Generic message only; the raw FS error (which can leak paths) is logged.
    expect(failedReadResponse.body.error).toBe("Failed to read generated file");
    expect(failedReadResponse.body.error).not.toContain("disk failure");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns a clear error for cancelling an unknown job", async () => {
    const { app } = await setupRoutes();
    const response = await request(app).post("/api/jobs/job_missing/cancel");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Job not found");
  });

  it("returns a clear error for asking an unknown job", async () => {
    const { app } = await setupRoutes();
    const response = await request(app).post("/api/jobs/job_missing/ask").send({ question: "" });
    expect(response.status).toBe(404);
  });

  it("clamps and allowlists client-supplied options", async () => {
    const { app, mocks } = await setupRoutes();
    const http = request(app);

    const startResponse = await http.post("/api/analyze").send({
      repoUrl: "https://github.com/owner/repo",
      options: {
        maxFiles: 5_000_000,
        fullClone: true,
        focus: "not-a-real-focus",
        format: "exe",
      },
    });
    const jobId = startResponse.body.jobId as string;
    const statusResponse = await waitForTerminalStatus(http, jobId);

    // Invalid enum values are allowlisted back to safe defaults, so the job
    // still completes rather than erroring on the attacker-supplied payload.
    expect(statusResponse.body.status).toBe("complete");
    // maxFiles is clamped to the web ceiling (1000), not the 5,000,000 requested.
    expect(mocks.scanRepositoryFiles).toHaveBeenCalledWith("/tmp/mock-routes-repo", 1000);
    // fullClone is forced off regardless of the request payload.
    expect(mocks.cloneRepository).toHaveBeenCalledWith(expect.anything(), undefined, false);
  });

  it("starts and stops the job pruner idempotently", async () => {
    const { startJobPruner, stopJobPruner } = await setupRoutes();

    expect(() => {
      startJobPruner();
      startJobPruner();
      stopJobPruner();
      stopJobPruner();
    }).not.toThrow();
  });

  it("removes expired jobs and their generated artifacts", async () => {
    const { app, mocks, pruneExpiredJobs } = await setupRoutes();
    const http = request(app);
    const startResponse = await http
      .post("/api/analyze")
      .send({ repoUrl: "https://github.com/owner/repo" });
    const jobId = startResponse.body.jobId as string;
    await waitForTerminalStatus(http, jobId);

    await pruneExpiredJobs(Date.now() + 31 * 60 * 1000);

    expect(mocks.rm).toHaveBeenCalledWith(expect.stringContaining(jobId), {
      recursive: true,
      force: true,
    });
    expect((await http.get(`/api/jobs/${jobId}`)).status).toBe(404);
  });
});
