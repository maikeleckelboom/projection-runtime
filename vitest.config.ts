import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const workspaceAliases = {
  "@seqlok/base": fileURLToPath(new URL("./packages/base/src/index.ts", import.meta.url)),
  "@seqlok/primitives": fileURLToPath(
    new URL("./packages/primitives/src/index.ts", import.meta.url),
  ),
  "@seqlok/schema": fileURLToPath(new URL("./packages/schema/src/index.ts", import.meta.url)),
  "@seqlok/compiler": fileURLToPath(new URL("./packages/compiler/src/index.ts", import.meta.url)),
  "@seqlok/conformance": fileURLToPath(
    new URL("./packages/conformance/src/index.ts", import.meta.url),
  ),
  "@seqlok/hot-codec": fileURLToPath(new URL("./packages/hot-codec/src/index.ts", import.meta.url)),
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
          name: "@seqlok/compiler",
          environment: "node",
          include: ["packages/compiler/tests/**/*.test.ts", "packages/compiler/src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@seqlok/conformance",
          environment: "node",
          include: [
            "packages/conformance/tests/**/*.test.ts",
            "packages/conformance/src/**/*.test.ts",
          ],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@seqlok/hot-codec",
          environment: "node",
          include: ["packages/hot-codec/tests/**/*.test.ts", "packages/hot-codec/src/**/*.test.ts"],
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
