import { describe, it, expect } from "vitest";
import { getKeyFilesForImpact } from "../src/impact.js";
import type { FileInfo } from "../src/types.js";
import { makeFile } from "./helpers/fixtures.js";

describe("Terraform support", () => {
  describe("key file detection", () => {
    it("should identify root-level Terraform key files", () => {
      const files: FileInfo[] = [
        makeFile("main.tf", { size: 1000 }),
        makeFile("variables.tf", { size: 500 }),
        makeFile("outputs.tf", { size: 300 }),
        makeFile("providers.tf", { size: 200 }),
        makeFile("versions.tf", { size: 100 }),
        makeFile("backend.tf", { size: 150 }),
        makeFile("modules/vpc/main.tf", { size: 800 }),
        makeFile("terragrunt.hcl", { size: 250 }),
        makeFile(".terraform.lock.hcl", { size: 5000 }),
      ];
      const keyFiles = getKeyFilesForImpact(files);
      expect(keyFiles).toContain("main.tf");
      expect(keyFiles).toContain("variables.tf");
      expect(keyFiles).toContain("outputs.tf");
      expect(keyFiles).toContain("providers.tf");
      expect(keyFiles).toContain("versions.tf");
      expect(keyFiles).toContain("backend.tf");
      expect(keyFiles).toContain("terragrunt.hcl");
      expect(keyFiles).toContain(".terraform.lock.hcl");
    });

    it("should not include nested Terraform files as key files", () => {
      const files: FileInfo[] = [
        makeFile("modules/vpc/main.tf", { size: 800 }),
        makeFile("environments/dev/main.tf", { size: 600 }),
      ];
      const keyFiles = getKeyFilesForImpact(files);
      // Non-root main.tf should not be included (patterns are for root only)
      expect(keyFiles).not.toContain("modules/vpc/main.tf");
      expect(keyFiles).not.toContain("environments/dev/main.tf");
    });
  });
});

describe("Bicep support", () => {
  describe("key file detection", () => {
    it("should identify root-level Bicep key files", () => {
      const files: FileInfo[] = [
        makeFile("main.bicep", { size: 2000 }),
        makeFile("modules.bicep", { size: 500 }),
        makeFile("modules/network.bicep", { size: 800 }),
        makeFile("modules/storage.bicep", { size: 600 }),
      ];
      const keyFiles = getKeyFilesForImpact(files);
      expect(keyFiles).toContain("main.bicep");
      expect(keyFiles).toContain("modules.bicep");
      // Non-root modules should not be key files
      expect(keyFiles).not.toContain("modules/network.bicep");
    });
  });
});

describe("Mixed IaC + application code", () => {
  it("should detect both IaC and application key files at root", () => {
    const files: FileInfo[] = [
      makeFile("src/index.ts", { size: 500 }),
      makeFile("src/handler.ts", { size: 300 }),
      makeFile("main.tf", { size: 1000 }),
      makeFile("variables.tf", { size: 400 }),
      makeFile("main.bicep", { size: 800 }),
    ];

    const keyFiles = getKeyFilesForImpact(files);

    // Should include Terraform key files
    expect(keyFiles).toContain("main.tf");
    expect(keyFiles).toContain("variables.tf");

    // Should include Bicep key files
    expect(keyFiles).toContain("main.bicep");

    // Should include TypeScript entry points
    expect(keyFiles.some((f) => f.endsWith("index.ts"))).toBe(true);
  });

  it("should include src-level TypeScript files as key files", () => {
    const files: FileInfo[] = [
      makeFile("src/app.ts", { size: 500 }),
      makeFile("src/deep/nested.ts", { size: 200 }),
    ];

    const keyFiles = getKeyFilesForImpact(files);
    // Top-level src files should match
    expect(keyFiles).toContain("src/app.ts");
    // Nested files should not
    expect(keyFiles).not.toContain("src/deep/nested.ts");
  });
});

describe("IaC language patterns", () => {
  it("should not match .tfstate files as key files (by design)", () => {
    const files: FileInfo[] = [
      makeFile("terraform.tfstate", { size: 50000 }),
      makeFile("terraform.tfstate.backup", { size: 45000 }),
    ];
    const keyFiles = getKeyFilesForImpact(files);
    // .tfstate files are intentionally not key files (they contain secrets)
    expect(keyFiles.length).toBe(0);
  });
});
