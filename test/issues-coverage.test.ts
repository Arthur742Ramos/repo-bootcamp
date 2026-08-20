import { describe, it, expect, vi, beforeEach } from "vitest";
import { createIssuesFromTasks, generateIssuePreview, taskToIssuePayload } from "../src/issues.js";
import type { FirstTask, RepoInfo } from "../src/types.js";

describe("createIssuesFromTasks - coverage", () => {
  const mockRepoInfo: RepoInfo = {
    owner: "testowner",
    repo: "testrepo",
    url: "https://github.com/testowner/testrepo",
    branch: "main",
    fullName: "testowner/testrepo",
  };

  const mockTasks: FirstTask[] = [
    {
      title: "Add docs for API",
      description: "API docs are missing.",
      difficulty: "beginner",
      category: "docs",
      files: ["docs/api.md"],
      why: "Helps newcomers understand the API.",
    },
    {
      title: "Add feature X",
      description: "Feature X is needed.",
      difficulty: "intermediate",
      category: "feature",
      files: ["src/feature-x.ts"],
      why: "Core functionality.",
    },
  ];

  it("should handle dryRun mode", async () => {
    const results = await createIssuesFromTasks(mockTasks, mockRepoInfo, { dryRun: true });
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
  });

  it("should handle dryRun with verbose", async () => {
    const results = await createIssuesFromTasks(mockTasks, mockRepoInfo, {
      dryRun: true,
      verbose: true,
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("should map docs category to documentation label", () => {
    const payload = taskToIssuePayload(mockTasks[0], mockRepoInfo);
    expect(payload.labels).toContain("documentation");
  });

  it("should map feature category to enhancement label", () => {
    const payload = taskToIssuePayload(mockTasks[1], mockRepoInfo);
    expect(payload.labels).toContain("enhancement");
  });

  it("should include intermediate difficulty text", () => {
    const payload = taskToIssuePayload(mockTasks[1], mockRepoInfo);
    expect(payload.body).toContain("Some familiarity with the codebase helpful");
  });

  it("should include advanced difficulty text", () => {
    const advancedTask: FirstTask = { ...mockTasks[0], difficulty: "advanced" };
    const payload = taskToIssuePayload(advancedTask, mockRepoInfo);
    expect(payload.body).toContain("Requires deep understanding");
  });

  it("should handle empty tasks array in dryRun", async () => {
    const results = await createIssuesFromTasks([], mockRepoInfo, { dryRun: true });
    expect(results).toHaveLength(0);
  });
});

// Additional branch coverage for issues.ts (using imports declared at the top)

describe("issues extra branches", () => {
  const repoInfo = {
    owner: "t",
    repo: "r",
    url: "https://github.com/t/r",
    branch: "main",
    fullName: "t/r",
  } as any;

  it("intermediate difficulty", () => {
    const task = {
      title: "T",
      description: "D",
      difficulty: "intermediate",
      category: "feature",
      files: ["a.ts"],
      why: "W",
    } as any;
    const p = taskToIssuePayload(task, repoInfo);
    expect(p.labels).toContain("help wanted");
    expect(p.labels).toContain("enhancement");
    expect(p.body).toContain("familiarity");
  });

  it("docs category", () => {
    const task = {
      title: "T",
      description: "D",
      difficulty: "beginner",
      category: "docs",
      files: ["a.md"],
      why: "W",
    } as any;
    const p = taskToIssuePayload(task, repoInfo);
    expect(p.labels).toContain("documentation");
  });

  it("advanced difficulty text", () => {
    const task = {
      title: "T",
      description: "D",
      difficulty: "advanced",
      category: "refactor",
      files: ["a.ts"],
      why: "W",
    } as any;
    const p = taskToIssuePayload(task, repoInfo);
    expect(p.body).toContain("deep understanding");
    expect(p.labels).toContain("enhancement");
    expect(p.labels).toContain("refactor");
  });

  it("preview with tasks shows commands", () => {
    const tasks = [
      {
        title: "T1",
        description: "D1",
        difficulty: "beginner",
        category: "test",
        files: ["a.ts"],
        why: "W1",
      },
    ] as any[];
    const preview = generateIssuePreview(tasks, repoInfo);
    expect(preview).toContain("--create-issues");
    expect(preview).toContain("--dry-run");
  });
});
