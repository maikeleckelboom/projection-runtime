import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const { output } = JSON.parse(
  readFileSync(join(root, ".cache/electron-rust-resource/latest.json"), "utf8"),
) as { output: string };
const report = join(output, "electron-report.json");
const environment: NodeJS.ProcessEnv = { ...process.env, RESOURCE_PROOF_REPORT: report };
delete environment.ELECTRON_RUN_AS_NODE;
const electron = createRequire(import.meta.url)("electron") as string;
const child = spawn(electron, [join(output, "main.cjs")], {
  cwd: output,
  env: environment,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (b: Buffer) => {
  stdout = (stdout + b.toString()).slice(-1024 * 1024);
});
child.stderr.on("data", (b: Buffer) => {
  stderr = (stderr + b.toString()).slice(-65536);
});
const timer = setTimeout(() => {
  if (child.pid !== undefined) {
    if (process.platform === "win32")
      execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
    else child.kill();
  }
}, 55000);
try {
  const code = await new Promise<number | null>((accept, reject) => {
    child.once("error", reject);
    child.once("exit", accept);
  });
  if (code !== 0) throw new Error(`Resource Electron proof failed (${code})\n${stderr}\n${stdout}`);
  const result = JSON.parse(readFileSync(report, "utf8")) as {
    ok: boolean;
    pid: number;
    pids: number[];
  };
  if (!result.ok) throw new Error("Resource proof did not pass");
  for (const pid of result.pids) {
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {}
    if (alive) throw new Error("Resource authority survived teardown");
  }
  console.log(`Resource Electron proof passed. Evidence: ${resolve(report)}`);
} finally {
  clearTimeout(timer);
}
