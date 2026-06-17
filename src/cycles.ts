/**
 * Circular Dependency Detection
 *
 * Finds circular import groups in a module graph using Tarjan's
 * strongly-connected-components algorithm. Every SCC with more than one member
 * is a cycle; a single-member SCC is a cycle only when the module imports
 * itself. The traversal is iterative (explicit work stack) so it does not
 * overflow the call stack on large, densely-connected graphs.
 *
 * Pure and deterministic — given the same graph it always returns the same
 * cycles in the same order — so it is reused by `bootcamp cycles` and is
 * straightforward to unit-test.
 */

/** A detected circular-dependency group: 2+ mutually-reachable modules, or a self-import. */
export interface Cycle {
  /** Number of modules in the cycle. */
  size: number;
  /** Member module paths, sorted for stable output. */
  files: string[];
}

/** Minimal shape of the import graph (a subset of buildImportGraph's value). */
export interface GraphNode {
  imports: string[];
}

/**
 * Find all circular-dependency groups in a directed module graph.
 *
 * @param graph  module path → its outgoing internal imports.
 * @returns cycles sorted by size descending, then by first member path, so the
 *          output is deterministic for snapshot tests and stable CLI display.
 */
export function findCycles(graph: Map<string, GraphNode>): Cycle[] {
  const nodes = [...graph.keys()].sort((a, b) => a.localeCompare(b));
  const nodeSet = new Set(nodes);

  // Outgoing edges, restricted to in-graph targets and sorted for determinism.
  const edgesOf = (node: string): string[] =>
    [...new Set(graph.get(node)?.imports ?? [])]
      .filter((target) => nodeSet.has(target))
      .sort((a, b) => a.localeCompare(b));

  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const tarjanStack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;

    // Iterative DFS. Each frame tracks how far through a node's edges we are.
    const work: Array<{ node: string; edges: string[]; edge: number }> = [
      { node: root, edges: edgesOf(root), edge: 0 },
    ];

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const v = frame.node;

      if (frame.edge === 0 && !index.has(v)) {
        index.set(v, counter);
        lowlink.set(v, counter);
        counter++;
        tarjanStack.push(v);
        onStack.add(v);
      }

      let recursed = false;
      while (frame.edge < frame.edges.length) {
        const w = frame.edges[frame.edge];
        frame.edge++; // advance before any descent so we never reprocess this edge
        if (!index.has(w)) {
          work.push({ node: w, edges: edgesOf(w), edge: 0 });
          recursed = true;
          break;
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
        }
      }
      if (recursed) continue;

      // All edges processed: if v is an SCC root, pop its component.
      if (lowlink.get(v) === index.get(v)) {
        const component: string[] = [];
        let w: string;
        do {
          w = tarjanStack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== v);
        sccs.push(component);
      }

      work.pop();
      // Fold v's lowlink into its parent — replaces recursive Tarjan's return step.
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(v)!));
      }
    }
  }

  const cycles: Cycle[] = [];
  for (const component of sccs) {
    const isMultiNode = component.length > 1;
    // A single-node SCC is only a cycle if the module imports itself.
    const isSelfImport =
      component.length === 1 && (graph.get(component[0])?.imports ?? []).includes(component[0]);
    if (!isMultiNode && !isSelfImport) continue;
    const files = [...component].sort((a, b) => a.localeCompare(b));
    cycles.push({ size: files.length, files });
  }

  cycles.sort((a, b) => b.size - a.size || a.files[0].localeCompare(b.files[0]));
  return cycles;
}

/**
 * Build a human-readable description of a cycle by greedily following real
 * import edges between its members, e.g. `a.ts → b.ts → c.ts → a.ts`. Every
 * arrow shown corresponds to an actual import:
 *   - the ring is only closed (`… → start`) when the last walked member really
 *     imports the start module, so we never imply an edge that doesn't exist;
 *   - if the walk can't form a closed ring of real edges, the members are
 *     listed as a set (comma-separated) rather than with misleading arrows.
 * For a single self-importing module it returns `x.ts → x.ts`.
 */
export function describeCycle(cycle: Cycle, graph: Map<string, GraphNode>): string {
  if (cycle.size === 1) {
    // Size-1 cycles are self-imports, so the edge x → x is real.
    return `${cycle.files[0]} → ${cycle.files[0]}`;
  }

  const members = new Set(cycle.files);
  const start = cycle.files[0];
  const ring: string[] = [start];
  const visited = new Set<string>([start]);
  let current = start;

  while (ring.length < cycle.size) {
    const next = [...new Set(graph.get(current)?.imports ?? [])]
      .filter((target) => members.has(target) && !visited.has(target))
      .sort((a, b) => a.localeCompare(b))[0];
    if (!next) break; // walk stalled — fall back below
    ring.push(next);
    visited.add(next);
    current = next;
  }

  // Only close the ring if every member was visited via real edges AND the last
  // member actually imports the start — otherwise the closing arrow would imply
  // an edge that doesn't exist. When that doesn't hold, present the members as
  // a set rather than with misleading arrows.
  const closesRing = (graph.get(current)?.imports ?? []).includes(start);
  if (ring.length === cycle.size && closesRing) {
    return `${ring.join(" → ")} → ${start}`;
  }
  return cycle.files.join(", ");
}
