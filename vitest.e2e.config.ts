import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/e2e.test.ts", "test/e2e/**/*.test.ts"],
    // Real CLI startup is slower on a cold install than in-process unit tests.
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
