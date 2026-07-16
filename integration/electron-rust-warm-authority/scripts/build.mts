import { execFileSync } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type BuildOptions, build } from "esbuild";

const integrationRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = resolve(integrationRoot, "../..");
const outputRoot = join(repositoryRoot, ".cache", "electron-rust-warm-authority");
const outputBin = join(outputRoot, "bin");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputBin, { recursive: true });

execFileSync("cargo", ["build", "--package", "electron-rust-warm-authority"], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

const cargoMetadata = JSON.parse(
  execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }),
) as { readonly target_directory: string };
const authorityBinaryName =
  process.platform === "win32"
    ? "electron-rust-warm-authority.exe"
    : "electron-rust-warm-authority";
const authoritySource = join(cargoMetadata.target_directory, "debug", authorityBinaryName);
await copyFile(authoritySource, join(outputBin, authorityBinaryName));

const aliases = Object.fromEntries(
  ["base", "session", "control-plane", "warm", "publication"].map((packageName) => [
    `@exclave/${packageName}`,
    join(repositoryRoot, "packages", packageName, "src", "index.ts"),
  ]),
);
const shared: BuildOptions = {
  absWorkingDir: repositoryRoot,
  alias: aliases,
  bundle: true,
  logLevel: "info",
  legalComments: "none",
  sourcemap: "linked",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [join(integrationRoot, "src", "main.ts")],
    outfile: join(outputRoot, "main.cjs"),
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["electron"],
  }),
  build({
    ...shared,
    entryPoints: [join(integrationRoot, "src", "preload.ts")],
    outfile: join(outputRoot, "preload.cjs"),
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["electron"],
  }),
  build({
    ...shared,
    entryPoints: [join(integrationRoot, "src", "renderer.ts")],
    outfile: join(outputRoot, "renderer.js"),
    platform: "browser",
    format: "esm",
    target: "es2024",
  }),
  copyFile(join(integrationRoot, "renderer.html"), join(outputRoot, "renderer.html")),
  copyFile(join(integrationRoot, "renderer.css"), join(outputRoot, "renderer.css")),
]);

process.stdout.write(
  `Built Electron/Rust warm authority proof at ${basename(outputRoot)} (${authorityBinaryName}).\n`,
);
