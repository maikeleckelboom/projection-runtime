import { describe, expect, it, vi } from "vitest";
import { ResourceClient } from "../src/resource-client";
import { createOpenResourceReply } from "../src/resource-protocol";

function fixture() {
  const sent: Record<string, unknown>[] = [];
  let throwReceipt = false;
  const client = new ResourceClient((value) => {
    const m = value as Record<string, unknown>;
    if (throwReceipt && m.kind === "receipt") throw new Error("closed sender");
    sent.push(m);
  });
  const handle = createOpenResourceReply({
    handleId: "1",
    authorityEpoch: 7n,
    resourceKind: "opaque",
    resourceKey: "page",
    resourceVersion: 1n,
    descriptor: { byteLength: "16", payloadVersion: 1 },
    capabilities: {
      canReadChunks: true,
      canMapWindows: false,
      totalByteLength: 16n,
      maxChunkBytes: 16,
    },
  });
  async function open() {
    const result = client.open("page");
    client.receive({ kind: "result", id: sent.at(-1)?.id, value: { handle } });
    return result;
  }
  function chunk(id: unknown) {
    return {
      kind: "chunk",
      id,
      payload: new Uint8Array(16),
      authorityEpoch: 7n,
      resourceVersion: 1n,
      offsetBytes: 0n,
      eof: true,
    };
  }
  return {
    client,
    sent,
    open,
    chunk,
    setThrowReceipt: () => {
      throwReceipt = true;
    },
  };
}
describe("owned resource consumer recovery", () => {
  it("does not invalidate or strand an unrelated resource open", async () => {
    const f = fixture();
    const pending = f.open();
    f.client.receive({ kind: "invalidated", resourceKey: "other" });
    const handle = await pending;
    expect(handle.resourceKey).toBe("page");
    const close = f.client.close(handle);
    f.client.receive({ kind: "result", id: f.sent.at(-1)?.id, value: {} });
    await close;
    f.client.dispose();
  });
  it("validates ordinary descriptors in sandboxed contexts without SharedArrayBuffer", async () => {
    vi.stubGlobal("SharedArrayBuffer", undefined);
    try {
      const f = fixture();
      expect((await f.open()).resourceKey).toBe("page");
      f.client.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("does not revive an open whose response races with invalidation", async () => {
    const f = fixture();
    const pending = f.open();
    f.client.receive({ kind: "invalidated", resourceKey: "page" });
    await expect(pending).rejects.toThrow();
    f.client.dispose();
  });
  it.each([
    "length",
    "kind",
    "receipt",
  ])("settles current read on invalid %s without hanging", async (mode) => {
    const f = fixture();
    const h = await f.open();
    const result = f.client.read(h, 0n, 16);
    const rejected = result.then(
      () => false,
      () => true,
    );
    const message = f.chunk(f.sent.at(-1)?.id);
    if (mode === "length") message.payload = new Uint8Array(15);
    if (mode === "kind") message.kind = "unexpected";
    if (mode === "receipt") f.setThrowReceipt();
    expect(() => f.client.receive(message)).toThrow();
    expect(await rejected).toBe(true);
    expect(f.client.diagnostics().bytes).toBe(0);
    expect(f.sent.at(-1)?.kind).toBe("disconnect");
  });
  it("retains cancellation credit until the late result is discarded", async () => {
    const f = fixture();
    const h = await f.open();
    const abort = new AbortController();
    const result = f.client.read(h, 0n, 16, { signal: abort.signal });
    const id = f.sent.at(-1)?.id;
    const rejected = result.then(
      () => false,
      () => true,
    );
    abort.abort();
    expect(await rejected).toBe(true);
    expect(f.client.diagnostics().bytes).toBe(16);
    f.client.receive(f.chunk(id));
    expect(f.client.diagnostics().bytes).toBe(0);
    expect(f.client.diagnostics().duplicateSettlements).toBe(0);
    f.client.dispose();
  });
  it("keeps owned bytes resident after close and invalidates after revoke", async () => {
    const f = fixture();
    const h = await f.open();
    const result = f.client.read(h, 0n, 16);
    f.client.receive(f.chunk(f.sent.at(-1)?.id));
    const owned = await result;
    const close = f.client.close(h);
    f.client.receive({ kind: "result", id: f.sent.at(-1)?.id, value: {} });
    await close;
    expect(owned.valid()).toBe(true);
    expect(f.client.diagnostics().bytes).toBe(16);
    f.client.receive({ kind: "invalidated", resourceKey: "page" });
    expect(owned.valid()).toBe(false);
    expect(owned.payload.byteLength).toBe(16);
    owned.release();
    owned.release();
    expect(f.client.diagnostics().bytes).toBe(0);
    f.client.dispose();
  });
  it("supersedes only matching intent while preserving other consumer reads", async () => {
    const f = fixture();
    const h = await f.open();
    const old = f.client.read(h, 0n, 16, { replaceKey: "A" });
    const oldId = f.sent.at(-1)?.id;
    const discarded = old.then(
      () => false,
      () => true,
    );
    const b = f.client.read(h, 0n, 16, { replaceKey: "B" });
    const bId = f.sent.at(-1)?.id;
    const current = f.client.read(h, 0n, 16, { replaceKey: "A" });
    const currentId = f.sent.at(-1)?.id;
    expect(await discarded).toBe(true);
    expect(f.client.diagnostics().bytes).toBe(48);
    f.client.receive(f.chunk(oldId));
    f.client.receive(f.chunk(bId));
    f.client.receive(f.chunk(currentId));
    (await b).release();
    (await current).release();
    expect(f.client.diagnostics().bytes).toBe(0);
    f.client.dispose();
  });
  it("can retry close after local request capacity rejects admission", async () => {
    const f = fixture();
    const h = await f.open();
    const pending = Array.from({ length: 24 }, () => f.client.open("page").catch(() => undefined));
    await expect(f.client.close(h)).rejects.toThrow();
    const opens = f.sent.filter((m) => m.kind === "open").slice(1);
    for (const message of opens)
      f.client.receive({ kind: "error", id: message.id, failure: { kind: "resourceUnavailable" } });
    await Promise.all(pending);
    const close = f.client.close(h);
    f.client.receive({ kind: "result", id: f.sent.at(-1)?.id, value: {} });
    await close;
    f.client.dispose();
  });
});
