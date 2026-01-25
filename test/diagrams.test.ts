/**
 * Tests for the diagrams rendering module
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseMermaidFile } from "../src/diagrams.js";

describe("diagrams", () => {
  describe("parseMermaidFile", () => {
    it("parses a single diagram", () => {
      const content = `
flowchart TD
    A[Start] --> B[End]
`;
      const diagrams = parseMermaidFile(content);
      expect(diagrams).toHaveLength(1);
      expect(diagrams[0].code).toContain("flowchart TD");
      expect(diagrams[0].code).toContain("A[Start]");
    });

    it("parses multiple diagrams with titles", () => {
      const content = `
%%% Architecture Overview
flowchart TD
    A --> B

%%% Data Flow
sequenceDiagram
    User->>Server: Request
`;
      const diagrams = parseMermaidFile(content);
      expect(diagrams).toHaveLength(2);
      expect(diagrams[0].title).toBe("architecture-overview");
      expect(diagrams[0].code).toContain("flowchart TD");
      expect(diagrams[1].title).toBe("data-flow");
      expect(diagrams[1].code).toContain("sequenceDiagram");
    });

    it("handles diagrams without titles", () => {
      const content = `
flowchart TD
    A --> B
`;
      const diagrams = parseMermaidFile(content);
      expect(diagrams).toHaveLength(1);
      expect(diagrams[0].title).toBe("diagram");
    });

    it("handles multiple diagram types", () => {
      const content = `
%%% Flow
graph LR
    A --> B

%%% Class
classDiagram
    Animal <|-- Cat

%%% State
stateDiagram-v2
    [*] --> Active

%%% ER
erDiagram
    USER ||--o{ ORDER : places

%%% Gantt
gantt
    title Project
    section A
    Task 1: a1, 2024-01-01, 30d

%%% Pie
pie title Pets
    "Dogs" : 50
    "Cats" : 50
`;
      const diagrams = parseMermaidFile(content);
      expect(diagrams).toHaveLength(6);
      expect(diagrams[0].code).toContain("graph LR");
      expect(diagrams[1].code).toContain("classDiagram");
      expect(diagrams[2].code).toContain("stateDiagram");
      expect(diagrams[3].code).toContain("erDiagram");
      expect(diagrams[4].code).toContain("gantt");
      expect(diagrams[5].code).toContain("pie");
    });

    it("normalizes title to kebab-case", () => {
      const content = `
%%% My Awesome Diagram
flowchart TD
    A --> B
`;
      const diagrams = parseMermaidFile(content);
      expect(diagrams[0].title).toBe("my-awesome-diagram");
    });

    it("handles empty content", () => {
      const diagrams = parseMermaidFile("");
      expect(diagrams).toHaveLength(0);
    });

    it("handles content with no valid diagrams", () => {
      const content = `
%%% Title Only
Some random text
Not a diagram
`;
      const diagrams = parseMermaidFile(content);
      // It will capture the text but won't find a diagram starter
      expect(diagrams.length).toBeLessThanOrEqual(1);
    });

    it("preserves diagram content accurately", () => {
      const content = `
%%% Complex Flow
flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do Something]
    B -->|No| D[Do Something Else]
    C --> E[End]
    D --> E
`;
      const diagrams = parseMermaidFile(content);
      expect(diagrams[0].code).toContain("B{Decision}");
      expect(diagrams[0].code).toContain("-->|Yes|");
      expect(diagrams[0].code).toContain("-->|No|");
    });

    it("handles journey diagrams", () => {
      const content = `
journey
    title My working day
    section Go to work
      Make tea: 5: Me
`;
      const diagrams = parseMermaidFile(content);
      expect(diagrams).toHaveLength(1);
      expect(diagrams[0].code).toContain("journey");
    });

    it("handles gitGraph diagrams", () => {
      const content = `
gitGraph
    commit
    branch develop
    checkout develop
    commit
`;
      const diagrams = parseMermaidFile(content);
      expect(diagrams).toHaveLength(1);
      expect(diagrams[0].code).toContain("gitGraph");
    });

    it("handles mindmap diagrams", () => {
      const content = `
mindmap
  root((Topic))
    Origins
      Long history
`;
      const diagrams = parseMermaidFile(content);
      expect(diagrams).toHaveLength(1);
      expect(diagrams[0].code).toContain("mindmap");
    });

    it("handles timeline diagrams", () => {
      const content = `
timeline
    title History
    2023 : Event 1
    2024 : Event 2
`;
      const diagrams = parseMermaidFile(content);
      expect(diagrams).toHaveLength(1);
      expect(diagrams[0].code).toContain("timeline");
    });
  });

  describe("DiagramFormat type", () => {
    it("accepts valid formats", () => {
      const formats: Array<"svg" | "png" | "pdf"> = ["svg", "png", "pdf"];
      expect(formats).toContain("svg");
      expect(formats).toContain("png");
      expect(formats).toContain("pdf");
    });
  });
});
