import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

type SourceFile = {
  readonly path: string;
  readonly relativePath: string;
  readonly text: string;
};

type ForbiddenPattern = {
  readonly description: string;
  readonly match: string | RegExp;
};

function run(label: string, command: string, args: readonly string[]): void {
  const [actualCommand, actualArgs] = resolveCommand(command, args);
  const renderedCommand = [command, ...args].join(" ");

  console.log(`\n[verify] ${label}`);
  console.log(`[verify] ${renderedCommand}\n`);

  try {
    execFileSync(actualCommand, actualArgs, { cwd: root, stdio: "inherit" });
  } catch (err) {
    console.error(`\n[verify failed] ${label}`);
    console.error(`[verify failed] ${renderedCommand}\n`);
    process.exit((err as { status?: number }).status ?? 1);
  }

  console.log();
}

function resolveCommand(
  command: string,
  args: readonly string[],
): readonly [string, readonly string[]] {
  if (command !== "pnpm") {
    return [command, args];
  }

  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath !== undefined && npmExecPath.length > 0) {
    return [process.execPath, [npmExecPath, ...args]];
  }

  return [command, args];
}

function readSourceFiles(dir: string): SourceFile[] {
  if (!existsSync(dir)) {
    console.error(`[source guard failed] missing guarded root: ${relative(root, dir)}`);
    process.exit(1);
  }

  const files: SourceFile[] = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((left, right) =>
    compareString(left.name, right.name),
  );

  for (const entry of entries) {
    const path = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...readSourceFiles(path));
      continue;
    }

    if (entry.isFile() && extname(entry.name) === ".ts" && !entry.name.endsWith(".test.ts")) {
      files.push({
        path,
        relativePath: relative(root, path),
        text: readFileSync(path, "utf8"),
      });
    }
  }

  return files;
}

function assertNotContains(
  label: string,
  files: readonly SourceFile[],
  forbidden: readonly ForbiddenPattern[],
): void {
  for (const file of files) {
    for (const { description, match } of forbidden) {
      const found = typeof match === "string" ? file.text.includes(match) : match.test(file.text);

      if (found) {
        console.error(`\n[source guard failed] ${label}`);
        console.error(`  File: ${file.relativePath}`);
        console.error(`  Forbidden: ${description}\n`);
        process.exit(1);
      }
    }
  }
}

function compareString(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

run("typecheck", "pnpm", ["typecheck"]);
run("test", "pnpm", ["test"]);
run("build", "pnpm", ["build"]);
run("cargo test", "cargo", ["test"]);
run("biome check", "pnpm", ["exec", "biome", "check", "."]);
run("check file names", "node", ["scripts/check-file-names.mts"]);

const guardedRoots = [
  resolve(root, "packages/hot-codec/src"),
  resolve(root, "packages/hot-binding/src"),
  resolve(root, "packages/compiler/src"),
  resolve(root, "packages/conformance/src"),
  resolve(root, "packages/hot-consumer/src"),
  resolve(root, "packages/hot-publisher/src"),
  resolve(root, "packages/session/src"),
  resolve(root, "packages/control-plane/src"),
  resolve(root, "packages/resource/src"),
  resolve(root, "packages/warm/src"),
  resolve(root, "packages/publication/src"),
  resolve(root, "packages/host-contract/src"),
];

const allSourceFiles = guardedRoots.flatMap(readSourceFiles);
const hotConsumerFiles = readSourceFiles(resolve(root, "packages/hot-consumer/src"));

assertNotContains("no runtime error subclasses", allSourceFiles, [
  {
    description: "class extending Error",
    match: /class\s+\w+\s+extends\s+Error\b/,
  },
  {
    description: "class extending ExclaveError",
    match: /class\s+\w+\s+extends\s+ExclaveError\b/,
  },
]);

assertNotContains("no generic production error construction", allSourceFiles, [
  { description: "throw new Error", match: "throw new Error" },
  { description: "throw new RangeError", match: "throw new RangeError" },
  { description: "throw new TypeError", match: "throw new TypeError" },
]);

assertNotContains("no free-string code typing", allSourceFiles, [
  { description: "code: string", match: /code\s*:\s*string/ },
]);

assertNotContains("no Electron references in hot-consumer", hotConsumerFiles, [
  { description: "BrowserWindow", match: /BrowserWindow/ },
  { description: "Electron", match: /Electron/ },
  { description: "ipcMain", match: /ipcMain/ },
  { description: "ipcRenderer", match: /ipcRenderer/ },
]);

console.log("\n[verify] passed");
