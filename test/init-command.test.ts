import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("chalk", () => {
  const makeChalk = (): any =>
    new Proxy((...args: any[]) => args.join(""), {
      get: () => makeChalk(),
      apply: (_t: any, _a: any, args: any[]) => args.join(""),
    });
  return { default: makeChalk() };
});

const writeFileMock = vi.fn().mockResolvedValue(undefined);
const accessMock = vi.fn();
vi.mock("fs/promises", () => ({
  writeFile: (...args: any[]) => writeFileMock(...args),
  access: (...args: any[]) => accessMock(...args),
}));

import { runInitCommand, buildInitConfig } from "../src/commands/init-command.js";

describe("buildInitConfig", () => {
  it("returns valid default config JSON", () => {
    const parsed = JSON.parse(buildInitConfig());
    expect(parsed).toHaveProperty("style");
    expect(parsed).toHaveProperty("output");
  });

  it("presets the chosen style pack", () => {
    const parsed = JSON.parse(buildInitConfig("corporate"));
    expect(parsed.style).toBe("corporate");
  });
});

describe("runInitCommand", () => {
  const mockExit = vi
    .spyOn(process, "exit")
    .mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockClear();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Default: file does not exist.
    accessMock.mockRejectedValue(new Error("ENOENT"));
  });

  it("writes a config file when none exists", async () => {
    await runInitCommand({});
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, content] = writeFileMock.mock.calls[0];
    expect(() => JSON.parse(String(content))).not.toThrow();
    expect(logSpy).toHaveBeenCalled();
  });

  it("refuses to overwrite an existing file without --force", async () => {
    accessMock.mockResolvedValue(undefined); // file exists
    await expect(runInitCommand({})).rejects.toThrow("process.exit");
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("overwrites an existing file with --force", async () => {
    accessMock.mockResolvedValue(undefined); // file exists
    await runInitCommand({ force: true });
    expect(writeFileMock).toHaveBeenCalledTimes(1);
  });

  it("prints to stdout with --print and does not write a file", async () => {
    await runInitCommand({ print: true });
    expect(writeFileMock).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(() => JSON.parse(printed)).not.toThrow();
  });

  it("rejects an invalid style", async () => {
    await expect(runInitCommand({ style: "bogus" })).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("embeds the chosen style in the written config", async () => {
    await runInitCommand({ style: "startup" });
    const [, content] = writeFileMock.mock.calls[0];
    expect(JSON.parse(String(content)).style).toBe("startup");
  });

  it("writes to a custom --path", async () => {
    await runInitCommand({ path: "config/custom.json" });
    const [target] = writeFileMock.mock.calls[0];
    expect(String(target)).toContain("custom.json");
  });
});
