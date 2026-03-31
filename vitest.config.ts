import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["test/e2e.test.ts", "test/e2e/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/types.ts", "src/index.ts", "src/lib.ts", "src/api.ts", "src/cli.ts"],
      thresholds: {
        lines: 80,
        branches: 70,
      },
    },
  },
});
