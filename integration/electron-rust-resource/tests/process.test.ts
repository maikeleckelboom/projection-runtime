import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { MessagePortMain } from "electron";
import { afterEach, describe, expect, it } from "vitest";
import { ResourceProcess } from "../../../packages/resource/src/node/resource-process";
import { attachResourcePort } from "../src/resourceBroker";

const hosts: ResourceProcess[] = [];
async function host(timeout?: number): Promise<ResourceProcess> {
  const h = new ResourceProcess({
    executablePath: join(
      process.cwd(),
      "target",
      "release",
      process.platform === "win32" ? "electron-rust-resource.exe" : "electron-rust-resource",
    ),
    authorize: (_client, key) => key === "fixture",
    ...(timeout === undefined ? {} : { requestTimeoutMs: timeout }),
  });
  hosts.push(h);
  await h.start();
  return h;
}
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.stop()));
});
describe("real Rust resource process", () => {
  it("queues receipts and one client detach under saturation without killing the other client", async () => {
    const h = await host();
    class Port extends EventEmitter {
      postMessage() {}
      start() {}
      close() {
        this.emit("close");
      }
    }
    const detach = await attachResourcePort(h, new Port() as unknown as MessagePortMain);
    const other = await h.connect();
    const handle = await h.open(other, "fixture");
    h.pauseBulk(true);
    const reads = Array.from(
      { length: 4 },
      () => h.read(other, handle.handleId, 0n, 262144).result,
    );
    await h.command("resource.metrics", {});
    h.pauseControl(true);
    const controls = Array.from({ length: 32 }, () => h.command("fixture.control", {}, true));
    h.pauseBulk(false);
    await Promise.all(reads);
    const detached = detach();
    expect(h.alive).toBe(true);
    expect(h.diagnostics().pendingControls).toBe(32);
    h.pauseControl(false);
    await Promise.all(controls);
    await detached;
    expect(h.alive).toBe(true);
    expect((await h.read(other, handle.handleId, 0n, 16).result).payload.length).toBe(16);
    expect((await h.command("resource.metrics", {})).clients).toBe(1);
  });
  it("prioritizes queued visible work without starving admitted background reads", async () => {
    const h = await host();
    const a = await h.connect();
    const b = await h.connect();
    const ha = await h.open(a, "fixture");
    const hb = await h.open(b, "fixture");
    h.pauseBulk(true);
    const completed: number[] = [];
    const jobs = [];
    for (let i = 0; i < 8; i++) {
      const owner = i < 4 ? a : b;
      const handle = i < 4 ? ha : hb;
      const priority = i === 1 || i === 4 ? "background" : "visible";
      jobs.push(
        h.read(owner, handle.handleId, 0n, 262144, priority).result.then(() => {
          completed.push(i);
        }),
      );
    }
    expect((await h.command("resource.metrics", {})).transfers).toBe(8);
    h.pauseBulk(false);
    await Promise.all(jobs);
    expect(completed).toHaveLength(8);
    expect(completed.indexOf(1)).toBeLessThanOrEqual(3);
    expect(completed.indexOf(2)).toBeLessThan(completed.indexOf(1));
    expect(h.diagnostics().inFlight.bytes).toBe(0);
  });
  it("keeps teardown and other invalidation listeners live when one observer throws", async () => {
    const h = await host();
    let observed = 0;
    h.onInvalidated(() => {
      throw new Error("observer ended");
    });
    h.onInvalidated(() => observed++);
    h.terminate();
    await h.stop();
    expect(observed).toBe(1);
  });
  it("reconciles a stalled transfer on the configured deadline", async () => {
    const h = await host(150);
    const c = await h.connect();
    const resource = await h.open(c, "fixture");
    h.pauseBulk(true);
    await expect(h.read(c, resource.handleId, 0n, 262144).result).rejects.toThrow();
    await h.stop();
    expect(h.diagnostics().inFlight.bytes).toBe(0);
  });
  it("can retry close/disconnect after full urgent control admission", async () => {
    const h = await host();
    const c = await h.connect();
    const resource = await h.open(c, "fixture");
    let controls = Array.from({ length: 32 }, () => h.command("fixture.control", {}, true));
    await expect(h.close(c, resource.handleId)).rejects.toThrow();
    await Promise.all(controls);
    expect((await h.command("resource.metrics", {})).handles).toBe(1);
    await h.close(c, resource.handleId);
    expect((await h.command("resource.metrics", {})).handles).toBe(0);
    controls = Array.from({ length: 32 }, () => h.command("fixture.control", {}, true));
    const disconnect = h.disconnect(c);
    await Promise.all(controls);
    await disconnect;
    expect((await h.command("resource.metrics", {})).clients).toBe(0);
  });
  it("delivers exact native bytes, EOF and owned survival after close", async () => {
    const h = await host();
    const c = await h.connect();
    const resource = await h.open(c, "fixture");
    const r = h.read(c, resource.handleId, 0n, 262144);
    await h.close(c, resource.handleId);
    const frame = await r.result;
    expect(createHash("sha256").update(frame.payload).digest("hex")).toBe(
      "582ea324ac01ab8d2ed4a83bf252199a874e9b45c7034859c7428b3c6935796b",
    );
    expect(frame.eof).toBe(false);
    expect(frame.authorityEpoch).toBe(h.authorityEpoch);
    const last = await h.open(c, "fixture");
    const end = await h.read(c, last.handleId, 2097151n, 1).result;
    expect(end.eof).toBe(true);
    expect(h.diagnostics().inFlight.bytes).toBe(0);
  });
  it("preserves B through A cancellation, disconnection and late completion", async () => {
    const h = await host();
    const a = await h.connect();
    const b = await h.connect();
    const ha = await h.open(a, "fixture");
    const hb = await h.open(b, "fixture");
    h.pauseBulk(true);
    const ra = h.read(a, ha.handleId, 0n, 262144);
    const rb = h.read(b, hb.handleId, 0n, 262144);
    const rejected = ra.result.then(
      () => false,
      () => true,
    );
    ra.cancel();
    await h.disconnect(a);
    expect(h.diagnostics().inFlight.bytes).toBe(524288);
    h.pauseBulk(false);
    expect(await rejected).toBe(true);
    expect((await rb.result).payload.length).toBe(262144);
    expect(h.diagnostics().inFlight.bytes).toBe(0);
  });
  it("keeps two control applications/replies live under a stalled bulk pipe", async () => {
    const h = await host();
    const c = await h.connect();
    const resource = await h.open(c, "fixture");
    h.pauseBulk(true);
    const reads = Array.from({ length: 4 }, () => h.read(c, resource.handleId, 0n, 262144).result);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const samples = [];
    for (let i = 0; i < 2; i++) {
      const start = performance.now();
      const reply = await h.command("fixture.control", {}, true);
      samples.push({ ms: performance.now() - start, reply });
    }
    for (const sample of samples) {
      expect(sample.ms).toBeLessThan(75);
      expect(BigInt(sample.reply.appliedUs as string)).toBeGreaterThanOrEqual(
        BigInt(sample.reply.receivedUs as string),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    h.pauseBulk(false);
    await Promise.all(reads);
    expect(h.diagnostics().inFlight.peakBytes).toBe(1048576);
  });
  it("enforces host quotas and denies cross-client or unauthorized reads", async () => {
    const h = await host();
    const a = await h.connect();
    const b = await h.connect();
    const r = await h.open(a, "fixture");
    await expect(h.open(a, "C:/secret")).rejects.toThrow();
    expect(() => h.read(b, r.handleId, 0n, 1)).toThrow();
    h.pauseBulk(true);
    const reads = Array.from({ length: 4 }, () => h.read(a, r.handleId, 0n, 262144).result);
    expect(() => h.read(a, r.handleId, 0n, 1)).toThrow();
    h.pauseBulk(false);
    await Promise.all(reads);
  });
  it("invalidates delivered handles and rejects stale reads after revocation", async () => {
    const h = await host();
    const c = await h.connect();
    const r = await h.open(c, "fixture");
    let invalidations = 0;
    h.onInvalidated(() => invalidations++);
    const bytes = await h.read(c, r.handleId, 0n, 16).result;
    await h.close(c, r.handleId);
    await h.command("fixture.revoke", {}, true);
    expect(invalidations).toBe(1);
    expect(bytes.payload.length).toBe(16);
    await expect(h.open(c, "fixture")).rejects.toBeDefined();
    const m = await h.command("resource.metrics", {});
    expect(m.residentBytes).toBe(0);
  });
  it("settles cancelled in-flight work after authority death and starts a new epoch", async () => {
    const h = await host();
    const c = await h.connect();
    const r = await h.open(c, "fixture");
    h.pauseBulk(true);
    const read = h.read(c, r.handleId, 0n, 262144).result.then(
      () => false,
      () => true,
    );
    h.terminate();
    expect(await read).toBe(true);
    await h.stop();
    expect(h.diagnostics().inFlight.bytes).toBe(0);
    const replacement = await host();
    expect(replacement.authorityEpoch).not.toBe(h.authorityEpoch);
  });
});
