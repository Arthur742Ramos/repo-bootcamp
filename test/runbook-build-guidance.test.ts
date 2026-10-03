import { describe, expect, it } from "vitest";
import { generateBootcamp, generateOnboarding, generateRunbook } from "../src/generator.js";
import { markdownToHtml } from "../src/formatter.js";
import type { BootcampOptions } from "../src/types.js";
import { runbookFacts } from "./helpers/runbook-facts.js";

const options: BootcampOptions = {
  branch: "",
  focus: "all",
  audience: "all",
  output: "output",
  maxFiles: 200,
  noClone: true,
  verbose: false,
};

describe("library/tool runbook build guidance", () => {
  it.each([
    ["build", "npm run build"],
    ["build:prod", "npm run build:prod"],
    ["compile", "npm run compile"],
    ["bundle", "npm run bundle"],
    ["compile", "make compile"],
    ["verify", "cargo build"],
    ["build prod", "npm run 'build prod'"],
  ])("agrees with onboarding on %s / %s", (name, command) => {
    const facts = runbookFacts();
    facts.quickstart.commands = [{ name, command, source: "package.json" }];
    const runbook = generateRunbook(facts);
    expect(runbook).toContain(`\`\`\`bash\n${command}\n\`\`\``);
    expect(runbook).not.toContain("_No build command detected_");
    expect(generateBootcamp(facts, options)).toContain(`Build/verify: \`${command}\``);
    expect(generateOnboarding(facts)).toContain(`\`\`\`bash\n${command}\n\`\`\``);
  });

  it.each([
    ["install", "npm install"],
    ["build", "npm install --save-dev build-tools"],
    ["build", "npm run build --help"],
    ["build", "vite build --version"],
    ["dev", "npm run dev"],
    ["test", "npm test"],
    ["build", "npm test"],
    ["prepare", "echo build && npm install"],
    ["inspect", "poetry run build-tools.py"],
    ["build:deps", "npm run build:deps"],
  ])("omits non-build guidance %s / %s", (name, command) => {
    const facts = runbookFacts();
    facts.quickstart.commands = [{ name, command, source: "README.md" }];
    const runbook = generateRunbook(facts);
    expect(runbook).toContain("_No build command detected_");
    expect(runbook).not.toContain("```bash");
    if (command === "npm test") {
      expect(generateBootcamp(facts, options)).toContain(`Build/verify: \`${command}\``);
    } else {
      expect(generateBootcamp(facts, options)).not.toContain(`Build/verify: \`${command}\``);
    }
  });

  it("omits an empty declared build invocation", () => {
    const facts = runbookFacts();
    facts.quickstart.commands = [{ name: "build", command: "", source: "README.md" }];
    const runbook = generateRunbook(facts);
    expect(runbook).toContain("_No build command detected_");
    expect(runbook).not.toContain("```bash");
  });

  it("uses the first qualifying build while skipping setup and test commands", () => {
    const facts = runbookFacts();
    facts.quickstart.commands = [
      { name: "setup", command: "npm install", source: "README.md" },
      { name: "test", command: "npm test", source: "package.json" },
      { name: "compile", command: "npm run compile", source: "package.json" },
      { name: "bundle", command: "npm run bundle", source: "package.json" },
    ];
    const runbook = generateRunbook(facts);
    expect(runbook).toContain("```bash\nnpm run compile\n```");
    expect(runbook).not.toContain("npm install");
    expect(runbook).not.toContain("npm run bundle");
  });

  it("preserves multiline build commands containing complete code fences", () => {
    const facts = runbookFacts();
    const command = "printf '```'\n  npm run build\t-- --target='literal target'";
    facts.quickstart.commands = [{ name: "build", command, source: "README.md" }];
    const runbook = generateRunbook(facts);
    expect(runbook).toContain(`\`\`\`\`bash\n${command}\n\`\`\`\``);
    expect(markdownToHtml(runbook)).toContain(
      "printf '```'\n  npm run build\t-- --target='literal target'"
    );
    expect(generateOnboarding(facts)).toContain(`\`\`\`\`bash\n${command}\n\`\`\`\``);
  });

  it("uses fallback guidance for absent or empty operational evidence", () => {
    const facts = runbookFacts();
    facts.quickstart.commands = [{ name: "compile", command: "make compile", source: "Makefile" }];
    facts.runbook = undefined;
    expect(generateRunbook(facts)).toContain("```bash\nmake compile\n```");
    facts.runbook = { applicable: true, deploySteps: [], observability: [], incidents: [] };
    expect(generateRunbook(facts)).toContain("```bash\nmake compile\n```");
  });

  it("preserves explicit operational runbooks regardless of quickstart aliases", () => {
    const facts = runbookFacts();
    facts.runbook = {
      applicable: true,
      deploySteps: ["Use the documented release procedure"],
      observability: ["Inspect service metrics"],
      incidents: [{ name: "Incident", check: "Follow the incident procedure" }],
      sources: ["docs/operations.md"],
    };
    const original = generateRunbook(facts);
    facts.quickstart.commands = [
      { name: "bundle", command: "npm run bundle", source: "package.json" },
    ];
    expect(generateRunbook(facts)).toBe(original);
    expect(original).toContain("Use the documented release procedure");
    expect(original).not.toContain("Build & Release");
  });
});
