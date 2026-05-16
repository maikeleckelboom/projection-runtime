import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const workspaceAliases = {
  "@exclave/base": fileURLToPath(new URL("./packages/base/src/index.ts", import.meta.url)),
  "@exclave/schema": fileURLToPath(new URL("./packages/schema/src/index.ts", import.meta.url)),
  "@exclave/compiler": fileURLToPath(new URL("./packages/compiler/src/index.ts", import.meta.url)),
  "@exclave/conformance": fileURLToPath(
    new URL("./packages/conformance/src/index.ts", import.meta.url),
  ),
  "@exclave/hot-codec": fileURLToPath(
    new URL("./packages/hot-codec/src/index.ts", import.meta.url),
  ),
  "@exclave/hot-binding": fileURLToPath(
    new URL("./packages/hot-binding/src/index.ts", import.meta.url),
  ),
  "@exclave/hot-consumer": fileURLToPath(
    new URL("./packages/hot-consumer/src/index.ts", import.meta.url),
  ),
  "@exclave/hot-publisher": fileURLToPath(
    new URL("./packages/hot-publisher/src/index.ts", import.meta.url),
  ),
  "@exclave/session": fileURLToPath(new URL("./packages/session/src/index.ts", import.meta.url)),
  "@exclave/control-plane": fileURLToPath(
    new URL("./packages/control-plane/src/index.ts", import.meta.url),
  ),
  "@exclave/resource": fileURLToPath(new URL("./packages/resource/src/index.ts", import.meta.url)),
  "@exclave/warm": fileURLToPath(new URL("./packages/warm/src/index.ts", import.meta.url)),
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
          name: "@exclave/base",
          environment: "node",
          include: ["packages/base/tests/**/*.test.ts", "packages/base/src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@exclave/schema",
          environment: "node",
          include: ["packages/schema/tests/**/*.test.ts", "packages/schema/src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@exclave/compiler",
          environment: "node",
          include: ["packages/compiler/tests/**/*.test.ts", "packages/compiler/src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@exclave/conformance",
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
          name: "@exclave/hot-binding",
          environment: "node",
          include: [
            "packages/hot-binding/tests/**/*.test.ts",
            "packages/hot-binding/src/**/*.test.ts",
          ],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@exclave/hot-publisher",
          environment: "node",
          include: [
            "packages/hot-publisher/tests/**/*.test.ts",
            "packages/hot-publisher/src/**/*.test.ts",
          ],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@exclave/hot-codec",
          environment: "node",
          include: ["packages/hot-codec/tests/**/*.test.ts", "packages/hot-codec/src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@exclave/hot-consumer",
          environment: "node",
          include: [
            "packages/hot-consumer/tests/**/*.test.ts",
            "packages/hot-consumer/src/**/*.test.ts",
          ],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@exclave/session",
          environment: "node",
          include: ["packages/session/tests/**/*.test.ts", "packages/session/src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@exclave/control-plane",
          environment: "node",
          include: [
            "packages/control-plane/tests/**/*.test.ts",
            "packages/control-plane/src/**/*.test.ts",
          ],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@exclave/resource",
          environment: "node",
          include: ["packages/resource/tests/**/*.test.ts", "packages/resource/src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias: workspaceAliases,
        },
        test: {
          name: "@exclave/warm",
          environment: "node",
          include: ["packages/warm/tests/**/*.test.ts", "packages/warm/src/**/*.test.ts"],
        },
      },
    ],
  },
});
