import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BootcampOptions } from "../src/types.js";

vi.mock("../src/plugins.js", () => ({
  loadConfig: vi.fn(),
  getStyleConfig: vi.fn(),
}));

import { loadConfig, getStyleConfig } from "../src/plugins.js";
import {
  resolveOutputFormat,
  resolveRunConfiguration,
} from "../src/services/config-resolution.js";

const mockedLoadConfig = vi.mocked(loadConfig);
const mockedGetStyleConfig = vi.mocked(getStyleConfig);

function makeOptions(overrides: Partial<BootcampOptions> = {}): BootcampOptions {
  return {
    branch: "main",
    focus: "all",
    audience: "all",
    output: ".",
    maxFiles: 50,
    noClone: false,
    verbose: false,
    optionSource: { focus: "default", audience: "default", maxFiles: "default", model: "default", style: "default" },
    ...overrides,
  };
}

const defaultStyleConfig = {
  name: "oss" as const,
  description: "Community-friendly open source documentation",
  tone: "casual" as const,
  sectionDepth: "standard" as const,
  emoji: true,
  sections: {
    showRunbook: false,
    showSecurityDetails: true,
    showDependencyGraph: true,
    showRadar: true,
    showImpact: false,
  },
  badges: { style: "shields" as const },
  firstTasksCount: 8,
  introText: "Welcome",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedLoadConfig.mockResolvedValue(null);
  mockedGetStyleConfig.mockReturnValue(defaultStyleConfig);
});

describe("resolveOutputFormat", () => {
  it("returns markdown by default", () => {
    expect(resolveOutputFormat()).toBe("markdown");
    expect(resolveOutputFormat(undefined)).toBe("markdown");
  });

  it("accepts valid formats", () => {
    expect(resolveOutputFormat("markdown")).toBe("markdown");
    expect(resolveOutputFormat("html")).toBe("html");
    expect(resolveOutputFormat("pdf")).toBe("pdf");
  });

  it("throws on invalid format", () => {
    expect(() => resolveOutputFormat("docx")).toThrow("Invalid format: docx");
    expect(() => resolveOutputFormat("txt")).toThrow("Invalid format");
  });
});

describe("resolveRunConfiguration", () => {
  describe("config file discovery", () => {
    it("returns null config when no config file found", async () => {
      mockedLoadConfig.mockResolvedValue(null);
      const result = await resolveRunConfiguration(makeOptions());
      expect(result.config).toBeNull();
      expect(loadConfig).toHaveBeenCalled();
    });

    it("returns loaded config when found", async () => {
      const config = { style: "corporate" as const, defaults: { focus: "architecture" as const } };
      mockedLoadConfig.mockResolvedValue(config);
      const result = await resolveRunConfiguration(makeOptions());
      expect(result.config).toBe(config);
    });
  });

  describe("config merging / precedence", () => {
    it("applies config defaults when option source is default", async () => {
      mockedLoadConfig.mockResolvedValue({
        defaults: { focus: "onboarding", audience: "backend", maxFiles: 100, model: "gpt-4" },
      });
      const opts = makeOptions();
      await resolveRunConfiguration(opts);
      expect(opts.focus).toBe("onboarding");
      expect(opts.audience).toBe("backend");
      expect(opts.maxFiles).toBe(100);
      expect(opts.model).toBe("gpt-4");
    });

    it("does not override CLI-provided values", async () => {
      mockedLoadConfig.mockResolvedValue({
        defaults: { focus: "onboarding", audience: "backend" },
      });
      const opts = makeOptions({
        focus: "architecture",
        audience: "frontend",
        optionSource: { focus: "cli", audience: "cli", maxFiles: "default", model: "default", style: "default" },
      });
      await resolveRunConfiguration(opts);
      expect(opts.focus).toBe("architecture");
      expect(opts.audience).toBe("frontend");
    });

    it("applies config style to options when optionSource is default", async () => {
      mockedLoadConfig.mockResolvedValue({
        style: "corporate",
        defaults: { style: "startup" },
      });
      const opts = makeOptions();
      await resolveRunConfiguration(opts);
      // defaults.style takes precedence via applyConfigDefault
      expect(opts.style).toBe("startup");
    });

    it("falls back to config.style when defaults.style is absent and options.style is unset", async () => {
      mockedLoadConfig.mockResolvedValue({ style: "minimal" });
      const opts = makeOptions({ style: undefined });
      await resolveRunConfiguration(opts);
      expect(opts.style).toBe("minimal");
    });

    it("applies system prompt from config when not set in options", async () => {
      mockedLoadConfig.mockResolvedValue({
        prompts: { system: "Be concise." },
      });
      const opts = makeOptions();
      await resolveRunConfiguration(opts);
      expect(opts.systemPrompt).toBe("Be concise.");
    });

    it("does not override existing systemPrompt", async () => {
      mockedLoadConfig.mockResolvedValue({
        prompts: { system: "Be concise." },
      });
      const opts = makeOptions({ systemPrompt: "Custom prompt" });
      await resolveRunConfiguration(opts);
      expect(opts.systemPrompt).toBe("Custom prompt");
    });
  });

  describe("default values", () => {
    it("uses markdown as default output format", async () => {
      const result = await resolveRunConfiguration(makeOptions());
      expect(result.outputFormat).toBe("markdown");
    });

    it("passes style and customStyle to getStyleConfig", async () => {
      const customStyle = { emoji: false };
      mockedLoadConfig.mockResolvedValue({ style: "startup", customStyle });
      const opts = makeOptions({ style: "startup" });
      await resolveRunConfiguration(opts);
      expect(getStyleConfig).toHaveBeenCalledWith("startup", customStyle);
    });

    it("returns styleConfig from getStyleConfig", async () => {
      const result = await resolveRunConfiguration(makeOptions());
      expect(result.styleConfig).toBe(defaultStyleConfig);
    });
  });

  describe("edge cases", () => {
    it("normalizes non-finite maxFiles from config", async () => {
      mockedLoadConfig.mockResolvedValue({
        defaults: { maxFiles: Infinity },
      });
      const opts = makeOptions({ maxFiles: 25 });
      await resolveRunConfiguration(opts);
      // Infinity is not finite, so normalizeMaxFiles returns undefined → not applied
      expect(opts.maxFiles).toBe(25);
    });

    it("normalizes negative maxFiles from config", async () => {
      mockedLoadConfig.mockResolvedValue({
        defaults: { maxFiles: -5 },
      });
      const opts = makeOptions({ maxFiles: 30 });
      await resolveRunConfiguration(opts);
      expect(opts.maxFiles).toBe(30);
    });

    it("normalizes zero maxFiles from config", async () => {
      mockedLoadConfig.mockResolvedValue({
        defaults: { maxFiles: 0 },
      });
      const opts = makeOptions({ maxFiles: 30 });
      await resolveRunConfiguration(opts);
      expect(opts.maxFiles).toBe(30);
    });

    it("floors fractional maxFiles from config", async () => {
      mockedLoadConfig.mockResolvedValue({
        defaults: { maxFiles: 42.9 },
      });
      const opts = makeOptions();
      await resolveRunConfiguration(opts);
      expect(opts.maxFiles).toBe(42);
    });

    it("throws on invalid focus", async () => {
      const opts = makeOptions({ focus: "invalid" as any, optionSource: { focus: "cli" } as any });
      await expect(resolveRunConfiguration(opts)).rejects.toThrow("Invalid focus: invalid");
    });

    it("throws on invalid audience", async () => {
      const opts = makeOptions({ audience: "unknown" as any, optionSource: { audience: "cli" } as any });
      await expect(resolveRunConfiguration(opts)).rejects.toThrow("Invalid audience: unknown");
    });

    it("throws on invalid maxFiles (zero)", async () => {
      const opts = makeOptions({ maxFiles: 0, optionSource: { maxFiles: "cli" } as any });
      await expect(resolveRunConfiguration(opts)).rejects.toThrow("Invalid maxFiles: 0");
    });

    it("throws on invalid maxFiles (negative)", async () => {
      const opts = makeOptions({ maxFiles: -1, optionSource: { maxFiles: "cli" } as any });
      await expect(resolveRunConfiguration(opts)).rejects.toThrow("Invalid maxFiles: -1");
    });

    it("handles config with no defaults section", async () => {
      mockedLoadConfig.mockResolvedValue({ style: "oss" });
      const opts = makeOptions();
      const result = await resolveRunConfiguration(opts);
      expect(result.config?.style).toBe("oss");
    });

    it("handles config with empty defaults", async () => {
      mockedLoadConfig.mockResolvedValue({ defaults: {} });
      const opts = makeOptions();
      await resolveRunConfiguration(opts);
      // Should not change defaults
      expect(opts.focus).toBe("all");
      expect(opts.audience).toBe("all");
      expect(opts.maxFiles).toBe(50);
    });

    it("applies specified output format", async () => {
      const opts = makeOptions({ format: "html" });
      const result = await resolveRunConfiguration(opts);
      expect(result.outputFormat).toBe("html");
    });
  });
});
