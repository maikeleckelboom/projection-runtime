import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packages = ["base", "schema", "primitives", "core"];

const paths = [
  "coverage",
  "tsconfig.packages.tsbuildinfo",
  ...packages.flatMap((name) => [
    `packages/${name}/dist`,
    `packages/${name}/coverage`,
    `packages/${name}/tsconfig.tsbuildinfo`,
  ]),
];

await Promise.all(paths.map((path) => rm(join(root, path), { recursive: true, force: true })));
