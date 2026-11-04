import { ResourceClient } from "@exclave/resource";

declare global {
  interface Window {
    resourceProof: { checkpoint: (value: unknown) => Promise<unknown> };
  }
}
const status = document.querySelector<HTMLParagraphElement>("#status");
const results = document.querySelector<HTMLPreElement>("#results");
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
let attached = false;
window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.data?.kind !== "resourcePort" ||
    event.data.version !== 1 ||
    event.ports.length !== 1 ||
    attached
  )
    return;
  attached = true;
  const port = event.ports[0];
  check(port, "port absent");
  const client = new ResourceClient((message) => port.postMessage(message));
  port.onmessage = (message) => {
    try {
      client.receive(message.data);
    } catch (error) {
      void fail(error);
    }
  };
  port.start();
  void run(client).catch(fail);
});
async function fail(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  if (status) status.textContent = `Verification failed: ${message}`;
  await window.resourceProof.checkpoint({ kind: "failure", message });
}
async function hash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function run(client: ResourceClient): Promise<void> {
  const nodeAbsent = !("require" in window) && !("process" in window);
  check(nodeAbsent, "Node is exposed to renderer");
  const phase = sessionStorage.getItem("resourcePhase") ?? "initial";
  const handle = await client.open("fixture");
  const owned = await client.read(handle, 0n, 262144);
  await client.close(handle);
  const expected = "582ea324ac01ab8d2ed4a83bf252199a874e9b45c7034859c7428b3c6935796b";
  check(
    owned.valid() && (await hash(owned.payload)) === expected,
    "owned bytes changed after normal close",
  );
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  const workerResult = new Promise<{ hash: string; length: number }>((resolve, reject) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.onerror = (e) => reject(new Error(e.message));
  });
  worker.postMessage({ id: 1, payload: owned.payload }, [owned.payload.buffer]);
  check(owned.payload.byteLength === 0, "worker transfer did not detach exclusive sender buffer");
  const digest = await workerResult;
  check(digest.hash === expected && digest.length === 262144, "worker byte mismatch");
  worker.terminate();
  owned.release();
  if (phase === "initial") {
    const a = await client.open("fixture");
    const b = await client.open("fixture");
    const abort = new AbortController();
    const cancelled = client.read(a, 0n, 262144, { signal: abort.signal }).then(
      () => false,
      () => true,
    );
    abort.abort();
    const kept = await client.read(b, 0n, 262144);
    check(await cancelled, "A intent did not cancel");
    check((await hash(kept.payload)) === expected, "A cancellation corrupted B");
    kept.release();
    await client.close(a);
    await client.close(b);
    const samples: number[] = [];
    const benchmark = await client.open("fixture");
    for (let i = 0; i < 120; i++) {
      const start = performance.now();
      const chunk = await client.read(benchmark, 0n, 262144);
      check(chunk.payload[513] === 33, "fixture content mismatch");
      samples.push(performance.now() - start);
      chunk.release();
    }
    await client.close(benchmark);
    const interrupted = await client.open("fixture");
    await window.resourceProof.checkpoint({ kind: "pauseBulk" });
    void client.read(interrupted, 0n, 262144).catch(() => undefined);
    void client.read(interrupted, 262144n, 262144).catch(() => undefined);
    sessionStorage.setItem("resourcePhase", "reloaded");
    await window.resourceProof.checkpoint({
      kind: "reload",
      samplesMs: samples,
      nodeAbsent,
      workerDetached: true,
      ownedAfterClose: true,
      sharedCancellation: true,
      resident: client.diagnostics(),
      epoch: handle.authorityEpoch.toString(),
    });
  } else if (phase === "reloaded") {
    const native = await client.open("fixture");
    const held = await client.read(native, 0n, 1024);
    await client.close(native);
    await window.resourceProof.checkpoint({ kind: "crash" });
    const deadline = performance.now() + 2000;
    while (held.valid() && performance.now() < deadline)
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    check(!held.valid(), "native death did not fence owned bytes");
    check(held.payload.length === 1024, "native death erased owned allocation");
    held.release();
    sessionStorage.setItem("resourcePhase", "recovered");
    await window.resourceProof.checkpoint({
      kind: "restart",
      oldEpoch: handle.authorityEpoch.toString(),
      nativeDeath: true,
      resident: client.diagnostics(),
    });
  } else {
    const native = await client.open("fixture");
    const held = await client.read(native, 0n, 1024);
    await client.close(native);
    await window.resourceProof.checkpoint({ kind: "revoke" });
    const deadline = performance.now() + 2000;
    while (held.valid() && performance.now() < deadline)
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    check(!held.valid(), "revocation did not fence an owned result after handle close");
    held.release();
    const rejected = await client.open("fixture").then(
      () => false,
      () => true,
    );
    check(rejected, "revoked resource reopened");
    check(status && results, "verification result elements are absent");
    await window.resourceProof.checkpoint({ kind: "presentResults" });
    status.textContent =
      "Native bytes, worker transfer, cancellation, reload and revocation passed.";
    const report = {
      kind: "complete",
      nodeAbsent,
      workerDetached: true,
      ownedAfterClose: true,
      reloadEpoch: handle.authorityEpoch.toString(),
      revocation: true,
      resident: client.diagnostics(),
    };
    results.textContent = JSON.stringify(report, null, 2);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await window.resourceProof.checkpoint(report);
  }
}
