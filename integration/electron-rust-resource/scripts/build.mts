import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const integration = fileURLToPath(new URL("..", import.meta.url));
const root = resolve(integration, "../..");
const output = join(
  root,
  ".cache",
  "electron-rust-resource",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(join(output, "bin"), { recursive: true });
execFileSync("cargo", ["build", "--release", "--locked", "-p", "electron-rust-resource"], {
  cwd: root,
  stdio: "inherit",
});
const metadata = JSON.parse(
  execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
    cwd: root,
    encoding: "utf8",
  }),
) as { target_directory: string };
const executable =
  process.platform === "win32" ? "electron-rust-resource.exe" : "electron-rust-resource";
await copyFile(
  join(metadata.target_directory, "release", executable),
  join(output, "bin", executable),
);
const alias = Object.fromEntries(
  ["base", "session", "control-plane", "resource"].map((name) => [
    `@exclave/${name}`,
    join(root, "packages", name, "src", "index.ts"),
  ]),
);
for (const name of ["main", "preload", "renderer", "worker"]) {
  const node = name === "main" || name === "preload";
  await build({
    entryPoints: [join(integration, "src", `${name}.ts`)],
    outfile: join(output, `${name}.${node ? "cjs" : "js"}`),
    bundle: true,
    minify: true,
    sourcemap: true,
    platform: node ? "node" : "browser",
    format: node ? "cjs" : "esm",
    target: node ? "node24" : "es2024",
    external: node ? ["electron"] : [],
    alias,
  });
}
for (const file of ["renderer.html", "renderer.css"])
  await copyFile(join(integration, file), join(output, file));
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const files = [
  "main.cjs",
  "preload.cjs",
  "renderer.js",
  "worker.js",
  "renderer.html",
  "renderer.css",
  `bin/${executable}`,
];
await writeFile(
  join(output, "build-manifest.json"),
  `${JSON.stringify(
    {
      sourceRevision,
      node: process.version,
      files: files.map((path) => ({
        path,
        sha256: createHash("sha256")
          .update(readFileSync(join(output, path)))
          .digest("hex"),
      })),
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  join(root, ".cache", "electron-rust-resource", "latest.json"),
  `${JSON.stringify({
    output,
    sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
  })}\n`,
);
console.log(`Built resource proof: ${output}`);
