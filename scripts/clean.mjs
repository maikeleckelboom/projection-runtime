import { access, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagesRoot = join(root, "packages");

const packageEntries = await readdir(packagesRoot, { withFileTypes: true }).catch(() => []);
const packages = [];

for (const entry of packageEntries) {
  if (!entry.isDirectory()) {
    continue;
  }

  const packageJson = join(packagesRoot, entry.name, "package.json");

  try {
    await access(packageJson);
    packages.push(entry.name);
  } catch {
    // Empty future package directories are intentionally ignored.
  }
}

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
