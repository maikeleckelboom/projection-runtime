import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const output = join(
  root,
  ".cache/resource-plane-evidence",
  `measure-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
mkdirSync(output, { recursive: true });
const aliases = Object.fromEntries(
  ["base", "resource", "control-plane", "session"].map((n) => [
    `@exclave/${n}`,
    join(root, "packages", n, "src/index.ts"),
  ]),
);
await build({
  entryPoints: [join(root, "packages/resource/src/node/index.ts")],
  outfile: join(output, "process.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  alias: aliases,
});
const { ResourceProcess } = createRequire(import.meta.url)(
  join(output, "process.cjs"),
) as typeof import("../../../packages/resource/src/node/resource-process");
const payload = Buffer.alloc(262144);
for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + (i >>> 8)) & 255;
const wire = Buffer.from(`${JSON.stringify({ payload: payload.toString("base64") })}\n`);
writeFileSync(join(output, "baseline.bin"), wire);
const probe = join(output, process.platform === "win32" ? "baseline.exe" : "baseline");
execFileSync(
  "rustc",
  ["-O", join(root, "integration/electron-rust-resource/scripts/baselineProbe.rs"), "-o", probe],
  { stdio: "inherit" },
);
const baseline = spawn(probe, [join(output, "baseline.bin")], { windowsHide: true });
let pending = "";
const waiters: ((v: { payload: string }) => void)[] = [];
baseline.stdout.on("data", (b: Buffer) => {
  pending += b.toString();
  let end = pending.indexOf("\n");
  while (end !== -1) {
    const value = JSON.parse(pending.slice(0, end)) as { payload: string };
    pending = pending.slice(end + 1);
    const waiter = waiters.shift();
    if (!waiter) throw new Error("baseline correlation");
    waiter(value);
    end = pending.indexOf("\n");
  }
});
const readBaseline = () =>
  new Promise<Buffer>((resolve) => {
    waiters.push((v) => resolve(Buffer.from(v.payload, "base64")));
    baseline.stdin.write("read\n");
  });
const host = new ResourceProcess({
  executablePath: join(
    root,
    "target/release",
    process.platform === "win32" ? "electron-rust-resource.exe" : "electron-rust-resource",
  ),
  authorize: (_client, key) => key === "fixture",
});
const timeout = setTimeout(() => {
  baseline.kill();
  host.terminate();
}, 60000);
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function summary(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return {
    count: s.length,
    medianMs: s[Math.floor(s.length * 0.5)],
    sampleP95Ms: s[Math.floor(s.length * 0.95)],
    maxMs: s.at(-1),
  };
}
try {
  await host.start();
  const client = await host.connect();
  const handle = await host.open(client, "fixture");
  const before = host.diagnostics();
  const pairs: { baselineMs: number; candidateMs: number; first: string }[] = [];
  for (let i = 0; i < 200; i++) {
    let baselineMs = 0;
    let candidateMs = 0;
    for (const which of i % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"]) {
      const started = performance.now();
      const bytes =
        which === "baseline"
          ? await readBaseline()
          : (await host.read(client, handle.handleId, 0n, payload.length).result).payload;
      const elapsed = performance.now() - started;
      if (which === "baseline") baselineMs = elapsed;
      else candidateMs = elapsed;
      check(
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).equals(payload),
        "paired payload mismatch",
      );
    }
    pairs.push({ baselineMs, candidateMs, first: i % 2 === 0 ? "baseline" : "candidate" });
  }
  await host.command("resource.metrics", {});
  const after = host.diagnostics();
  const calibrations = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const reply = await host.command("fixture.control", {}, true);
    const end = performance.now();
    calibrations.push({
      rtt: end - start,
      lowerOffset: start - Number(reply.receivedUs) / 1000,
      upperOffset: end - Number(reply.appliedUs) / 1000,
    });
  }
  const calibration = [...calibrations].sort((a, b) => a.rtt - b.rtt)[0];
  check(calibration, "clock calibration absent");
  const controls = [];
  for (let round = 0; round < 10; round++) {
    host.pauseBulk(true);
    const reads = Array.from(
      { length: 4 },
      () => host.read(client, handle.handleId, 0n, payload.length).result,
    );
    const stallStart = performance.now();
    for (let i = 0; i < 2; i++) {
      const start = performance.now();
      const replyPromise = host.command("fixture.control", {}, true);
      const admitted = performance.now();
      const reply = await replyPromise;
      const observed = performance.now();
      const applied = Number(reply.appliedUs) / 1000;
      const sample = {
        round,
        admissionMs: admitted - start,
        nativeAppliedLowerMs: applied + calibration.lowerOffset - start - 1,
        nativeAppliedUpperMs: applied + calibration.upperOffset - start + 1,
        replyMs: observed - start,
        nativeReceivedUs: reply.receivedUs,
        nativeAppliedUs: reply.appliedUs,
      };
      check(
        sample.admissionMs <= 20 && sample.nativeAppliedUpperMs <= 75 && sample.replyMs <= 75,
        "frozen control budget failed",
      );
      controls.push(sample);
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 150 - (performance.now() - stallStart))),
    );
    host.pauseBulk(false);
    await Promise.all(reads);
  }
  await host.close(client, handle.handleId);
  await host.disconnect(client);
  const retention = [];
  for (let round = 0; round < 8; round++) {
    const a = await host.connect();
    const b = await host.connect();
    const ha = await host.open(a, "fixture");
    const hb = await host.open(b, "fixture");
    let cancelled = 0;
    for (let i = 0; i < 64; i++) {
      const ra = host.read(a, ha.handleId, 0n, payload.length);
      const rb = host.read(b, hb.handleId, 0n, payload.length);
      const discarded = ra.result.catch(() => {
        cancelled++;
        return undefined;
      });
      if (i % 4 === 0) ra.cancel();
      await Promise.all([discarded, rb.result]);
    }
    await host.disconnect(a);
    await host.disconnect(b);
    const native = await host.command("resource.metrics", {});
    check(
      native.inFlightBytes === 0 &&
        native.handles === 0 &&
        native.clients === 0 &&
        native.residentBytes === 2097152,
      "retention did not return to immutable baseline",
    );
    globalThis.gc?.();
    const nativeMemory =
      process.platform === "win32"
        ? JSON.parse(
            execFileSync(
              "powershell",
              [
                "-NoProfile",
                "-Command",
                `Get-Process -Id ${host.pid} | Select-Object WorkingSet64,PrivateMemorySize64,CPU | ConvertTo-Json -Compress`,
              ],
              { encoding: "utf8", windowsHide: true },
            ),
          )
        : null;
    retention.push({
      round,
      completed: 128 - cancelled,
      cancelled,
      native,
      host: host.diagnostics(),
      hostMemory: process.memoryUsage(),
      nativeProcess: nativeMemory,
    });
  }
  const report = {
    nativeExecutableSha256: createHash("sha256")
      .update(
        readFileSync(
          join(
            root,
            "target/release",
            process.platform === "win32" ? "electron-rust-resource.exe" : "electron-rust-resource",
          ),
        ),
      )
      .digest("hex"),
    date: "2026-11-04",
    sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    acceptanceSha256: createHash("sha256")
      .update(readFileSync("docs/evidence/resource-plane/baseline-acceptance.json"))
      .digest("hex"),
    environment: {
      node: process.version,
      os: os.release(),
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
    },
    payloadSha256: createHash("sha256").update(payload).digest("hex"),
    payloadBytes: payload.length,
    baselineWireBytes: wire.length,
    candidateBulkBytes: payload.length + 48,
    wireReductionPercent: 100 * (1 - (payload.length + 48) / wire.length),
    pairedSummary: {
      baseline: summary(pairs.map((p) => p.baselineMs)),
      candidate: summary(pairs.map((p) => p.candidateMs)),
    },
    pairs,
    wireCounters: { before, after },
    clock: {
      calibration,
      calibrations,
      uncertainty:
        "min-RTT offset interval widened by 1 ms for this short same-host run; not audio-clock calibration",
    },
    controls,
    retention,
    limitations: [
      "Resource-shaped immutable fixture, not Dekzer waveform workload",
      "Node-process timings exclude Electron; Electron report is separate and not directly paired to this baseline",
      "No audio callback or acoustic measurement",
      "RSS/working set is observed process memory, not unique application-owned bytes",
      "200 pairs permit sample quantiles, not precise tail guarantees",
    ],
  };
  check(report.wireReductionPercent >= 24, "frozen wire reduction failed");
  writeFileSync(join(output, "measurement.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      path: join(output, "measurement.json"),
      summary: report.pairedSummary,
      controls: controls.length,
      retentionRounds: retention.length,
      wireReductionPercent: report.wireReductionPercent,
    }),
  );
} finally {
  clearTimeout(timeout);
  baseline.stdin.end("quit\n");
  baseline.kill();
  await host.stop();
}
