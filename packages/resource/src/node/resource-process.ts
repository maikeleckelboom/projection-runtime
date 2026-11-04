import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { isExclaveError, type JsonObject } from "@exclave/base";
import {
  createControlRequestEnvelope,
  validateControlResponseEnvelope,
} from "@exclave/control-plane";
import { createResourceError, throwInputRejected, throwResourceBackpressure } from "../errors";
import { ResourceBudget, type ResourceBudgetSnapshot } from "../resource-budget";
import { validateReadResourceChunkRequest } from "../resource-protocol";
import {
  type ResourceFrame,
  ResourceFrameDecoder,
  type ResourceFrameHeader,
} from "../resource-wire";
import {
  decodeOpaqueResourceHandle,
  type OpaqueResourceHandle,
  resourceRecord,
  resourceString,
  resourceU64,
} from "../resource-wire-values";

export type ResourceProcessOptions = {
  readonly executablePath: string;
  /** Product-owned source authorization. Never pass renderer-selected file paths. */
  readonly authorize: (client: string, resourceKey: string) => boolean;
  readonly requestTimeoutMs?: number;
};
export type ResourceInvalidation = {
  readonly authorityEpoch: bigint;
  readonly resourceKey?: string;
  readonly resourceVersion?: bigint;
  readonly reason: "revoked" | "authorityUnavailable";
};
type PendingControl = {
  resolve: (value: JsonObject) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
  urgent: boolean;
};
type PendingRead = {
  client: string;
  handle: OpaqueResourceHandle;
  offset: bigint;
  length: number;
  resolve: (frame: ResourceFrame) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
  cancelled: boolean;
  priority: "visible" | "background";
};

/** Concrete private stdio profile: stdout metadata, stderr binary. No warm lane.
 * Returned buffers are owned by the caller; caller must separately budget retention.
 */
export class ResourceProcess {
  private readonly options: ResourceProcessOptions;
  private child: ChildProcessWithoutNullStreams | undefined;
  private epochValue = 0n;
  private nextRequest = 1;
  private nextClient = 1;
  private nextTransfer = 1n;
  private failed = false;
  private readonly opening = new Set<{ key: string; invalidated: boolean }>();
  private stdout = "";
  private controlInputBytes = 0;
  private controlOutputBytes = 0;
  private bulkInputBytes = 0;
  private readonly pending = new Map<string, PendingControl>();
  private readonly clients = new Set<string>();
  private readonly disconnecting = new Set<string>();
  private readonly closing = new Set<string>();
  private readonly handles = new Map<string, { client: string; handle: OpaqueResourceHandle }>();
  private readonly reads = new Map<bigint, PendingRead>();
  private readonly listeners = new Set<(event: ResourceInvalidation) => void>();
  private readonly controlCapacityWaiters = new Set<() => void>();
  private readonly inFlight = new ResourceBudget({
    bytes: 2 * 1024 * 1024,
    items: 8,
    clientBytes: 1024 * 1024,
    clientItems: 4,
  });
  private readonly decoder: ResourceFrameDecoder;
  private readyResolve: (() => void) | undefined;
  private readyReject: ((reason: unknown) => void) | undefined;
  private closedResolve: (() => void) | undefined;
  private readonly closed: Promise<void>;

  constructor(options: ResourceProcessOptions) {
    this.options = options;
    if (
      options.requestTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.requestTimeoutMs) ||
        options.requestTimeoutMs < 50 ||
        options.requestTimeoutMs > 30000)
    )
      throwInputRejected("invalid resource deadline");
    this.closed = new Promise((resolve) => {
      this.closedResolve = resolve;
    });
    this.decoder = new ResourceFrameDecoder(
      (h) => this.admit(h),
      (f) => this.receive(f),
    );
  }
  get authorityEpoch(): bigint {
    return this.epochValue;
  }
  get pid(): number | undefined {
    return this.child?.pid;
  }
  get alive(): boolean {
    return this.child !== undefined && !this.failed;
  }

  async start(): Promise<void> {
    if (this.child !== undefined) throwInputRejected("resource authority already started");
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    const timer = setTimeout(() => this.fail("resource authority startup timeout"), this.timeout);
    const child = spawn(this.options.executablePath, [], {
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.controlOutputBytes += Buffer.byteLength(chunk);
      try {
        this.receiveControl(chunk);
      } catch {
        this.fail("invalid resource control output");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.bulkInputBytes += chunk.length;
      if (this.failed) return;
      try {
        this.decoder.push(chunk);
      } catch {
        this.fail("invalid resource binary output");
      }
    });
    child.stderr.on("end", () => {
      try {
        this.decoder.finish();
      } catch {
        this.fail("truncated resource binary output");
      }
    });
    child.stdout.on("end", () => {
      if (this.stdout.length !== 0) this.fail("truncated resource control output");
    });
    child.stdin.on("error", () => this.fail("resource input failed"));
    child.on("error", () => this.fail("resource process failed"));
    child.on("close", () => {
      this.fail("resource authority ended");
      for (const id of this.reads.keys()) this.inFlight.settle(String(id));
      this.reads.clear();
      this.closedResolve?.();
    });
    try {
      await ready;
      await this.command("resource.negotiate", { protocolVersion: 1 });
    } finally {
      clearTimeout(timer);
    }
  }
  onInvalidated(listener: (event: ResourceInvalidation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<string> {
    if (this.clients.size >= 2) throwResourceBackpressure("authority");
    const client = String(this.nextClient++);
    this.clients.add(client);
    try {
      await this.command("resource.connect", { client });
      return client;
    } catch (error) {
      this.clients.delete(client);
      throw error;
    }
  }
  async open(client: string, key: string): Promise<OpaqueResourceHandle> {
    this.requireClient(client);
    resourceString(key);
    if (!this.options.authorize(client, key)) throwInputRejected("resource authorization denied");
    const opening = { key, invalidated: false };
    this.opening.add(opening);
    let value: JsonObject;
    try {
      value = await this.command("resource.open", { client, resourceKey: key });
    } finally {
      this.opening.delete(opening);
    }
    const handle = decodeOpaqueResourceHandle(value);
    if (handle.authorityEpoch !== this.epochValue || handle.resourceKey !== key) {
      this.fail("resource open identity mismatch");
      throwInputRejected("resource open identity mismatch");
    }
    if (!this.clients.has(client) || this.disconnecting.has(client) || opening.invalidated) {
      await this.command(
        "resource.closeHandle",
        { client, authorityEpoch: this.epochValue.toString(), handleId: handle.handleId },
        true,
      ).catch(() => undefined);
      throwInputRejected("resource client ended during open");
    }
    this.handles.set(handle.handleId, { client, handle });
    return handle;
  }
  read(
    client: string,
    handleId: string,
    offset: bigint,
    length: number,
    priority: "visible" | "background" = "visible",
  ): { readonly id: bigint; readonly result: Promise<ResourceFrame>; readonly cancel: () => void } {
    this.requireClient(client);
    const owner = this.handles.get(handleId);
    if (owner === undefined || owner.client !== client || this.closing.has(handleId))
      throwInputRejected("resource handle unavailable");
    const handle = owner.handle;
    resourceU64(offset.toString());
    const failure = validateReadResourceChunkRequest(
      { handleId, authorityEpoch: this.epochValue, offsetBytes: offset, lengthBytes: length },
      handle,
    );
    if (failure !== null) throwInputRejected("resource read range rejected");
    const id = this.nextTransfer++;
    if (priority !== "visible" && priority !== "background")
      throwInputRejected("invalid resource priority");
    const background = [...this.reads.values()].filter((r) => r.priority === "background");
    if (
      priority === "background" &&
      (background.length >= 4 || background.filter((r) => r.client === client).length >= 2)
    )
      throwResourceBackpressure("consumer");
    if (!this.inFlight.reserve(String(id), client, length)) throwResourceBackpressure("consumer");
    const result = new Promise<ResourceFrame>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail("resource transfer completion timeout"),
        this.timeout,
      );
      this.reads.set(id, {
        client,
        handle,
        offset,
        length,
        resolve,
        reject,
        timer,
        cancelled: false,
        priority,
      });
    });
    void this.command("resource.readChunk", {
      client,
      authorityEpoch: this.epochValue.toString(),
      handleId,
      offsetBytes: offset.toString(),
      lengthBytes: length,
      transferId: id.toString(),
      priority,
    }).catch((error) => {
      if (this.failed) return; // Connection teardown, not rejection, owns these credits.
      const read = this.reads.get(id);
      if (read === undefined) return;
      clearTimeout(read.timer);
      this.reads.delete(id);
      this.inFlight.settle(String(id));
      read.reject(error);
    });
    return {
      id,
      result,
      cancel: () => {
        const read = this.reads.get(id);
        if (read !== undefined) read.cancelled = true;
      },
    };
  }
  async close(client: string, handleId: string): Promise<void> {
    const owner = this.handles.get(handleId);
    if (owner === undefined || owner.client !== client)
      throwInputRejected("resource handle unavailable");
    if (this.closing.has(handleId)) throwInputRejected("resource handle already closing");
    this.closing.add(handleId);
    try {
      await this.command(
        "resource.closeHandle",
        { client, authorityEpoch: this.epochValue.toString(), handleId },
        true,
      );
      this.handles.delete(handleId);
    } finally {
      this.closing.delete(handleId);
    }
  }
  async disconnect(client: string): Promise<void> {
    if (!this.clients.has(client)) return;
    if (this.disconnecting.has(client)) throwInputRejected("resource client already disconnecting");
    this.disconnecting.add(client);
    for (const read of this.reads.values()) if (read.client === client) read.cancelled = true;
    try {
      if (!this.failed) await this.internalCommand("resource.disconnect", { client });
      this.clients.delete(client);
      for (const [id, owner] of this.handles) if (owner.client === client) this.handles.delete(id);
    } finally {
      this.disconnecting.delete(client);
    }
  }
  /** Trusted application control; never expose an arbitrary operation dispatcher to renderer. */
  command(operationKey: string, payload: JsonObject, urgent = false): Promise<JsonObject> {
    if (this.failed || this.child === undefined)
      return Promise.reject(
        createResourceError("inputRejected", { detail: "resource authority unavailable" }),
      );
    const ordinary = [...this.pending.values()].filter((p) => !p.urgent).length;
    if (this.pending.size >= 32 || (!urgent && ordinary >= 24))
      return Promise.reject(createResourceError("backpressure", { scope: "authority" }));
    const key = String(this.nextRequest++);
    const envelope = createControlRequestEnvelope({ requestKey: key, operationKey, payload });
    const encoded = `${JSON.stringify(envelope)}\n`;
    if (Buffer.byteLength(encoded) > 4096) throwInputRejected("resource control too large");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail("resource control deadline"), this.timeout);
      this.pending.set(key, { resolve, reject, timer, urgent });
      // All admitted writes (including Node's queue) are bounded by the pending slots.
      try {
        this.controlInputBytes += Buffer.byteLength(encoded);
        this.child?.stdin.write(encoded);
      } catch {
        this.fail("resource control write failed");
      }
    });
  }
  diagnostics(): {
    readonly inFlight: ResourceBudgetSnapshot;
    readonly copiedBytes: number;
    readonly bodyAllocations: number;
    readonly pendingControls: number;
    readonly controlInputBytes: number;
    readonly controlOutputBytes: number;
    readonly bulkInputBytes: number;
  } {
    return {
      inFlight: this.inFlight.snapshot(),
      ...this.decoder.diagnostics(),
      pendingControls: this.pending.size,
      controlInputBytes: this.controlInputBytes,
      controlOutputBytes: this.controlOutputBytes,
      bulkInputBytes: this.bulkInputBytes,
    };
  }
  /** Host-owned diagnostic hook; not a consumer capability. */
  pauseBulk(paused: boolean): void {
    if (paused) this.child?.stderr.pause();
    else this.child?.stderr.resume();
  }
  terminate(): void {
    this.fail("resource authority terminated");
  }
  /** Host-owned pressure-test hook; never exposed to a consumer. */
  pauseControl(paused: boolean): void {
    if (paused) this.child?.stdout.pause();
    else this.child?.stdout.resume();
  }
  async stop(): Promise<void> {
    if (this.child === undefined) return;
    this.fail("resource authority stopped");
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                createResourceError("inputRejected", { detail: "resource child did not exit" }),
              ),
            2000,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  private get timeout(): number {
    return this.options.requestTimeoutMs ?? 5000;
  }
  private requireClient(client: string): void {
    if (this.failed || !this.clients.has(client) || this.disconnecting.has(client))
      throwInputRejected("resource client unavailable");
  }
  private admit(h: ResourceFrameHeader): void {
    const r = this.reads.get(h.transferId);
    if (
      r === undefined ||
      h.authorityEpoch !== this.epochValue ||
      h.resourceVersion !== r.handle.resourceVersion ||
      h.offsetBytes !== r.offset ||
      h.lengthBytes !== r.length ||
      h.eof !== (h.offsetBytes + BigInt(h.lengthBytes) === BigInt(r.handle.descriptor.byteLength))
    )
      throwInputRejected("uncorrelated resource frame");
  }
  private receive(frame: ResourceFrame): void {
    const r = this.reads.get(frame.transferId);
    if (r === undefined) throwInputRejected("duplicate resource frame");
    this.reads.delete(frame.transferId);
    clearTimeout(r.timer);
    // Full owned allocation accepted/discarded; native credit ends here, not at cache eviction.
    this.inFlight.settle(String(frame.transferId));
    void this.internalCommand("resource.receipt", {
      authorityEpoch: this.epochValue.toString(),
      transferId: frame.transferId.toString(),
    }).catch(() => this.fail("resource receipt failed"));
    if (r.cancelled || !this.clients.has(r.client))
      r.reject(createResourceError("inputRejected", { detail: "resource read cancelled" }));
    else r.resolve(frame);
  }
  private receiveControl(chunk: string): void {
    // Node chunks may contain many bounded lines; consume without retaining the chunk.
    let start = 0;
    for (let end = chunk.indexOf("\n"); end !== -1; end = chunk.indexOf("\n", start)) {
      const line = this.stdout + chunk.slice(start, end);
      this.stdout = "";
      start = end + 1;
      if (Buffer.byteLength(line) > 4096) throwInputRejected("resource control output too large");
      const v = resourceRecord(JSON.parse(line));
      if (v.kind === "authorityReady") {
        if (this.epochValue !== 0n || v.protocolVersion !== 1)
          throwInputRejected("resource authority version/epoch");
        this.epochValue = resourceU64(v.authorityEpoch);
        if (this.epochValue === 0n) throwInputRejected("zero authority epoch");
        this.readyResolve?.();
        this.readyResolve = undefined;
      } else if (v.kind === "resourceInvalidated") {
        const epoch = resourceU64(v.authorityEpoch);
        if (epoch !== this.epochValue) throwInputRejected("stale resource invalidation");
        const key = resourceString(v.resourceKey);
        for (const opening of this.opening) if (opening.key === key) opening.invalidated = true;
        const version = resourceU64(v.resourceVersion);
        for (const [id, owner] of this.handles)
          if (owner.handle.resourceKey === key && owner.handle.resourceVersion === version)
            this.handles.delete(id);
        for (const r of this.reads.values())
          if (r.handle.resourceKey === key && r.handle.resourceVersion === version)
            r.cancelled = true;
        this.notify({
          authorityEpoch: epoch,
          resourceKey: key,
          resourceVersion: version,
          reason: "revoked",
        });
      } else {
        const validation = validateControlResponseEnvelope(v);
        if (!validation.ok) throwInputRejected("invalid resource control envelope");
        const response = validation.value;
        const pending = this.pending.get(response.requestKey);
        if (pending === undefined) throwInputRejected("uncorrelated resource control response");
        this.pending.delete(response.requestKey);
        for (const wake of [...this.controlCapacityWaiters]) wake();
        clearTimeout(pending.timer);
        if (response.ok) pending.resolve(response.payload);
        else pending.reject(response.failure);
      }
    }
    this.stdout += chunk.slice(start);
    if (Buffer.byteLength(this.stdout) > 4096)
      throwInputRejected("resource control output too large");
  }
  private fail(detail: string): void {
    if (this.failed) return;
    this.failed = true;
    const error = createResourceError("inputRejected", { detail });
    this.readyReject?.(error);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    for (const wake of [...this.controlCapacityWaiters]) wake();
    // Child termination closes the only pipe owner. No more data can be adopted.
    this.child?.kill();
    for (const r of this.reads.values()) {
      clearTimeout(r.timer);
      r.reject(error);
    }
    this.clients.clear();
    this.handles.clear();
    this.notify({ authorityEpoch: this.epochValue, reason: "authorityUnavailable" });
  }
  private notify(event: ResourceInvalidation): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }
  /** At most eight receipts and two disconnects can wait for shared control
   * admission. They keep their native reservations until actually acknowledged.
   * Waiters wake before user response continuations can refill the control queue.
   */
  private async internalCommand(
    operation: "resource.receipt" | "resource.disconnect",
    payload: JsonObject,
  ): Promise<JsonObject> {
    const deadline = performance.now() + this.timeout;
    while (true) {
      try {
        return await this.command(operation, payload, true);
      } catch (error) {
        if (!isExclaveError(error) || error.code !== "resource.backpressure" || this.failed)
          throw error;
        if (performance.now() >= deadline)
          throwInputRejected("resource cleanup admission deadline");
        if (this.pending.size < 32) continue;
        if (this.controlCapacityWaiters.size >= 10)
          throwInputRejected("resource cleanup queue invariant");
        await new Promise<void>((resolve, reject) => {
          const wake = () => {
            clearTimeout(timer);
            this.controlCapacityWaiters.delete(wake);
            resolve();
          };
          const timer = setTimeout(
            () => {
              this.controlCapacityWaiters.delete(wake);
              reject(
                createResourceError("inputRejected", {
                  detail: "resource cleanup admission deadline",
                }),
              );
            },
            Math.max(1, deadline - performance.now()),
          );
          this.controlCapacityWaiters.add(wake);
          if (this.failed || this.pending.size < 32) wake();
        });
      }
    }
  }
}
