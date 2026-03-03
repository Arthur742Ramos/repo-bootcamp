import { describe, it, expect } from "vitest";
import { parseMermaidFile } from "../src/diagrams.js";

describe("parseMermaidFile - additional coverage", () => {
  it("should parse fenced mermaid blocks with titles", () => {
    const content = `%%% Architecture
\`\`\`mermaid
graph TD
    A --> B
\`\`\`

%%% Sequence
\`\`\`mermaid
sequenceDiagram
    Alice->>Bob: Hello
\`\`\``;
    const diagrams = parseMermaidFile(content);
    expect(diagrams).toHaveLength(2);
    expect(diagrams[0].title).toBe("architecture");
    expect(diagrams[1].title).toBe("sequence");
  });

  it("should parse heading-based titles", () => {
    const content = `# My Diagram
\`\`\`mermaid
graph TD
    A --> B
\`\`\``;
    const diagrams = parseMermaidFile(content);
    expect(diagrams).toHaveLength(1);
    expect(diagrams[0].title).toBe("my-diagram");
  });

  it("should handle raw mermaid without fences", () => {
    const content = `%%% Flow
graph TD
    A --> B
    B --> C`;
    const diagrams = parseMermaidFile(content);
    expect(diagrams).toHaveLength(1);
    expect(diagrams[0].code).toContain("graph TD");
  });

  it("should handle multiple raw diagrams", () => {
    const content = `%%% First
flowchart LR
    A --> B

%%% Second
sequenceDiagram
    Alice->>Bob: Hi`;
    const diagrams = parseMermaidFile(content);
    expect(diagrams).toHaveLength(2);
  });

  it("should handle empty fenced blocks", () => {
    const content = `\`\`\`mermaid
\`\`\``;
    const diagrams = parseMermaidFile(content);
    expect(diagrams).toHaveLength(0);
  });

  it("should handle content with no diagrams", () => {
    const content = "Just some text\nNo diagrams here\n";
    const diagrams = parseMermaidFile(content);
    expect(diagrams).toHaveLength(0);
  });

  it("should normalize special characters in titles", () => {
    const content = `%%% My Cool Diagram!!!
\`\`\`mermaid
graph TD
    A --> B
\`\`\``;
    const diagrams = parseMermaidFile(content);
    expect(diagrams[0].title).toBe("my-cool-diagram");
  });

  it("should handle all diagram types as starters", () => {
    const types = ["classDiagram", "stateDiagram", "erDiagram", "gantt", "pie", "journey", "gitGraph", "mindmap", "timeline", "quadrantChart", "sankey", "xychart"];
    for (const type of types) {
      const content = `${type}\n    A --> B`;
      const diagrams = parseMermaidFile(content);
      expect(diagrams.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("should prefer fenced blocks over raw diagrams", () => {
    const content = `\`\`\`mermaid
graph TD
    A --> B
\`\`\`
graph LR
    C --> D`;
    const diagrams = parseMermaidFile(content);
    // Should return fenced blocks since they were found
    expect(diagrams).toHaveLength(1);
    expect(diagrams[0].code).toContain("graph TD");
  });
});
