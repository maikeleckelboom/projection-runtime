import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "packages",
      environment: "node",
      include: ["packages/*/src/**/*.test.ts", "packages/*/src/**/*.spec.ts"],
    },
  },
]);
