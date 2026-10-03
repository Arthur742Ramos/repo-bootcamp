import { describe, expect, it } from "vitest";
import {
  generateDependencyDiagram,
  generateDependencyDocs,
  type DependencyAnalysis,
} from "../src/deps.js";

const analysis = (overrides: Partial<DependencyAnalysis> = {}): DependencyAnalysis => ({
  packageManager: "npm",
  totalCount: 0,
  runtime: [],
  dev: [],
  peer: [],
  categories: [],
  ...overrides,
});
const visibleEdges = (diagram: string) =>
  diagram
    .split("\n")
    .filter((line) => /-->|-\.->/.test(line))
    .map((line) => line.trim());

describe("single-ecosystem dependency diagram layout", () => {
  it("retains capped category names, IDs, order and counters inside one app dependency collection", () => {
    const categories = Array.from({ length: 9 }, (_, category) => ({
      name: `Category ${category}`,
      deps: Array.from({ length: 7 }, (_, dep) => `@scope${category}/package-${dep}`),
    }));
    const deps = analysis({ categories, totalCount: 63 });
    const graph = generateDependencyDiagram(deps, "Project");
    expect(graph).toContain('subgraph DependencyCategories["Dependency Categories"]');
    expect(visibleEdges(graph)).toEqual(["APP --> DependencyCategories"]);
    for (let category = 0; category < 8; category++) {
      expect(graph).toContain(`subgraph Category${category}["Category ${category}"]`);
      for (let dep = 0; dep < 5; dep++) {
        expect(graph).toContain(
          `_scope${category}_package_${dep}["@scope${category}/package-${dep}"]`
        );
      }
      expect(graph).toContain(`Category${category}_more["+2 more"]`);
      expect(graph).not.toContain(`package-5`);
      if (category) expect(graph).toContain(`Category${category - 1} ~~~ Category${category}`);
    }
    expect(graph).not.toContain('Category8["Category 8"]');
    expect(graph).toContain("_scope0_package_4 ~~~ Category0_more");
    const docs = generateDependencyDocs(deps, "Project");
    expect(docs).toContain("### Category 8");
    expect(docs).toContain("- `@scope8/package-6`");
  });

  it("keeps an existing category or library ID distinct from the new collection", () => {
    const graph = generateDependencyDiagram(
      analysis({
        categories: [{ name: "Dependency Categories", deps: ["DependencyCategories_"] }],
      }),
      "Project"
    );
    expect(graph).toContain('subgraph DependencyCategories__["Dependency Categories"]');
    expect(graph).toContain('subgraph DependencyCategories["Dependency Categories"]');
    expect(graph).toContain('DependencyCategories_["DependencyCategories_"]');
    expect(visibleEdges(graph)).toEqual(["APP --> DependencyCategories__"]);
  });

  it.each(["project", "library"])(
    "avoids a new collection collision with the existing %s ID",
    (kind) => {
      const project = kind === "project" ? "DependencyCategories" : "Project";
      const library = kind === "library" ? "DependencyCategories" : "one-library";
      const graph = generateDependencyDiagram(
        analysis({ categories: [{ name: "Testing", deps: [library] }] }),
        project
      );
      expect(graph).toContain('subgraph DependencyCategories_["Dependency Categories"]');
      expect(graph).toContain(`APP[("${project}")]`);
      expect(graph).toContain(`${library.replace(/[^a-zA-Z0-9]/g, "_")}["${library}"]`);
      expect(visibleEdges(graph)).toEqual(["APP --> DependencyCategories_"]);
    }
  );

  it("retains fallback runtime/dev relationship kinds and capped literal records", () => {
    const runtime = Array.from({ length: 13 }, (_, index) => ({
      name: `runtime-${index}`,
      version: "1",
    }));
    const dev = Array.from({ length: 11 }, (_, index) => ({ name: `dev-${index}`, version: "1" }));
    const graph = generateDependencyDiagram(analysis({ runtime, dev, totalCount: 24 }), "Project");
    expect(visibleEdges(graph)).toEqual(["APP --> Runtime", "APP -.-> Dev"]);
    for (let index = 0; index < 10; index++)
      expect(graph).toContain(`runtime_${index}["runtime-${index}"]`);
    for (let index = 0; index < 8; index++) expect(graph).toContain(`dev_${index}["dev-${index}"]`);
    expect(graph).not.toContain('runtime_10["');
    expect(graph).not.toContain('dev_8["');
    expect(graph).toContain('runtime_more["+3 more"]');
    expect(graph).toContain('dev_more["+3 more"]');
    expect(graph).toContain("runtime_9 ~~~ runtime_more");
    expect(graph).toContain("dev_7 ~~~ dev_more");
    expect(graph).toContain("Runtime ~~~ Dev");
  });

  it("keeps long library labels whole and uses no visible library dependency edges", () => {
    const name = "@typescript-eslint/eslint-plugin-with-a-long-literal-package-name";
    const other = "github.com/organization-with-a-long-name/dependency-with-a-long-module-path";
    const graph = generateDependencyDiagram(
      analysis({
        runtime: [
          { name, version: "1" },
          { name: other, version: "2" },
        ],
        totalCount: 2,
      }),
      "Project"
    );
    expect(graph).toContain(`["${name}"]`);
    expect(graph).toContain(`["${other}"]`);
    expect(visibleEdges(graph)).toEqual(["APP --> Runtime"]);
    expect(graph).toContain(
      `${name.replace(/[^a-zA-Z0-9]/g, "_")} ~~~ ${other.replace(/[^a-zA-Z0-9]/g, "_")}`
    );
  });

  it.each(["npm", "Cargo", "pip", "go"])(
    "retains an empty and a one-library %s fallback",
    (packageManager) => {
      const empty = generateDependencyDiagram(analysis({ packageManager }), "Empty");
      expect(empty).toContain('APP[("Empty")]');
      expect(empty).toContain('subgraph Runtime["Runtime Dependencies"]');
      expect(empty).not.toContain("~~~");
      expect(visibleEdges(empty)).toEqual(["APP --> Runtime"]);
      const tiny = generateDependencyDiagram(
        analysis({
          packageManager,
          runtime: [{ name: "one-library", version: "1" }],
          totalCount: 1,
        }),
        "Tiny"
      );
      expect(tiny).toContain('one_library["one-library"]');
      expect(tiny).not.toContain("~~~");
      expect(visibleEdges(tiny)).toEqual(["APP --> Runtime"]);
    }
  );
});
