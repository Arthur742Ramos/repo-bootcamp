import { describe, it, expect } from "vitest";

import {
  findCycles,
  describeCycle,
  detectCyclesInImportGraph,
  type GraphNode,
} from "../src/cycles.js";

function graphOf(entries: Record<string, string[]>): Map<string, GraphNode> {
  return new Map(Object.entries(entries).map(([file, imports]) => [file, { imports }]));
}

describe("findCycles", () => {
  it("returns no cycles for a DAG", () => {
    const g = graphOf({ "a": ["b", "c"], "b": ["c"], "c": [] });
    expect(findCycles(g)).toEqual([]);
  });

  it("detects a simple two-node cycle", () => {
    const g = graphOf({ "a": ["b"], "b": ["a"] });
    expect(findCycles(g)).toEqual([{ size: 2, files: ["a", "b"] }]);
  });

  it("detects a three-node ring", () => {
    const g = graphOf({ "a": ["b"], "b": ["c"], "c": ["a"] });
    expect(findCycles(g)).toEqual([{ size: 3, files: ["a", "b", "c"] }]);
  });

  it("treats a self-import as a size-1 cycle", () => {
    const g = graphOf({ "x": ["x"] });
    expect(findCycles(g)).toEqual([{ size: 1, files: ["x"] }]);
  });

  it("does not treat a leaf with no self-edge as a cycle", () => {
    const g = graphOf({ "a": ["b"], "b": [] });
    expect(findCycles(g)).toEqual([]);
  });

  it("ignores edges to modules that are not in the graph", () => {
    const g = graphOf({ "a": ["b", "external-pkg"], "b": ["a"] });
    expect(findCycles(g)).toEqual([{ size: 2, files: ["a", "b"] }]);
  });

  it("sorts cycles by size descending, then by first member", () => {
    const g = graphOf({
      "a": ["b"],
      "b": ["c"],
      "c": ["a"],
      "x": ["y"],
      "y": ["x"],
    });
    expect(findCycles(g)).toEqual([
      { size: 3, files: ["a", "b", "c"] },
      { size: 2, files: ["x", "y"] },
    ]);
  });

  it("orders equal-size cycles by first member name", () => {
    const g = graphOf({ "m": ["n"], "n": ["m"], "a": ["b"], "b": ["a"] });
    const cycles = findCycles(g);
    expect(cycles.map((c) => c.files[0])).toEqual(["a", "m"]);
  });

  it("handles a large ring without stack overflow", () => {
    const size = 5000;
    const entries: Record<string, string[]> = {};
    for (let i = 0; i < size; i++) entries[`f${i}`] = [`f${(i + 1) % size}`];
    const cycles = findCycles(graphOf(entries));
    expect(cycles).toHaveLength(1);
    expect(cycles[0].size).toBe(size);
  });

  it("returns no cycles for an empty graph", () => {
    expect(findCycles(new Map())).toEqual([]);
  });
});

describe("describeCycle", () => {
  it("renders a closed ring following the edges", () => {
    const g = graphOf({ "a": ["b"], "b": ["c"], "c": ["a"] });
    const [cycle] = findCycles(g);
    expect(describeCycle(cycle, g)).toBe("a → b → c → a");
  });

  it("renders a self-import as x → x", () => {
    const g = graphOf({ "x": ["x"] });
    const [cycle] = findCycles(g);
    expect(describeCycle(cycle, g)).toBe("x → x");
  });

  it("closes the ring on a multi-edge SCC", () => {
    const g = graphOf({ "a": ["b", "c"], "b": ["c"], "c": ["a"] });
    const [cycle] = findCycles(g);
    // Greedy walk a → b → c → a visits all three members.
    expect(describeCycle(cycle, g)).toBe("a → b → c → a");
  });

  it("does not imply a closing edge that does not exist", () => {
    // SCC {a,b,c}: a→b, b→{a,c}, c→b. The greedy walk a→b→c can't close back to
    // a (c only imports b), so the ring must NOT be rendered as `a → b → c → a`.
    const g = graphOf({ "a": ["b"], "b": ["a", "c"], "c": ["b"] });
    const [cycle] = findCycles(g);
    const desc = describeCycle(cycle, g);
    expect(desc).not.toContain("→");
    expect(desc).toBe("a, b, c");
  });
});

describe("detectCyclesInImportGraph", () => {
  // Mirrors buildImportGraph's wide node shape ({ imports, importedBy }).
  function fullGraph(entries: Record<string, string[]>) {
    return new Map(
      Object.entries(entries).map(([file, imports]) => [file, { imports, importedBy: [] }])
    );
  }

  it("detects a cycle and excludes test files from modules and edges", () => {
    const summary = detectCyclesInImportGraph(
      fullGraph({
        "src/a.ts": ["src/b.ts"],
        "src/b.ts": ["src/a.ts"],
        // Test-only cycle — must not appear.
        "src/a.test.ts": ["src/b.test.ts"],
        "src/b.test.ts": ["src/a.test.ts"],
      })
    );
    expect(summary.cycles).toEqual([{ size: 2, files: ["src/a.ts", "src/b.ts"] }]);
    expect(summary.rings).toEqual(["src/a.ts → src/b.ts → src/a.ts"]);
    expect(summary.moduleCount).toBe(2); // test files excluded
  });

  it("excludes non-source files so they cannot form a false cycle", () => {
    const summary = detectCyclesInImportGraph(
      fullGraph({
        "src/a.ts": ["src/b.ts", "README.md"],
        "src/b.ts": ["src/a.ts"],
        "README.md": [],
        "data.json": [],
      })
    );
    expect(summary.moduleCount).toBe(2);
    expect(summary.cycles).toHaveLength(1);
  });

  it("returns an empty summary for an empty graph", () => {
    expect(detectCyclesInImportGraph(new Map())).toEqual({
      moduleCount: 0,
      cycles: [],
      rings: [],
    });
  });
});
