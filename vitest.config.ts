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
      {
        test: {
          name: "@seqlok/schema",
          environment: "node",
          include: ["packages/schema/tests/**/*.test.ts", "packages/schema/src/**/*.test.ts"],
        },
      },
    ],
  },
});
