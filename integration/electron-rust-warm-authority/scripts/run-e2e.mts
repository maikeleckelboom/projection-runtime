import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RESULT_PREFIX = "EXCLAVE_ELECTRON_RUST_WARM_RESULT ";
const AUTHORITY_PID_PREFIX = "EXCLAVE_ELECTRON_RUST_WARM_AUTHORITY_PID ";
const MAX_CAPTURE_BYTES = 1024 * 1024;
const integrationRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = resolve(integrationRoot, "../..");
const outputRoot = join(repositoryRoot, ".cache", "electron-rust-warm-authority");
const mainPath = join(outputRoot, "main.cjs");
const require = createRequire(import.meta.url);
const electronPath = require("electron") as string;

if (!existsSync(mainPath)) {
  throw new Error("Electron integration is not built; run the integration build first");
}

const environment: NodeJS.ProcessEnv = {
  ...process.env,
  EXCLAVE_ELECTRON_RUST_WARM_E2E: "1",
};
delete environment.ELECTRON_RUN_AS_NODE;

let child: ChildProcessWithoutNullStreams | null = null;
let exited = false;
let stdout = "";
let stderr = "";

try {
  child = spawn(electronPath, [mainPath], {
    cwd: outputRoot,
    env: environment,
    detached: process.platform !== "win32",
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = appendBounded(stdout, chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = appendBounded(stderr, chunk.toString("utf8"));
  });

  const result = await waitForExit(child, 60_000);
  exited = true;
  if (result.code !== 0) {
    throw new Error(
      `Electron proof exited with code ${String(result.code)} and signal ${String(result.signal)}\n${stderr}\n${stdout}`,
    );
  }

  const resultLines = stdout.split(/\r?\n/u).filter((line) => line.startsWith(RESULT_PREFIX));
  if (resultLines.length !== 1) {
    throw new Error(`expected exactly one result line, received ${resultLines.length}\n${stdout}`);
  }
  const encodedResult = resultLines[0]?.slice(RESULT_PREFIX.length);
  if (encodedResult === undefined) throw new Error("Electron result payload is missing");
  const report = parseReport(JSON.parse(encodedResult) as unknown);
  for (const pid of report.authorityPids) {
    if (isProcessAlive(pid)) throw new Error(`authority child process ${pid} remained alive`);
  }

  process.stdout.write(
    `Electron/Rust warm proof passed: epochs ${report.authorityEpochs.join(" -> ")}, ` +
      `coalesced ${report.diagnostics.upstreamCoalescedPublicationCount}/${report.diagnostics.downstreamCoalescedPublicationCount}, ` +
      `reload preserved the replacement authority.\n`,
  );
} finally {
  if (child !== null && !exited && child.pid !== undefined) terminateProcessTree(child.pid);
  for (const pid of reportedAuthorityPids(stdout)) {
    if (isProcessAlive(pid)) terminateProcessTree(pid);
  }
}

type ProofReport = {
  readonly authorityEpochs: readonly [string, string];
  readonly authorityPids: readonly [number, number];
  readonly diagnostics: {
    readonly upstreamCoalescedPublicationCount: number;
    readonly downstreamCoalescedPublicationCount: number;
    readonly skippedPublicationCount: number;
  };
};

function parseReport(value: unknown): ProofReport {
  const report = record(value, "result");
  if (report.ok !== true) {
    throw new Error(`Electron proof reported failure: ${String(report.error ?? "unknown")}`);
  }
  const authorityEpochs = tuple(report.authorityEpochs, "authorityEpochs", canonicalEpoch);
  if (authorityEpochs[0] !== "101" || authorityEpochs[1] !== "202") {
    throw new Error(`deterministic authority epochs were not 101 -> 202`);
  }
  const authorityPids = tuple(report.authorityPids, "authorityPids", positiveInteger);
  if (authorityPids[0] === authorityPids[1]) {
    throw new Error("authority restart reused the original process id");
  }
  if (
    typeof report.replacementReadyToExplicitSubscribeMs !== "number" ||
    report.replacementReadyToExplicitSubscribeMs < 150
  ) {
    throw new Error("no-auto-resubscribe observation window was not proved");
  }
  if (report.controlTempoRatio !== 1.25) throw new Error("typed tempo result was not 1.25");
  if (report.startupOrderingProved !== true) {
    throw new Error("authority starting/ready ordering was not proved");
  }
  if (report.preReadySubscriptionRejected !== true) {
    throw new Error("real pre-ready subscription was not rejected by the Rust authority");
  }
  if (report.staleEpochControlRejected !== true) {
    throw new Error("replacement authority did not reject the old-epoch control probe");
  }
  const subscriptions = record(report.subscriptions, "subscriptions");
  for (const key of [
    "initialBaselineEstablished",
    "replacementRebased",
    "reloadBaselineEstablished",
  ]) {
    if (subscriptions[key] !== true) throw new Error(`subscription proof ${key} was not true`);
  }
  if (
    subscriptions.initialContinuityGeneration !== 1 ||
    subscriptions.replacementContinuityGeneration !== 2
  ) {
    throw new Error("authority restart did not prove continuity generation 1 -> 2");
  }

  const reload = record(report.reload, "reload");
  for (const key of [
    "authoritySurvived",
    "rendererClientReplaced",
    "oldSubscriptionClosed",
    "samplePositionAdvanced",
    "publicationSequenceAdvanced",
  ]) {
    if (reload[key] !== true) throw new Error(`reload proof ${key} was not true`);
  }

  const diagnostics = record(report.diagnostics, "diagnostics");
  for (const key of [
    "maxUpstreamInFlightCount",
    "maxUpstreamPendingCount",
    "maxDownstreamInFlightCount",
    "maxDownstreamPendingCount",
  ]) {
    if (diagnostics[key] !== 1) throw new Error(`diagnostic ${key} was not exactly one`);
  }
  const upstreamCoalescedPublicationCount = positiveInteger(
    diagnostics.upstreamCoalescedPublicationCount,
    "upstreamCoalescedPublicationCount",
  );
  const downstreamCoalescedPublicationCount = positiveInteger(
    diagnostics.downstreamCoalescedPublicationCount,
    "downstreamCoalescedPublicationCount",
  );
  const skippedPublicationCount = positiveInteger(
    diagnostics.skippedPublicationCount,
    "skippedPublicationCount",
  );
  if (typeof diagnostics.latestDeliveredPublicationSequence !== "string") {
    throw new Error("latest delivered publication sequence is missing");
  }

  const shutdown = record(report.shutdown, "shutdown");
  if (
    shutdown.authorityProcessStopped !== true ||
    shutdown.cleanExit !== true ||
    shutdown.exitCode !== 0
  ) {
    throw new Error("authority process did not stop with a clean zero exit");
  }

  return {
    authorityEpochs,
    authorityPids,
    diagnostics: {
      upstreamCoalescedPublicationCount,
      downstreamCoalescedPublicationCount,
      skippedPublicationCount,
    },
  };
}

function waitForExit(
  process: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error("Electron proof timed out")), timeoutMs);
    process.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    process.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolvePromise({ code, signal });
    });
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function tuple<T>(
  value: unknown,
  label: string,
  parse: (item: unknown, label: string) => T,
): readonly [T, T] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new TypeError(`${label} must contain exactly two items`);
  }
  return [parse(value[0], `${label}[0]`), parse(value[1], `${label}[1]`)];
}

function canonicalEpoch(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new TypeError(`${label} must be a canonical nonzero epoch`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function appendBounded(current: string, next: string): string {
  const combined = `${current}${next}`;
  return combined.length <= MAX_CAPTURE_BYTES
    ? combined
    : combined.slice(combined.length - MAX_CAPTURE_BYTES);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function reportedAuthorityPids(output: string): readonly number[] {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/u)) {
    if (!line.startsWith(AUTHORITY_PID_PREFIX)) continue;
    const pid = Number(line.slice(AUTHORITY_PID_PREFIX.length));
    if (Number.isSafeInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

function terminateProcessTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process already exited while the timeout cleanup was starting.
    }
  }
}
