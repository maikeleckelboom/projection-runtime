import { existsSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function collectFiles(dir: string, pattern: RegExp): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, pattern));
      continue;
    }
    if (entry.isFile() && pattern.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const kebabCaseRegex = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z]+)*$/;

const packageExceptions = new Set(["index.ts", "index.d.ts", "README.md"]);

function isPackageTsOrMd(file: string): boolean {
  const name = basename(file);
  if (packageExceptions.has(name)) return true;
  return false;
}

function isExemptPath(file: string): boolean {
  const rel = relative(root, file).replaceAll("\\", "/");
  if (/[/]?fixtures[/][^/]*[/]generated[/]/.test(rel)) return true;
  if (/[/]?dist[/]/.test(rel)) return true;
  if (/[/]?node_modules[/]/.test(rel)) return true;
  return false;
}

function checkFileNames(): void {
  const errors: string[] = [];

  const packageTsFiles = collectFiles(join(root, "packages"), /\.ts$/);

  for (const file of packageTsFiles) {
    if (isExemptPath(file)) continue;
    const name = basename(file);
    if (isPackageTsOrMd(file)) continue;
    const stem = name.replace(/\.ts$/, "");
    if (!kebabCaseRegex.test(stem)) {
      errors.push(`${relative(root, file)}: not kebab-case`);
    }
  }

  const docsMdFiles = collectFiles(join(root, "docs"), /\.md$/);

  for (const file of docsMdFiles) {
    if (isExemptPath(file)) continue;
    const name = basename(file);
    if (name === "README.md") continue;
    const stem = name.replace(/\.md$/, "");
    if (!kebabCaseRegex.test(stem)) {
      errors.push(`${relative(root, file)}: not kebab-case`);
    }
  }

  if (errors.length > 0) {
    console.error("\n[file-name check failed]");
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    console.error();
    process.exit(1);
  }
}

checkFileNames();
