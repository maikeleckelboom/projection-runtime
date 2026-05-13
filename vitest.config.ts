import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "@seqlok/base",
          environment: "node",
          include: ["packages/base/tests/**/*.test.ts", "packages/base/src/**/*.test.ts"],
        },
      },
    ],
  },
});
