import { createResourceError, throwInputRejected, throwResourceBackpressure } from "./errors";
import { ResourceBudget, type ResourceBudgetSnapshot } from "./resource-budget";
import { createOpenResourceReply, validateReadResourceChunkRequest } from "./resource-protocol";
import {
  type OpaqueResourceHandle,
  resourceRecord,
  resourceString,
  resourceU64,
} from "./resource-wire-values";

export type OwnedResourceChunk = {
  readonly ownership: "owned";
  readonly payload: Uint8Array<ArrayBuffer>;
  readonly offsetBytes: bigint;
  readonly eof: boolean;
  /** Authorization validity, independent of normal handle close or buffer lifetime. */
  readonly valid: () => boolean;
  /** Releases this owner's resident reservation. All retained aliases must be dropped. */
  readonly release: () => void;
};
export type ResourceReadOptions = {
  readonly signal?: AbortSignal;
  readonly priority?: "visible" | "background";
  readonly replaceKey?: string;
};
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  operation: string;
  read?: {
    handle: OpaqueResourceHandle;
    offset: bigint;
    length: number;
    cancelled: boolean;
    removeAbort: () => void;
    replaceKey?: string;
  };
};
type Resident = { key: string; version: bigint; valid: boolean };

/** Sandboxed consumer. The supplied send function has one private, host-bound port.
 * Runtime-owned resident bytes are bounded independently of transport receipts.
 */
export class ResourceClient {
  private readonly send: (message: unknown) => void;
  private readonly pending = new Map<string, Pending>();
  private readonly handles = new Map<string, OpaqueResourceHandle>();
  private readonly closing = new Set<string>();
  private readonly retained = new Map<string, Resident>();
  private readonly resident = new ResourceBudget({
    bytes: 2 * 1024 * 1024,
    items: 16,
    clientBytes: 2 * 1024 * 1024,
    clientItems: 16,
  });
  private sequence = 1;
  private closed = false;
  private readonly opening = new Set<{ key: string; invalidated: boolean }>();

  constructor(send: (message: unknown) => void) {
    this.send = send;
  }

  async open(resourceKey: string): Promise<OpaqueResourceHandle> {
    resourceString(resourceKey);
    const opening = { key: resourceKey, invalidated: false };
    this.opening.add(opening);
    let result: Record<string, unknown>;
    try {
      result = resourceRecord(await this.request("open", { resourceKey }));
    } finally {
      this.opening.delete(opening);
    }
    if (this.closed || opening.invalidated) throwInputRejected("resource open was invalidated");
    // Host sends the existing, validated bigint ResourceHandle contract over structured clone.
    const handle = createOpenResourceReply(result.handle as OpaqueResourceHandle);
    if (
      handle === undefined ||
      typeof handle.authorityEpoch !== "bigint" ||
      typeof handle.resourceVersion !== "bigint" ||
      handle.resourceKey !== resourceKey ||
      handle.capabilities?.canMapWindows !== false ||
      handle.capabilities.canReadChunks !== true
    )
      throwInputRejected("resource client handle invalid");
    resourceString(handle.handleId);
    resourceU64(handle.descriptor.byteLength);
    this.handles.set(handle.handleId, handle);
    return handle;
  }
  read(
    handle: OpaqueResourceHandle,
    offset: bigint,
    length: number,
    options: ResourceReadOptions = {},
  ): Promise<OwnedResourceChunk> {
    if (this.handles.get(handle.handleId) !== handle || this.closing.has(handle.handleId))
      throwInputRejected("resource client handle closed");
    if (
      validateReadResourceChunkRequest(
        {
          handleId: handle.handleId,
          authorityEpoch: handle.authorityEpoch,
          offsetBytes: offset,
          lengthBytes: length,
        },
        handle,
      ) !== null
    )
      throwInputRejected("resource client range invalid");
    if (options.signal?.aborted)
      return Promise.reject(
        createResourceError("inputRejected", { detail: "resource intent cancelled" }),
      );
    if (options.replaceKey !== undefined) {
      resourceString(options.replaceKey);
      for (const [previous, p] of this.pending)
        if (p.read?.replaceKey === options.replaceKey) {
          p.read.cancelled = true;
          p.reject(createResourceError("inputRejected", { detail: "resource intent superseded" }));
          try {
            this.send({ kind: "cancel", id: previous });
          } catch {
            this.dispose();
          }
        }
    }
    const id = String(this.sequence++);
    if (!this.resident.reserve(id, "consumer", length)) throwResourceBackpressure("consumer");
    const abort = () => {
      const p = this.pending.get(id);
      if (p?.read !== undefined) {
        p.read.cancelled = true;
        p.reject(createResourceError("inputRejected", { detail: "resource intent cancelled" }));
        try {
          this.send({ kind: "cancel", id });
        } catch {
          this.dispose();
        }
      }
    };
    const read: NonNullable<Pending["read"]> = {
      handle,
      offset,
      length,
      cancelled: false,
      removeAbort: () => options.signal?.removeEventListener("abort", abort),
      ...(options.replaceKey === undefined ? {} : { replaceKey: options.replaceKey }),
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const result = this.request(
      "read",
      {
        handleId: handle.handleId,
        offsetBytes: offset.toString(),
        lengthBytes: length,
        priority: options.priority ?? "visible",
      },
      id,
      read,
    );
    return result as Promise<OwnedResourceChunk>;
  }
  async close(handle: OpaqueResourceHandle): Promise<void> {
    if (!this.handles.has(handle.handleId)) return;
    if (this.closing.has(handle.handleId)) throwInputRejected("resource handle already closing");
    this.closing.add(handle.handleId);
    try {
      await this.request("close", { handleId: handle.handleId });
      this.handles.delete(handle.handleId);
    } finally {
      this.closing.delete(handle.handleId);
    }
  }
  receive(value: unknown): void {
    if (this.closed) return;
    try {
      const m = resourceRecord(value);
      if (m.kind === "invalidated") {
        const key = m.resourceKey;
        for (const opening of this.opening)
          if (key === undefined || opening.key === key) opening.invalidated = true;
        for (const [id, h] of this.handles)
          if (key === undefined || h.resourceKey === key) this.handles.delete(id);
        for (const r of this.retained.values())
          if (key === undefined || r.key === key) r.valid = false;
        for (const p of this.pending.values())
          if (p.read !== undefined && (key === undefined || p.read.handle.resourceKey === key))
            p.read.cancelled = true;
        if (key === undefined) this.dispose();
        return;
      }
      const id = resourceString(m.id);
      const p = this.pending.get(id);
      if (p === undefined) throwInputRejected("uncorrelated resource client response");
      if (m.kind !== "error" && m.kind !== (p.read === undefined ? "result" : "chunk"))
        throwInputRejected("resource response kind does not match operation");
      if (p.read !== undefined) {
        const read = p.read;
        if (m.kind === "chunk") {
          const payload = m.payload;
          if (
            !(payload instanceof Uint8Array) ||
            !(payload.buffer instanceof ArrayBuffer) ||
            payload.byteOffset !== 0 ||
            payload.byteLength !== read.length ||
            payload.buffer.byteLength !== read.length ||
            m.authorityEpoch !== read.handle.authorityEpoch ||
            m.resourceVersion !== read.handle.resourceVersion ||
            m.offsetBytes !== read.offset ||
            m.eof !==
              (read.offset + BigInt(read.length) === BigInt(read.handle.descriptor.byteLength))
          )
            throwInputRejected("resource client chunk identity/length");
          // Resident reservation was made before submission. Now the queue may release credit.
          this.send({ kind: "receipt", id });
          this.complete(id, p);
          if (read.cancelled) {
            this.resident.settle(id);
            p.reject(createResourceError("inputRejected", { detail: "resource intent expired" }));
            return;
          }
          const state: Resident = {
            key: read.handle.resourceKey,
            version: read.handle.resourceVersion,
            valid: true,
          };
          this.retained.set(id, state);
          let released = false;
          const chunk: OwnedResourceChunk = {
            ownership: "owned",
            payload: payload as Uint8Array<ArrayBuffer>,
            offsetBytes: read.offset,
            eof: m.eof as boolean,
            valid: () => !released && state.valid,
            release: () => {
              if (released) return;
              released = true;
              this.retained.delete(id);
              this.resident.settle(id);
            },
          };
          p.resolve(chunk);
          return;
        }
        this.resident.settle(id);
      }
      this.complete(id, p);
      if (m.kind === "error") p.reject(m.failure);
      else if (m.kind === "result") p.resolve(m.value);
      else throwInputRejected("resource client response kind");
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  diagnostics(): ResourceBudgetSnapshot {
    return this.resident.snapshot();
  }
  private complete(id: string, p: Pending): void {
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.read?.removeAbort();
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.send({ kind: "disconnect" });
    } catch {
      /* The physical transport may already be closed. */
    }
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.read?.removeAbort();
      if (p.read !== undefined) this.resident.settle(id);
      p.reject(createResourceError("inputRejected", { detail: "resource consumer ended" }));
    }
    this.pending.clear();
    this.handles.clear();
    // Owned delivered allocations survive until their owner releases them.
    for (const r of this.retained.values()) r.valid = false;
  }
  private request(
    operation: string,
    payload: Record<string, unknown>,
    id = String(this.sequence++),
    read?: Pending["read"],
  ): Promise<unknown> {
    if (this.closed || this.pending.size >= 24) {
      if (read !== undefined) {
        read.removeAbort();
        this.resident.settle(id);
      }
      return Promise.reject(
        createResourceError("inputRejected", { detail: "resource consumer closed/capacity" }),
      );
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose(), 5000);
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        operation,
        ...(read === undefined ? {} : { read }),
      });
      try {
        this.send({ kind: operation, id, ...payload });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        if (read !== undefined) {
          read.removeAbort();
          this.resident.settle(id);
        }
        reject(error);
      }
    });
  }
}
