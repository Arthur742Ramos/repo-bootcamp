import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["test/e2e/**/*.test.ts"],
    // Several unit tests exercise real git operations (init/clone/commit) and
    // filesystem fixtures. Under load — busy CI runners, Windows, or parallel
    // suites — these can exceed Vitest's 5s default and flake with
    // "Test timed out in 5000ms". Give them headroom; fast tests finish in
    // milliseconds and are unaffected. (E2E uses a larger budget of its own.)
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/types.ts",
        "src/index.ts",
        "src/lib.ts",
        "src/api.ts",
        "src/cli.ts",
      ],
      thresholds: {
        lines: 80,
        branches: 70,
      },
    },
  },
});
