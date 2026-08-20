import { describe, it, expect } from "vitest";
import { generateDependencyDiagram, generateDependencyDocs } from "../src/deps.js";

function makeDeps(overrides: any = {}) {
  return {
    runtime: [
      { name: "express", version: "4.18.0" },
      { name: "lodash", version: "4.17.21" },
    ],
    dev: [{ name: "vitest", version: "1.0.0" }],
    peer: [],
    totalCount: 3,
    categories: [],
    ...overrides,
  };
}

describe("deps extra branches", () => {
  it("diagram with categories >5 deps shows more", () => {
    const result = generateDependencyDiagram(
      makeDeps({
        categories: [{ name: "Testing", deps: ["a", "b", "c", "d", "e", "f", "g"] }],
      }),
      "test"
    );
    expect(result).toContain("+2 more");
  });

  it("diagram no categories, no dev", () => {
    const result = generateDependencyDiagram(makeDeps({ dev: [] }), "test");
    expect(result).not.toContain("Dev");
  });

  it("diagram >10 runtime in fallback", () => {
    const runtime = Array.from({ length: 15 }, (_, i) => ({ name: `p${i}`, version: "1" }));
    const result = generateDependencyDiagram(makeDeps({ runtime }), "test");
    expect(result).toContain("+5 more");
  });

  it("diagram >8 dev in fallback", () => {
    const dev = Array.from({ length: 12 }, (_, i) => ({ name: `d${i}`, version: "1" }));
    const result = generateDependencyDiagram(makeDeps({ dev }), "test");
    expect(result).toContain("+4 more");
  });

  it("docs with peer deps", () => {
    const result = generateDependencyDocs(
      makeDeps({ peer: [{ name: "react", version: "18" }], totalCount: 4 }),
      "p"
    );
    expect(result).toContain("Peer | 1");
  });

  it("docs empty runtime", () => {
    const result = generateDependencyDocs(makeDeps({ runtime: [], totalCount: 1 }), "p");
    expect(result).toContain("No runtime dependencies found");
  });

  it("docs empty dev", () => {
    const result = generateDependencyDocs(makeDeps({ dev: [], totalCount: 2 }), "p");
    expect(result).toContain("No development dependencies found");
  });

  it("docs >50 runtime truncated", () => {
    const runtime = Array.from({ length: 55 }, (_, i) => ({ name: `p${i}`, version: "1" }));
    const result = generateDependencyDocs(makeDeps({ runtime, totalCount: 55 }), "p");
    expect(result).toContain("+5 more");
  });

  it("docs >30 dev truncated", () => {
    const dev = Array.from({ length: 35 }, (_, i) => ({ name: `d${i}`, version: "1" }));
    const result = generateDependencyDocs(makeDeps({ dev, totalCount: 35 }), "p");
    expect(result).toContain("+5 more");
  });

  it("docs with categories", () => {
    const result = generateDependencyDocs(
      makeDeps({
        categories: [{ name: "Web", deps: ["express", "koa"] }],
      }),
      "p"
    );
    expect(result).toContain("### Web");
  });
});
