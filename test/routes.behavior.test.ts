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
      { name: "repo_facts.json", content: "{\"ok\":true}" },
    ],
    facts,
    security: { score: 82 },
    radar: { onboardingRisk: { score: 30, grade: "B", factors: [] } },
    deps: { totalCount: 5 },
    outputTargets: [],
  });
  const writeGeneratedOutputs = vi.fn().mockResolvedValue({ documentCount: 2 });
  const applyOutputFormat = vi.fn().mockImplementation((docs) => docs);
  const readFile = vi.fn().mockResolvedValue("# Bootcamp");
  const mkdir = vi.fn().mockResolvedValue(undefined);

  vi.doMock("../src/ingest.js", () => ({
    parseGitHubUrl,
  }));
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
    const actual = await vi.importActual<typeof import("../src/formatter.js")>("../src/formatter.js");
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
      mkdir,
    };
  });

  const { default: express } = await import("express");
  const { registerRoutes, startJobPruner, stopJobPruner } = await import("../src/web/routes.js");
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
      applyOutputFormat,
      readFile,
    },
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
    expect(startResponse.body.jobId).toBeTruthy();

    const jobId = startResponse.body.jobId as string;
    const statusResponse = await waitForTerminalStatus(http, jobId);
    expect(statusResponse.body.status).toBe("complete");
    expect(statusResponse.body.result.files).toContain("BOOTCAMP.md");

    const streamResponse = await http.get(`/api/jobs/${jobId}/stream`);
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.text).toContain("\"type\":\"complete\"");

    const fileResponse = await http.get(`/api/jobs/${jobId}/files/BOOTCAMP.md`);
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.text).toContain("Bootcamp");

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
    expect(statusResponse.body.error).toBe("scan failed");

    const streamResponse = await http.get(`/api/jobs/${jobId}/stream`);
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.text).toContain("\"type\":\"error\"");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[web] Failed to clean up temporary repository:")
    );
  });

  it("rejects unsafe filenames and returns file read errors", async () => {
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
    expect(failedReadResponse.body.error).toBe("disk failure");
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
});
