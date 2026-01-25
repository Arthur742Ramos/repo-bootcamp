import { describe, it, expect } from "vitest";
import { taskToIssuePayload, generateIssuePreview } from "../src/issues.js";
import type { FirstTask, RepoInfo } from "../src/types.js";

describe("Auto-Issue Creator", () => {
  const mockRepoInfo: RepoInfo = {
    owner: "testowner",
    repo: "testrepo",
    url: "https://github.com/testowner/testrepo",
    branch: "main",
    fullName: "testowner/testrepo",
  };

  const mockTasks: FirstTask[] = [
    {
      title: "Add unit tests for utils module",
      description: "The utils module lacks test coverage. Add tests for core functions.",
      difficulty: "beginner",
      category: "test",
      files: ["src/utils.ts", "test/utils.test.ts"],
      why: "Good way to learn the codebase while improving quality.",
    },
    {
      title: "Fix typo in error message",
      description: "There's a typo in the login error message.",
      difficulty: "beginner",
      category: "bug-fix",
      files: ["src/auth/login.ts"],
      why: "Simple fix that improves user experience.",
    },
    {
      title: "Refactor database connection pooling",
      description: "Current connection pooling is inefficient. Implement connection reuse.",
      difficulty: "advanced",
      category: "refactor",
      files: ["src/db/pool.ts", "src/db/connection.ts"],
      why: "Improves performance and teaches you the data layer.",
    },
  ];

  describe("taskToIssuePayload", () => {
    it("should create valid issue payload", () => {
      const payload = taskToIssuePayload(mockTasks[0], mockRepoInfo);

      expect(payload.title).toBe("Add unit tests for utils module");
      expect(payload.body).toContain("## Description");
      expect(payload.body).toContain("lacks test coverage");
      expect(payload.labels).toBeInstanceOf(Array);
    });

    it("should include difficulty label for beginner", () => {
      const payload = taskToIssuePayload(mockTasks[0], mockRepoInfo);

      expect(payload.labels).toContain("good first issue");
    });

    it("should include difficulty label for intermediate", () => {
      const intermediateTask: FirstTask = {
        ...mockTasks[0],
        difficulty: "intermediate",
      };
      const payload = taskToIssuePayload(intermediateTask, mockRepoInfo);

      expect(payload.labels).toContain("help wanted");
    });

    it("should include difficulty label for advanced", () => {
      const payload = taskToIssuePayload(mockTasks[2], mockRepoInfo);

      expect(payload.labels).toContain("enhancement");
    });

    it("should include category label for test", () => {
      const payload = taskToIssuePayload(mockTasks[0], mockRepoInfo);

      expect(payload.labels).toContain("testing");
    });

    it("should include category label for bug-fix", () => {
      const payload = taskToIssuePayload(mockTasks[1], mockRepoInfo);

      expect(payload.labels).toContain("bug");
    });

    it("should include category label for refactor", () => {
      const payload = taskToIssuePayload(mockTasks[2], mockRepoInfo);

      expect(payload.labels).toContain("refactor");
    });

    it("should include files to look at", () => {
      const payload = taskToIssuePayload(mockTasks[0], mockRepoInfo);

      expect(payload.body).toContain("## Files to Look At");
      expect(payload.body).toContain("`src/utils.ts`");
    });

    it("should include why section", () => {
      const payload = taskToIssuePayload(mockTasks[0], mockRepoInfo);

      expect(payload.body).toContain("## Why This Task?");
      expect(payload.body).toContain("learn the codebase");
    });

    it("should include difficulty section", () => {
      const payload = taskToIssuePayload(mockTasks[0], mockRepoInfo);

      expect(payload.body).toContain("## Difficulty");
      expect(payload.body).toContain("**Beginner**");
    });
  });

  describe("generateIssuePreview", () => {
    it("should generate valid markdown preview", () => {
      const preview = generateIssuePreview(mockTasks, mockRepoInfo);

      expect(preview).toContain("# Issue Preview");
      expect(preview).toContain("testowner/testrepo");
    });

    it("should include all tasks", () => {
      const preview = generateIssuePreview(mockTasks, mockRepoInfo);

      expect(preview).toContain("Add unit tests for utils module");
      expect(preview).toContain("Fix typo in error message");
      expect(preview).toContain("Refactor database connection pooling");
    });

    it("should number tasks", () => {
      const preview = generateIssuePreview(mockTasks, mockRepoInfo);

      expect(preview).toContain("## 1. Add unit tests");
      expect(preview).toContain("## 2. Fix typo");
      expect(preview).toContain("## 3. Refactor database");
    });

    it("should show labels for each task", () => {
      const preview = generateIssuePreview(mockTasks, mockRepoInfo);

      expect(preview).toContain("**Labels:**");
      expect(preview).toContain("good first issue");
      expect(preview).toContain("testing");
    });

    it("should include issue body in details", () => {
      const preview = generateIssuePreview(mockTasks, mockRepoInfo);

      expect(preview).toContain("<details>");
      expect(preview).toContain("<summary>Issue Body</summary>");
      expect(preview).toContain("</details>");
    });

    it("should include command instructions", () => {
      const preview = generateIssuePreview(mockTasks, mockRepoInfo);

      expect(preview).toContain("## Commands");
      expect(preview).toContain("bootcamp <repo-url> --create-issues");
      expect(preview).toContain("--dry-run");
    });

    it("should handle empty tasks array", () => {
      const preview = generateIssuePreview([], mockRepoInfo);

      expect(preview).toContain("# Issue Preview");
      expect(preview).toContain("0 issues");
    });
  });
});
