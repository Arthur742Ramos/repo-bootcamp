import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("chalk", () => {
  const makeChalk = (): any =>
    new Proxy((...args: any[]) => args.join(""), {
      get: () => makeChalk(),
      apply: (_t: any, _a: any, args: any[]) => args.join(""),
    });
  return { default: makeChalk() };
});

const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      try {
        const result = mockExecFile(args[0], args[1], args[2]);
        if (result instanceof Error) cb(result, { stdout: "", stderr: "" });
        else cb(null, { stdout: result ?? "", stderr: "" });
      } catch (e) {
        cb(e, { stdout: "", stderr: "" });
      }
    }
  },
}));

vi.mock("fs", () => ({ watch: vi.fn().mockReturnValue({ on: vi.fn(), close: vi.fn() }) }));

import { getHeadCommit, fetchAndCheckUpdates, startWatch } from "../src/watch.js";

describe("watch extra coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("getHeadCommit returns trimmed SHA", async () => {
    mockExecFile.mockReturnValue("abc123\n");
    expect(await getHeadCommit("/repo")).toBe("abc123");
  });

  it("getHeadCommit returns empty on error", async () => {
    mockExecFile.mockImplementation(() => {
      throw new Error("fail");
    });
    expect(await getHeadCommit("/bad")).toBe("");
  });

  it("fetchAndCheckUpdates no change", async () => {
    mockExecFile.mockReturnValueOnce("").mockReturnValueOnce("abc\n");
    const r = await fetchAndCheckUpdates("/r", "abc");
    expect(r.updated).toBe(false);
  });

  it("fetchAndCheckUpdates with change and merge", async () => {
    mockExecFile.mockReturnValueOnce("").mockReturnValueOnce("def\n").mockReturnValueOnce("");
    const r = await fetchAndCheckUpdates("/r", "abc");
    expect(r.updated).toBe(true);
  });

  it("fetchAndCheckUpdates FETCH_HEAD fallback", async () => {
    mockExecFile
      .mockReturnValueOnce("")
      .mockImplementationOnce(() => {
        throw new Error("no upstream");
      })
      .mockReturnValueOnce("def\n")
      .mockReturnValueOnce("");
    const r = await fetchAndCheckUpdates("/r", "abc");
    expect(r.updated).toBe(true);
  });

  it("fetchAndCheckUpdates hard reset on ff fail", async () => {
    mockExecFile
      .mockReturnValueOnce("")
      .mockReturnValueOnce("def\n")
      .mockImplementationOnce(() => {
        throw new Error("not ff");
      })
      .mockReturnValueOnce("");
    const r = await fetchAndCheckUpdates("/r", "abc", { allowHardReset: true });
    expect(r.updated).toBe(true);
  });

  it("fetchAndCheckUpdates throws when ff fails without reset", async () => {
    mockExecFile
      .mockReturnValueOnce("")
      .mockReturnValueOnce("def\n")
      .mockImplementationOnce(() => {
        throw new Error("not ff");
      });
    await expect(fetchAndCheckUpdates("/r", "abc")).rejects.toThrow("not a fast-forward");
  });

  it("startWatch polls and detects change", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    mockExecFile
      .mockReturnValueOnce("aaa\n") // getHeadCommit
      .mockReturnValueOnce("") // fetch
      .mockReturnValueOnce("bbb\n") // @{u}
      .mockReturnValueOnce(""); // merge

    const h = startWatch("/r", { intervalSeconds: 1, onChangeDetected: onChange, verbose: true });
    await vi.advanceTimersByTimeAsync(1200);
    h.stop();
    expect(onChange).toHaveBeenCalled();
  });

  it("startWatch handles error gracefully", async () => {
    mockExecFile.mockReturnValueOnce("aaa\n").mockImplementationOnce(() => {
      throw new Error("net error");
    });
    const h = startWatch("/r", { intervalSeconds: 1, onChangeDetected: vi.fn(), verbose: true });
    await vi.advanceTimersByTimeAsync(1200);
    h.stop();
  });

  it("startWatch no change", async () => {
    const onChange = vi.fn();
    mockExecFile.mockReturnValueOnce("aaa\n").mockReturnValueOnce("").mockReturnValueOnce("aaa\n");
    const h = startWatch("/r", { intervalSeconds: 1, onChangeDetected: onChange });
    await vi.advanceTimersByTimeAsync(1200);
    h.stop();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("startWatch with allowHardReset warns", () => {
    const h = startWatch("/r", {
      intervalSeconds: 1,
      onChangeDetected: vi.fn(),
      allowHardReset: true,
    });
    h.stop();
  });
});
