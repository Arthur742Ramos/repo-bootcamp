import { describe, it, expect, vi } from "vitest";
import {
  evaluateDoctor,
  formatDoctorReport,
  parseNodeMajor,
  MIN_NODE_MAJOR,
  type EnvironmentSnapshot,
} from "../src/doctor.js";
import {
  runDoctor,
  colorizeReport,
  buildDoctorJson,
} from "../src/commands/doctor-command.js";

function env(overrides: Partial<EnvironmentSnapshot> = {}): EnvironmentSnapshot {
  return {
    nodeVersion: "v20.11.0",
    platform: "linux",
    arch: "x64",
    gitVersion: "git version 2.43.0",
    ghVersion: "gh version 2.40.0",
    ghAuthenticated: true,
    tokenEnvVars: [],
    mermaidAvailable: true,
    cacheDir: "/home/user/.cache/repo-bootcamp",
    cacheEntryCount: 3,
    cacheTotalBytes: 4096,
    cacheError: null,
    ...overrides,
  };
}

describe("parseNodeMajor", () => {
  it("extracts the major version", () => {
    expect(parseNodeMajor("v20.11.0")).toBe(20);
    expect(parseNodeMajor("18.0.0")).toBe(18);
    expect(parseNodeMajor("v22.3.1")).toBe(22);
  });

  it("returns NaN for unparseable input", () => {
    expect(Number.isNaN(parseNodeMajor("not-a-version"))).toBe(true);
  });
});

describe("evaluateDoctor", () => {
  it("passes when the environment is healthy", () => {
    const report = evaluateDoctor(env());
    expect(report.ok).toBe(true);
    expect(report.hasWarnings).toBe(false);
    const node = report.checks.find((c) => c.id === "node");
    expect(node?.status).toBe("ok");
  });

  it("fails (required) on an old Node version", () => {
    const report = evaluateDoctor(env({ nodeVersion: "v18.19.0" }));
    expect(report.ok).toBe(false);
    const node = report.checks.find((c) => c.id === "node");
    expect(node?.status).toBe("fail");
    expect(node?.severity).toBe("required");
    expect(node?.remedy).toContain(String(MIN_NODE_MAJOR));
  });

  it("fails (required) when git is missing", () => {
    const report = evaluateDoctor(env({ gitVersion: null }));
    expect(report.ok).toBe(false);
    const git = report.checks.find((c) => c.id === "git");
    expect(git?.status).toBe("fail");
  });

  it("warns (not fail) when gh CLI is missing", () => {
    const report = evaluateDoctor(env({ ghVersion: null, ghAuthenticated: null }));
    expect(report.ok).toBe(true); // gh is recommended, not required
    expect(report.hasWarnings).toBe(true);
    const gh = report.checks.find((c) => c.id === "gh");
    expect(gh?.status).toBe("warn");
  });

  it("treats a token env var as valid authentication", () => {
    const report = evaluateDoctor(
      env({ ghAuthenticated: false, tokenEnvVars: ["GITHUB_TOKEN"] })
    );
    const auth = report.checks.find((c) => c.id === "auth");
    expect(auth?.status).toBe("ok");
    expect(auth?.detail).toContain("GITHUB_TOKEN");
  });

  it("warns when there is no authentication at all", () => {
    const report = evaluateDoctor(
      env({ ghAuthenticated: false, tokenEnvVars: [] })
    );
    const auth = report.checks.find((c) => c.id === "auth");
    expect(auth?.status).toBe("warn");
  });

  it("treats missing mermaid-cli as informational, not a failure", () => {
    const report = evaluateDoctor(env({ mermaidAvailable: false }));
    const mermaid = report.checks.find((c) => c.id === "mermaid");
    expect(mermaid?.status).toBe("info");
    expect(report.ok).toBe(true);
  });

  it("warns when the cache directory cannot be read", () => {
    const report = evaluateDoctor(env({ cacheError: "EACCES: permission denied" }));
    const cache = report.checks.find((c) => c.id === "cache");
    expect(cache?.status).toBe("warn");
    expect(cache?.detail).toContain("permission denied");
  });

  it("computes status counts", () => {
    const report = evaluateDoctor(env());
    const total =
      report.counts.ok + report.counts.warn + report.counts.fail + report.counts.info;
    expect(total).toBe(report.checks.length);
  });
});

describe("formatDoctorReport", () => {
  it("renders a readable plain-text report", () => {
    const text = formatDoctorReport(evaluateDoctor(env()));
    expect(text).toContain("repo-bootcamp environment check");
    expect(text).toContain("Node.js runtime");
    expect(text).toContain("Summary:");
    expect(text).toContain("All required checks passed");
  });

  it("shows remedies for failures", () => {
    const text = formatDoctorReport(evaluateDoctor(env({ gitVersion: null })));
    expect(text).toContain("→");
    expect(text).toContain("required checks failed");
  });
});

describe("runDoctor", () => {
  it("prints colorized output and does not exit when healthy", async () => {
    const log = vi.fn();
    const exit = vi.fn();
    const report = await runDoctor(
      {},
      { gather: async () => env(), log, exit }
    );
    expect(report.ok).toBe(true);
    expect(exit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("environment check");
  });

  it("exits with code 1 when a required check fails", async () => {
    const log = vi.fn();
    const exit = vi.fn();
    await runDoctor(
      {},
      { gather: async () => env({ gitVersion: null }), log, exit }
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("emits valid JSON with --json", async () => {
    const log = vi.fn();
    const exit = vi.fn();
    await runDoctor(
      { json: true },
      { gather: async () => env(), log, exit }
    );
    const payload = JSON.parse(log.mock.calls[0][0] as string);
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(payload.environment.nodeVersion).toBe("v20.11.0");
  });
});

describe("buildDoctorJson / colorizeReport", () => {
  it("builds a stable JSON shape", () => {
    const e = env();
    const json = buildDoctorJson(evaluateDoctor(e), e);
    expect(json).toHaveProperty("ok");
    expect(json).toHaveProperty("counts");
    expect(json).toHaveProperty("checks");
    expect(json.environment).toBe(e);
  });

  it("colorizes without throwing and includes labels", () => {
    const text = colorizeReport(evaluateDoctor(env()));
    expect(text).toContain("environment check");
    expect(text).toContain("git");
  });
});
