/**
 * Tests for the `styles` command renderer.
 *
 * These hit the pure formatting helpers directly so they don't depend on
 * process spawning. Color is stripped where assertions care about plain text.
 */

import { describe, expect, it } from "vitest";

import {
  buildHumanOutput,
  buildStylesJson,
  DEFAULT_STYLE,
  enabledSectionLabels,
  renderSectionMatrix,
  SECTION_DESCRIPTORS,
} from "../src/commands/styles-command.js";
import { STYLE_PACKS, STYLE_PACK_NAMES } from "../src/plugins.js";

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI, "");

describe("DEFAULT_STYLE", () => {
  it("matches getStyleConfig's fallback (oss)", () => {
    expect(DEFAULT_STYLE).toBe("oss");
    expect(STYLE_PACK_NAMES).toContain(DEFAULT_STYLE);
  });
});

describe("enabledSectionLabels", () => {
  it("returns only the sections a style enables, in descriptor order", () => {
    const labels = enabledSectionLabels(STYLE_PACKS.corporate);
    // corporate enables every section.
    expect(labels).toEqual(SECTION_DESCRIPTORS.map((d) => d.label));
  });

  it("returns an empty list for the minimal pack (essentials only)", () => {
    expect(enabledSectionLabels(STYLE_PACKS.minimal)).toEqual([]);
  });

  it("reflects the exact section flags for a partial pack", () => {
    const labels = enabledSectionLabels(STYLE_PACKS.startup);
    expect(labels).toContain("Runbook");
    expect(labels).toContain("Metrics");
    expect(labels).not.toContain("Security");
    expect(labels).not.toContain("Impact");
  });
});

describe("buildStylesJson", () => {
  it("lists every style pack in registry order with the default flagged", () => {
    const json = buildStylesJson();
    expect(json.default).toBe(DEFAULT_STYLE);
    expect(json.count).toBe(STYLE_PACK_NAMES.length);
    expect(json.styles.map((s) => s.name)).toEqual(STYLE_PACK_NAMES);
  });

  it("carries the full config surface for each style", () => {
    const json = buildStylesJson();
    const corporate = json.styles.find((s) => s.name === "corporate")!;
    expect(corporate.description).toBe(STYLE_PACKS.corporate.description);
    expect(corporate.tone).toBe("formal");
    expect(corporate.sectionDepth).toBe("deep");
    expect(corporate.emoji).toBe(false);
    expect(corporate.badges).toBe("simple");
    expect(corporate.firstTasksCount).toBe(10);
    expect(corporate.sections).toEqual(STYLE_PACKS.corporate.sections);
    expect(corporate.enabledSections).toEqual(enabledSectionLabels(STYLE_PACKS.corporate));
  });

  it("represents the minimal pack with no enabled sections", () => {
    const json = buildStylesJson();
    const minimal = json.styles.find((s) => s.name === "minimal")!;
    expect(minimal.enabledSections).toEqual([]);
    expect(Object.values(minimal.sections).every((v) => v === false)).toBe(true);
  });

  it("is JSON-serializable and round-trips", () => {
    const json = buildStylesJson();
    expect(() => JSON.stringify(json)).not.toThrow();
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});

describe("renderSectionMatrix", () => {
  it("has a header row with every section label", () => {
    const plain = stripAnsi(renderSectionMatrix());
    const [header] = plain.split("\n");
    for (const descriptor of SECTION_DESCRIPTORS) {
      expect(header).toContain(descriptor.label);
    }
    expect(header).toContain("STYLE");
  });

  it("renders one row per style with aligned columns", () => {
    const plain = stripAnsi(renderSectionMatrix());
    const lines = plain.split("\n");
    // header + one row per style
    expect(lines).toHaveLength(STYLE_PACK_NAMES.length + 1);
    for (const name of STYLE_PACK_NAMES) {
      expect(plain).toContain(name);
    }
  });

  it("marks enabled sections with a check and disabled with a dot", () => {
    const plain = stripAnsi(renderSectionMatrix());
    const lines = plain.split("\n");
    const minimalRow = lines.find((l) => l.startsWith("minimal"))!;
    // minimal enables nothing → no checks
    expect(minimalRow).not.toContain("✓");
    expect(minimalRow).toContain("·");

    const corporateRow = lines.find((l) => l.startsWith("corporate"))!;
    // corporate enables everything → no dots
    expect(corporateRow).toContain("✓");
    expect(corporateRow).not.toContain("·");
  });
});

describe("buildHumanOutput", () => {
  it("includes a heading and the default-style hint", () => {
    const plain = stripAnsi(buildHumanOutput());
    expect(plain).toContain("Built-in style packs");
    expect(plain).toContain(`default: ${DEFAULT_STYLE}`);
    expect(plain).toContain("--style");
  });

  it("describes every style pack with its description", () => {
    const plain = stripAnsi(buildHumanOutput());
    for (const name of STYLE_PACK_NAMES) {
      expect(plain).toContain(name);
      expect(plain).toContain(STYLE_PACKS[name].description);
    }
  });

  it("flags the default style and surfaces tone/depth/first-task metadata", () => {
    const plain = stripAnsi(buildHumanOutput());
    expect(plain).toContain(`${DEFAULT_STYLE} (default)`);
    expect(plain).toContain("tone:");
    expect(plain).toContain("depth:");
    expect(plain).toContain("first tasks:");
  });

  it("shows 'essentials only' for the section-less minimal pack", () => {
    const plain = stripAnsi(buildHumanOutput());
    expect(plain).toContain("essentials only");
  });

  it("ends with the section-coverage matrix", () => {
    const plain = stripAnsi(buildHumanOutput());
    expect(plain).toContain("Section coverage");
  });
});
