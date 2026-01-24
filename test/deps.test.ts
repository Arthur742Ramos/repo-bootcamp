/**
 * Tests for dependency analysis
 */

import { describe, it, expect } from "vitest";
import { generateDependencyDiagram, generateDependencyDocs, type DependencyAnalysis } from "../src/deps.js";

describe("generateDependencyDiagram", () => {
  const mockDeps: DependencyAnalysis = {
    packageManager: "npm",
    totalCount: 15,
    runtime: [
      { name: "react", version: "^18.0.0", type: "runtime" },
      { name: "next", version: "^14.0.0", type: "runtime" },
      { name: "zod", version: "^3.0.0", type: "runtime" },
    ],
    dev: [
      { name: "typescript", version: "^5.0.0", type: "dev" },
      { name: "vitest", version: "^1.0.0", type: "dev" },
    ],
    peer: [],
    categories: [
      { name: "React Ecosystem", deps: ["react", "next"] },
      { name: "Utilities", deps: ["zod"] },
      { name: "TypeScript", deps: ["typescript"] },
      { name: "Testing", deps: ["vitest"] },
    ],
  };

  it("should generate valid Mermaid diagram", () => {
    const diagram = generateDependencyDiagram(mockDeps, "my-project");
    
    expect(diagram).toContain("graph TD");
    expect(diagram).toContain("my-project");
    expect(diagram).toContain("APP");
  });

  it("should include category subgraphs", () => {
    const diagram = generateDependencyDiagram(mockDeps, "test-app");
    
    expect(diagram).toContain("React Ecosystem");
    expect(diagram).toContain("Utilities");
  });

  it("should show dependencies in categories", () => {
    const diagram = generateDependencyDiagram(mockDeps, "test-app");
    
    expect(diagram).toContain("react");
    expect(diagram).toContain("zod");
  });
});

describe("generateDependencyDocs", () => {
  const mockDeps: DependencyAnalysis = {
    packageManager: "npm",
    totalCount: 10,
    runtime: [
      { name: "express", version: "^4.0.0", type: "runtime" },
      { name: "zod", version: "^3.0.0", type: "runtime" },
    ],
    dev: [
      { name: "typescript", version: "^5.0.0", type: "dev" },
    ],
    peer: [],
    categories: [
      { name: "API & HTTP", deps: ["express"] },
    ],
  };

  it("should generate markdown documentation", () => {
    const docs = generateDependencyDocs(mockDeps, "my-api");
    
    expect(docs).toContain("# Dependency Overview");
    expect(docs).toContain("my-api");
  });

  it("should include summary table", () => {
    const docs = generateDependencyDocs(mockDeps, "my-api");
    
    expect(docs).toContain("## Summary");
    expect(docs).toContain("| Runtime | 2 |");
    expect(docs).toContain("| Development | 1 |");
  });

  it("should include Mermaid diagram", () => {
    const docs = generateDependencyDocs(mockDeps, "my-api");
    
    expect(docs).toContain("```mermaid");
    expect(docs).toContain("graph TD");
    expect(docs).toContain("```");
  });

  it("should list runtime dependencies", () => {
    const docs = generateDependencyDocs(mockDeps, "my-api");
    
    expect(docs).toContain("## Runtime Dependencies");
    expect(docs).toContain("express");
    expect(docs).toContain("^4.0.0");
  });

  it("should list dev dependencies", () => {
    const docs = generateDependencyDocs(mockDeps, "my-api");
    
    expect(docs).toContain("## Development Dependencies");
    expect(docs).toContain("typescript");
  });

  it("should categorize dependencies", () => {
    const docs = generateDependencyDocs(mockDeps, "my-api");
    
    expect(docs).toContain("## By Category");
    expect(docs).toContain("### API & HTTP");
  });
});

describe("DependencyAnalysis types", () => {
  it("should handle empty dependencies", () => {
    const emptyDeps: DependencyAnalysis = {
      packageManager: "npm",
      totalCount: 0,
      runtime: [],
      dev: [],
      peer: [],
      categories: [],
    };

    const docs = generateDependencyDocs(emptyDeps, "empty-project");
    
    expect(docs).toContain("No runtime dependencies found");
    expect(docs).toContain("No development dependencies found");
  });
});
