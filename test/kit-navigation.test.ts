import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BootcampOptions, RepoFacts, RepoInfo, ScanResult } from "../src/types.js";
import type { BootcampConfig, FormatterPlugin } from "../src/plugins.js";
const { analysisMock, pluginsMock } = vi.hoisted(() => ({
  analysisMock: vi.fn(),
  pluginsMock: vi.fn(),
}));
vi.mock("../src/analysis.js", () => ({ runParallelAnalysis: analysisMock }));
vi.mock("../src/plugins.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/plugins.js")>()),
  loadPlugins: vi.fn().mockResolvedValue([]),
  runPlugins: pluginsMock,
}));
vi.mock("../src/generator.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/generator.js")>()),
  generateOnboarding: vi.fn(() => "onboarding"),
  generateArchitecture: vi.fn(() => "architecture"),
  generateCodemap: vi.fn(() => "codemap"),
  generateFirstTasks: vi.fn(() => "tasks"),
  generateDiagrams: vi.fn(() => "diagrams"),
  generateRunbook: vi.fn(() => "runbook"),
}));
vi.mock("../src/deps.js", () => ({
  generateDependencyDocs: vi.fn(() => "nonempty dependency report"),
}));
vi.mock("../src/impact.js", () => ({ generateImpactDocs: vi.fn(() => "nonempty impact report") }));
vi.mock("../src/security.js", () => ({ generateSecurityDocs: vi.fn(() => "security report") }));
vi.mock("../src/radar.js", () => ({ generateRadarDocs: vi.fn(() => "radar report") }));
import { prepareOutputDocuments } from "../src/services/analysis-orchestration.js";
import { generateBootcamp } from "../src/generator.js";
import { getStyleConfig } from "../src/plugins.js";
import { applyOutputFormat } from "../src/formatter.js";

const facts = {
  repoName: "kit/fixture",
  purpose: "Owned fixture",
  description: "Explicit repository text",
  confidence: "high",
  sources: [],
  stack: { languages: [], frameworks: [], buildSystem: "Task", hasDocker: false, hasCi: false },
  quickstart: {
    prerequisites: [],
    steps: [],
    commands: [{ name: "test", command: "task test", source: "Taskfile" }],
    commonErrors: [],
    sources: [],
  },
  structure: { keyDirs: [], entrypoints: [], testDirs: [], docsDirs: [], sources: [] },
  firstTasks: [],
} as unknown as RepoFacts;
const options: BootcampOptions = {
  branch: "main",
  focus: "all",
  audience: "all",
  output: "out",
  maxFiles: 100,
  noClone: true,
  verbose: false,
  style: "corporate",
};
const scan: ScanResult = {
  files: [],
  stack: { languages: [], frameworks: [], buildTools: [], testFrameworks: [], linters: [] },
  commands: [],
  ciWorkflows: [],
  readme: null,
  contributing: null,
  keySourceFiles: new Map(),
};
const info = {
  repo: "fixture",
  owner: "kit",
  fullName: "kit/fixture",
  url: "https://github.com/kit/fixture",
  branch: "main",
} as RepoInfo;
const fullStyle = getStyleConfig("corporate");
const analysis = { deps: null, security: {}, radar: {}, impacts: [] };
const ownedLinks = (content: string) => content.slice(content.lastIndexOf("## Next Steps"));
const assemble = (
  config: BootcampConfig | null = null,
  input = facts,
  styleConfig = fullStyle,
  format?: BootcampOptions["format"]
) =>
  prepareOutputDocuments({
    repoPath: "/owned-fixture",
    repoInfo: info,
    scanResult: scan,
    facts: input,
    options: { ...options, format },
    config,
    styleConfig,
    progress: { update: vi.fn() } as any,
  });
const overview = (documents: { name: string; content: string }[]) =>
  documents.find((doc) => doc.name === "BOOTCAMP.md")!.content;
beforeEach(() => {
  vi.clearAllMocks();
  analysisMock.mockResolvedValue(analysis);
  pluginsMock.mockResolvedValue({
    factsPatch: {},
    docs: [],
    extraData: {},
    formatters: [],
    outputTargets: [],
  });
});

describe("navigation for actually emitted kit documents", () => {
  it("omits absent dependency/impact links while retaining core and emitted optional documents in their existing order", async () => {
    const result = await assemble();
    const content = overview(result.documents);
    const links = [...ownedLinks(content).matchAll(/\]\(\.\/([^)]*)\)/g)].map((match) => match[1]);
    expect(links).toEqual([
      "ONBOARDING.md",
      "ARCHITECTURE.md",
      "CODEMAP.md",
      "FIRST_TASKS.md",
      "RUNBOOK.md",
      "SECURITY.md",
      "RADAR.md",
    ]);
    for (const name of links) expect(result.documents.some((doc) => doc.name === name)).toBe(true);
    expect(result.documents.some((doc) => doc.name === "DEPENDENCIES.md")).toBe(false);
    expect(result.documents.some((doc) => doc.name === "IMPACT.md")).toBe(false);
    expect(content).not.toContain("bootcamp-navigation:");
  });
  it("retains nonempty dependency and impact reports and all enabled optional links", async () => {
    analysisMock.mockResolvedValue({
      ...analysis,
      deps: { runtime: [{ name: "fixture-dependency" }] },
      impacts: [{ file: "src/index.ts" }],
    });
    const result = await assemble();
    const links = ownedLinks(overview(result.documents));
    for (const name of ["RUNBOOK.md", "DEPENDENCIES.md", "SECURITY.md", "RADAR.md", "IMPACT.md"]) {
      expect(links).toContain(`](./${name})`);
      expect(result.documents.some((doc) => doc.name === name)).toBe(true);
    }
    expect(result.documents.find((doc) => doc.name === "DEPENDENCIES.md")!.content).toBe(
      "nonempty dependency report"
    );
    expect(result.documents.map((doc) => doc.name).slice(0, 5)).toEqual([
      "BOOTCAMP.md",
      "ONBOARDING.md",
      "ARCHITECTURE.md",
      "CODEMAP.md",
      "FIRST_TASKS.md",
    ]);
  });
  it("honors style and output exclusions for optional and core navigation without touching explicit facts", async () => {
    analysisMock.mockResolvedValue({
      ...analysis,
      deps: { runtime: [{ name: "fixture" }] },
      impacts: [{}],
    });
    const excluded = [
      "ONBOARDING.md",
      "DEPENDENCIES.md",
      "IMPACT.md",
      "SECURITY.md",
      "RADAR.md",
      "RUNBOOK.md",
    ];
    const input = {
      ...facts,
      description:
        "User instruction: [DEPENDENCIES.md](./DEPENDENCIES.md)\n\n## Next Steps\n\nRead [ONBOARDING.md](./ONBOARDING.md) yourself.",
    };
    const result = await assemble({ output: { excludeDocs: excluded } }, input);
    expect(overview(result.documents)).toContain(input.description);
    for (const name of excluded) {
      expect(ownedLinks(overview(result.documents))).not.toContain(`](./${name})`);
      expect(result.documents.some((doc) => doc.name === name)).toBe(false);
    }
    const minimal = await assemble(null, facts, getStyleConfig("minimal"));
    expect(
      [...ownedLinks(overview(minimal.documents)).matchAll(/\]\(\.\/([^)]*)\)/g)].map(
        (match) => match[1]
      )
    ).toEqual(["ONBOARDING.md", "ARCHITECTURE.md", "CODEMAP.md", "FIRST_TASKS.md"]);
  });
  it("refreshes untouched generated navigation after formatter drops/renames while preserving identical explicit blocks", async () => {
    analysisMock.mockResolvedValue({
      ...analysis,
      deps: { runtime: [{ name: "fixture" }] },
      impacts: [{}],
    });
    const explicit = ownedLinks(generateBootcamp(facts, options, fullStyle)).split("\n\n---")[0];
    const input = { ...facts, description: `Custom description\n\n${explicit}` };
    const formatter: FormatterPlugin = {
      type: "formatter",
      name: "owned-test",
      formatDocuments: async (docs) =>
        docs
          .filter((doc) => !["DEPENDENCIES.md", "SECURITY.md"].includes(doc.name))
          .map((doc) =>
            doc.name === "ONBOARDING.md"
              ? { ...doc, name: "CUSTOM_SETUP.md" }
              : doc.name === "BOOTCAMP.md"
                ? { ...doc, content: `${explicit}\n\n${doc.content}\n\nCustom footer\n${explicit}` }
                : doc
          ),
    };
    pluginsMock.mockResolvedValue({
      factsPatch: {},
      docs: [],
      extraData: {},
      formatters: [formatter],
      outputTargets: [],
    });
    const result = await assemble({ plugins: ["owned-test"] }, input);
    const content = overview(result.documents);
    expect(content).toContain(input.description);
    expect(content.startsWith(explicit)).toBe(true);
    expect(content.endsWith(`Custom footer\n${explicit}`)).toBe(true);
    expect(content.match(/\[DEPENDENCIES\.md\]\(\.\/DEPENDENCIES\.md\)/g)).toHaveLength(3);
    expect(content).not.toContain("bootcamp-navigation:");
    const generated = content.slice(
      content.indexOf("## Next Steps", content.indexOf("## If You Only Have 30 Minutes")),
      content.indexOf("\n---\n*Generated")
    );
    for (const name of ["DEPENDENCIES.md", "SECURITY.md", "ONBOARDING.md"])
      expect(generated).not.toContain(`](./${name})`);
    expect(generated).toContain("](./IMPACT.md)");
  });
  it("preserves formatter-overridden navigation and entirely custom BOOTCAMP content", async () => {
    const custom =
      "# Custom overview\n\n## Next Steps\n\n- [DEPENDENCIES.md](./DEPENDENCIES.md) - Explicit user text\n";
    pluginsMock.mockResolvedValue({
      factsPatch: {},
      docs: [],
      extraData: {},
      formatters: [
        {
          name: "custom",
          formatDocuments: async (docs: { name: string; content: string }[]) =>
            docs.map((doc) => (doc.name === "BOOTCAMP.md" ? { ...doc, content: custom } : doc)),
        },
      ],
      outputTargets: [],
    });
    expect(overview((await assemble({ plugins: ["custom"] })).documents)).toBe(custom);
    pluginsMock.mockResolvedValue({
      factsPatch: {},
      docs: [],
      extraData: {},
      formatters: [
        {
          name: "edit-navigation",
          formatDocuments: async (docs: { name: string; content: string }[]) =>
            docs.map((doc) =>
              doc.name === "BOOTCAMP.md"
                ? {
                    ...doc,
                    content: doc.content.replace(
                      "- 📖 [ONBOARDING.md](./ONBOARDING.md) - Full setup guide",
                      "User-selected setup instructions: [external](https://example.com/setup)"
                    ),
                  }
                : doc
            ),
        },
      ],
      outputTargets: [],
    });
    const edited = overview((await assemble({ plugins: ["edit-navigation"] })).documents);
    expect(edited).toContain(
      "User-selected setup instructions: [external](https://example.com/setup)"
    );
    expect(edited).not.toContain("bootcamp-navigation:");
  });
  it("lets a plugin-provided report participate without fabricating a missing analyzer report", async () => {
    pluginsMock.mockResolvedValue({
      factsPatch: {},
      docs: [{ name: "DEPENDENCIES.md", content: "User-authored dependency inventory" }],
      extraData: {},
      formatters: [],
      outputTargets: [],
    });
    const result = await assemble({ plugins: ["inventory"] }, facts, getStyleConfig("minimal"));
    expect(ownedLinks(overview(result.documents))).toContain("](./DEPENDENCIES.md)");
    expect(result.documents.find((doc) => doc.name === "DEPENDENCIES.md")!.content).toBe(
      "User-authored dependency inventory"
    );
  });
  it.each(["html", "pdf"] as const)(
    "refreshes renderer-converted %s navigation without leaking markers or changing explicit content",
    async (format) => {
      analysisMock.mockResolvedValue({ ...analysis, deps: { runtime: [{}] }, impacts: [{}] });
      const input = {
        ...facts,
        description:
          "## Next Steps\n\n- [DEPENDENCIES.md](./DEPENDENCIES.md) - Explicit instruction",
      };
      pluginsMock.mockResolvedValue({
        factsPatch: {},
        docs: [],
        extraData: {},
        outputTargets: [],
        formatters: [
          {
            name: "html-conversion",
            formatDocuments: async (docs: { name: string; content: string }[]) =>
              applyOutputFormat(docs, format).filter((doc) => doc.name !== "DEPENDENCIES.html"),
          },
        ],
      });
      const result = await assemble({ plugins: ["html-conversion"] }, input);
      const content = result.documents.find((doc) => doc.name === "BOOTCAMP.html")!.content;
      expect(content).not.toContain("bootcamp-navigation:");
      expect(content).toContain(
        '<a href="./DEPENDENCIES.html">DEPENDENCIES.md</a> - Explicit instruction'
      );
      expect(content.match(/href="\.\/DEPENDENCIES\.html"/g)).toHaveLength(1);
      for (const name of ["ONBOARDING", "ARCHITECTURE", "CODEMAP", "FIRST_TASKS", "IMPACT"])
        expect(content).toContain(`href="./${name}.html"`);
      expect(content).toContain("<!DOCTYPE html>");
      expect(content).toContain(format === "pdf" ? "@page { size: A4" : "<title>BOOTCAMP</title>");
    }
  );
  it.each(["DEPENDENCIES.md", "BOOTCAMP.md"])(
    "keeps mixed-format targets accurate when a formatter converts only %s",
    async (converted) => {
      analysisMock.mockResolvedValue({ ...analysis, deps: { runtime: [{}] } });
      pluginsMock.mockResolvedValue({
        factsPatch: {},
        docs: [],
        extraData: {},
        outputTargets: [],
        formatters: [
          {
            name: "mixed-conversion",
            formatDocuments: async (docs: { name: string; content: string }[]) =>
              docs
                .filter((doc) => doc.name !== "SECURITY.md")
                .map((doc) => (doc.name === converted ? applyOutputFormat([doc], "html")[0] : doc)),
          },
        ],
      });
      const result = await assemble({ plugins: ["mixed-conversion"] });
      const content = result.documents.find((doc) => doc.name.startsWith("BOOTCAMP."))!.content;
      expect(content).not.toContain("bootcamp-navigation:");
      expect(content).not.toContain("SECURITY.md");
      const dependency = converted === "DEPENDENCIES.md" ? "DEPENDENCIES.html" : "DEPENDENCIES.md";
      expect(content).toContain(
        converted === "BOOTCAMP.md" ? `href="./${dependency}"` : `](./${dependency})`
      );
      expect(content).toContain(
        converted === "BOOTCAMP.md" ? 'href="./ONBOARDING.md"' : "](./ONBOARDING.md)"
      );
    }
  );
  it.each(["html", "pdf"] as const)(
    "accounts for final %s conversion after a formatter converts only the overview",
    async (format) => {
      pluginsMock.mockResolvedValue({
        factsPatch: {},
        docs: [],
        extraData: {},
        outputTargets: [],
        formatters: [
          {
            name: "overview-conversion",
            formatDocuments: async (docs: { name: string; content: string }[]) =>
              docs.map((doc) =>
                doc.name === "BOOTCAMP.md" ? applyOutputFormat([doc], "html")[0] : doc
              ),
          },
        ],
      });
      const result = await assemble({ plugins: ["overview-conversion"] }, facts, fullStyle, format);
      const formatted = applyOutputFormat(result.documents, format);
      const content = formatted.find((doc) => doc.name === "BOOTCAMP.html")!.content;
      for (const name of [
        "ONBOARDING",
        "ARCHITECTURE",
        "CODEMAP",
        "FIRST_TASKS",
        "RUNBOOK",
        "SECURITY",
        "RADAR",
      ]) {
        expect(content).toContain(`href="./${name}.html"`);
        expect(formatted.some((doc) => doc.name === `${name}.html`)).toBe(true);
      }
    }
  );
  it.each(["markdown", "html", "pdf"] as const)(
    "keeps emitted links consumable in %s output and omits unavailable optional targets",
    async (format) => {
      const result = await assemble();
      const formatted = applyOutputFormat(result.documents, format);
      const content = formatted.find(
        (doc) => doc.name === (format === "markdown" ? "BOOTCAMP.md" : "BOOTCAMP.html")
      )!.content;
      expect(content).not.toContain("DEPENDENCIES.md");
      expect(content).not.toContain("IMPACT.md");
      for (const name of [
        "ONBOARDING",
        "ARCHITECTURE",
        "CODEMAP",
        "FIRST_TASKS",
        "RUNBOOK",
        "SECURITY",
        "RADAR",
      ]) {
        const target = `${name}.${format === "markdown" ? "md" : "html"}`;
        expect(content).toContain(format === "markdown" ? `](./${target})` : `href="./${target}"`);
        expect(formatted.some((doc) => doc.name === target)).toBe(true);
      }
    }
  );
  it("keeps standalone generateBootcamp style behavior when no document context is supplied", () => {
    expect(generateBootcamp(facts, options, fullStyle)).toContain("](./DEPENDENCIES.md)");
    expect(generateBootcamp(facts, options, getStyleConfig("minimal"))).not.toContain(
      "](./DEPENDENCIES.md)"
    );
    expect(
      generateBootcamp(facts, options, fullStyle, {
        availableDocuments: new Set(["ONBOARDING.md"]),
      })
    ).not.toContain("](./DEPENDENCIES.md)");
  });
});
