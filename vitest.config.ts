import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const workspaceAliases = {
  "@seqlok/base": fileURLToPath(new URL("./packages/base/src/index.ts", import.meta.url)),
  "@seqlok/primitives": fileURLToPath(
    new URL("./packages/primitives/src/index.ts", import.meta.url),
  ),
  "@seqlok/schema": fileURLToPath(new URL("./packages/schema/src/index.ts", import.meta.url)),
};

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    projects: [
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@seqlok/base",
          environment: "node",
          include: ["packages/base/tests/**/*.test.ts", "packages/base/src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@seqlok/schema",
          environment: "node",
          include: ["packages/schema/tests/**/*.test.ts", "packages/schema/src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@seqlok/primitives",
          environment: "node",
          include: [
            "packages/primitives/tests/**/*.test.ts",
            "packages/primitives/src/**/*.test.ts",
          ],
        },
      },
    ],
  },
});
