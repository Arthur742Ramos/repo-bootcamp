/**
 * Type smoke tests for exported interfaces
 */

import { describe, it, expect } from "vitest";
import type {
  BootcampOptions,
  RepoInfo,
  StackInfo,
  Entrypoint,
  Command,
  FileInfo,
} from "../src/types.js";

describe("types", () => {
  it("BootcampOptions supports required fields", () => {
    const options: BootcampOptions = {
      branch: "main",
      focus: "all",
      audience: "oss-contributor",
      output: "./out",
      maxFiles: 100,
      noClone: false,
      verbose: false,
    };

    expect(options.focus).toBe("all");
    expect(options.audience).toBe("oss-contributor");
  });

  it("core repo types are usable at runtime", () => {
    const repoInfo: RepoInfo = {
      owner: "owner",
      repo: "repo",
      url: "https://github.com/owner/repo",
      branch: "main",
      fullName: "owner/repo",
    };

    const stack: StackInfo = {
      languages: ["TypeScript"],
      frameworks: ["Express"],
      buildSystem: "npm",
      packageManager: "npm",
      hasDocker: false,
      hasCi: true,
    };

    const entrypoint: Entrypoint = {
      path: "src/index.ts",
      type: "cli",
      description: "Main CLI entrypoint",
    };

    const command: Command = {
      name: "build",
      command: "npm run build",
      source: "package.json",
      description: "Build the project",
    };

    const fileInfo: FileInfo = {
      path: "src/index.ts",
      size: 42,
      isDirectory: false,
    };

    expect(repoInfo.fullName).toBe("owner/repo");
    expect(stack.frameworks).toContain("Express");
    expect(entrypoint.type).toBe("cli");
    expect(command.name).toBe("build");
    expect(fileInfo.isDirectory).toBe(false);
  });
});
