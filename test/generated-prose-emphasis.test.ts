import { describe, expect, it } from "vitest";
import {
  generateArchitecture,
  generateBootcamp,
  generateCodemap,
  generateFirstTasks,
  generateOnboarding,
  generateRunbook,
} from "../src/generator.js";
import { applyOutputFormat, markdownToHtml, type OutputFormat } from "../src/formatter.js";
import { computeRepoHealth, generateHealthDocs } from "../src/health.js";
import { computeCodebaseMetrics, generateMetricsDocs } from "../src/metrics.js";
import { STYLE_PACK_NAMES, STYLE_PACKS } from "../src/plugins.js";
import type { BootcampOptions, RepoFacts, ScanResult } from "../src/types.js";
import { runbookFacts } from "./helpers/runbook-facts.js";

const options: BootcampOptions = {
  branch: "main",
  focus: "all",
  audience: "backend",
  output: "output",
  maxFiles: 200,
  noClone: true,
  verbose: false,
};

function sparseFacts(): RepoFacts {
  const facts = runbookFacts();
  facts.structure.keyDirs = [];
  facts.structure.entrypoints = [];
  facts.architecture.dataFlow = "";
  return facts;
}

describe("generated prose emphasis", () => {
  it.each<OutputFormat>(["markdown", "html", "pdf"])(
    "renders missing evidence and deterministic notes in %s without changing code placeholders",
    (format) => {
      const facts = sparseFacts();
      const scan: ScanResult = {
        files: [],
        stack: facts.stack,
        commands: [],
        ciWorkflows: [],
        readme: null,
        contributing: null,
        keySourceFiles: new Map(),
      };
      const docs = [
        { name: "BOOTCAMP.md", content: generateBootcamp(facts, options) },
        { name: "ONBOARDING.md", content: generateOnboarding(facts, options) },
        { name: "ARCHITECTURE.md", content: generateArchitecture(facts, options) },
        { name: "CODEMAP.md", content: generateCodemap(facts) },
        { name: "FIRST_TASKS.md", content: generateFirstTasks(facts, options) },
        { name: "RUNBOOK.md", content: generateRunbook(facts) },
        { name: "HEALTH.md", content: generateHealthDocs(computeRepoHealth(scan), facts.repoName) },
        {
          name: "METRICS.md",
          content: generateMetricsDocs(computeCodebaseMetrics(scan), facts.repoName),
        },
      ];
      const expected = [
        ["No beginner tasks suggested"],
        ["No test command detected", "No test directories detected", "No common errors documented"],
        [
          "No role-specific components detected",
          "No role-specific files detected",
          "Data flow not documented",
          "None documented",
          "None detected",
        ],
        ["None detected"],
        [
          "No tasks suggested yet",
          "No beginner tasks suggested",
          "No intermediate tasks suggested",
          "No advanced tasks suggested",
        ],
        ["No build command detected"],
        [
          "Health is computed deterministically from the file scan (no AI), so it's stable across runs.",
        ],
        [
          "Metrics are computed deterministically from the file scan (no AI), so they're stable across runs.",
        ],
      ];
      const output = applyOutputFormat(docs, format);
      for (const [index, doc] of output.entries()) {
        for (const text of expected[index]) {
          expect(doc.content).toContain(format === "markdown" ? `*${text}*` : `<em>${text}</em>`);
          expect(doc.content).not.toContain(`_${text}_`);
        }
      }
      for (const text of ["No role-specific files detected", "No tasks available yet"]) {
        expect(output[1].content).toContain(
          format === "markdown" ? `\`_${text}_\`` : `<code>_${text}_</code>`
        );
      }
      const codemapHtml = markdownToHtml(docs[3].content);
      expect(codemapHtml.match(/<td><em>None detected<\/em><\/td>/g)).toHaveLength(2);
    }
  );

  it.each(STYLE_PACK_NAMES)("emphasizes task summaries and truncation notes for %s", (style) => {
    const facts = sparseFacts();
    const styledOptions = { ...options, style };
    expect(markdownToHtml(generateBootcamp(facts, styledOptions))).toContain(
      "<li><em>No beginner tasks suggested</em></li>"
    );
    const limit = STYLE_PACKS[style].firstTasksCount;
    facts.firstTasks = Array.from({ length: limit + 1 }, (_, index) => ({
      title: `Task ${index}`,
      description: "A documented task",
      difficulty: "beginner" as const,
      category: "docs" as const,
      files: [],
      why: "A useful starting point",
    }));
    const html = markdownToHtml(generateFirstTasks(facts, styledOptions));
    expect(html).toContain(
      `<em>Showing top ${limit} tasks for the ${style} style pack (1 hidden).</em>`
    );
    expect(html).toContain("<em>No intermediate tasks suggested</em>");
    expect(html).toContain("<em>No advanced tasks suggested</em>");
    if (STYLE_PACKS[style].sectionDepth === "minimal") {
      expect(html.match(/<strong>Start in:<\/strong> <em>No file provided<\/em>/g)).toHaveLength(
        limit
      );
    } else {
      expect(html).not.toContain("No file provided");
      expect(html).toContain("<strong>Files to look at:</strong>");
    }
  });

  it.each(["deploySteps", "observability", "incidents"] as const)(
    "keeps operational evidence and emphasizes absent fields when %s is present",
    (field) => {
      const facts = sparseFacts();
      facts.runbook = { applicable: true, deploySteps: [], observability: [], incidents: [] };
      if (field === "incidents") {
        facts.runbook.incidents = [{ name: "Incident", check: "Inspect existing evidence" }];
      } else {
        facts.runbook[field] = ["Inspect existing evidence"];
      }
      const html = markdownToHtml(generateRunbook(facts));
      expect(html).toContain("Inspect existing evidence");
      expect(html).not.toContain("Build &amp; Release");
      expect(html.match(/<em>Not documented<\/em>/g) || []).toHaveLength(
        field === "incidents" ? 2 : 1
      );
      if (field === "incidents") {
        expect(html).not.toContain("No incidents documented");
      } else {
        expect(html).toContain("<em>No incidents documented</em>");
      }
    }
  );

  it("preserves repository commands, source filenames and protected underscores", () => {
    const facts = runbookFacts();
    const command = "echo _USER_NAME_\n  npm run 'build```_literal_```'";
    facts.quickstart.commands = [{ name: "build", command, source: "src/_private_route.ts" }];
    facts.structure.testDirs = ["test/_private_route_test/"];
    facts.structure.keyDirs[0].keyFiles = ["src/_private_route.ts"];
    const html = markdownToHtml(generateOnboarding(facts));
    expect(html).toContain("echo _USER_NAME_\n  npm run 'build```_literal_```'</code>");
    expect(html).toContain("<code>test/_private_route_test/</code>");
    expect(html).toContain("<code>src/_private_route.ts</code>");
    expect(html).not.toContain("<em>USER_NAME</em>");
    expect(markdownToHtml(generateRunbook(facts))).toContain(
      "echo _USER_NAME_\n  npm run 'build```_literal_```'</code>"
    );
  });
});
