import type { Dirent } from "node:fs";
import { access, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagesRoot = join(root, "packages");

const packageEntries: readonly Dirent[] = await readdir(packagesRoot, {
  withFileTypes: true,
}).catch((): readonly Dirent[] => []);
const packageNames: string[] = [];

for (const entry of packageEntries) {
  if (!entry.isDirectory()) {
    continue;
  }

  const packageJson = join(packagesRoot, entry.name, "package.json");

  try {
    await access(packageJson);
    packageNames.push(entry.name);
  } catch {
    // Empty future package directories are intentionally ignored.
  }
}

const pathsToRemove: readonly string[] = [
  ".cache",
  "coverage",
  "tsconfig.packages.tsbuildinfo",
  ...packageNames.flatMap((packageName): string[] => [
    `packages/${packageName}/dist`,
    `packages/${packageName}/coverage`,
    `packages/${packageName}/tsconfig.tsbuildinfo`,
  ]),
];

await Promise.all(
  pathsToRemove.map(
    (relativePath): Promise<void> => rm(join(root, relativePath), { recursive: true, force: true }),
  ),
);
