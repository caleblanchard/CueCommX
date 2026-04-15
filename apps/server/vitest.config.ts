import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "dist/**",
        "**/*.d.ts",
        "test/**",
        "vitest.config.ts",
        "src/index.ts",
        "src/media/service.ts",
      ],
      provider: "v8",
      thresholds: {
        branches: 70,
        functions: 85,
        lines: 84,
        statements: 84,
      },
    },
  },
});
