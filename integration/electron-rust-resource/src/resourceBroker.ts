import { isExclaveError } from "@exclave/base";
import { ResourceBudget } from "@exclave/resource";
import type { MessagePortMain } from "electron";
import { throwResourceBackpressure } from "../../../packages/resource/src/errors";
import type { ResourceProcess } from "../../../packages/resource/src/node/resource-process";
import {
  resourceRecord,
  resourceString,
  resourceU64,
} from "../../../packages/resource/src/resource-wire-values";

/** Connection identity is issued by trusted main, never supplied by the renderer. */
export async function attachResourcePort(
  authority: ResourceProcess,
  port: MessagePortMain,
  observeClone?: (senderRetained: boolean) => void,
): Promise<() => Promise<void>> {
  const client = await authority.connect();
  const queued = new ResourceBudget({
    bytes: 1024 * 1024,
    items: 4,
    clientBytes: 1024 * 1024,
    clientItems: 4,
  });
  const reads = new Map<
    string,
    { cancel: () => void; delivered: boolean; timer: NodeJS.Timeout }
  >();
  const operations = new Set<string>();
  let closed = false;
  let cloneObserved = false;
  let lastId = 0n;
  const send = (value: unknown) => {
    if (!closed) port.postMessage(value);
  };
  const detachInvalidation = authority.onInvalidated((event) =>
    send({ kind: "invalidated", ...event }),
  );
  const close = async () => {
    if (closed) return;
    closed = true;
    detachInvalidation();
    port.close();
    for (const [id, r] of reads) {
      r.cancel();
      clearTimeout(r.timer);
      if (r.delivered) {
        queued.settle(id);
        reads.delete(id);
      }
    }
    try {
      await authority.disconnect(client);
    } catch {
      authority.terminate();
    }
  };
  port.on("close", () => {
    void close();
  });
  port.on("message", (event) => {
    void (async () => {
      const message = resourceRecord(event.data);
      if (message.kind === "disconnect") {
        await close();
        return;
      }
      const id = resourceString(message.id);
      if (message.kind === "receipt") {
        const read = reads.get(id);
        if (read === undefined || !read.delivered) throw new Error("unmatched resource receipt");
        clearTimeout(read.timer);
        reads.delete(id);
        queued.settle(id);
        return;
      }
      if (message.kind === "cancel") {
        reads.get(id)?.cancel();
        return;
      }
      const ordinal = resourceU64(id);
      if (ordinal <= lastId || operations.size >= 24)
        throw new Error("resource operation identity/capacity");
      lastId = ordinal;
      operations.add(id);
      try {
        switch (message.kind) {
          case "open": {
            const handle = await authority.open(client, resourceString(message.resourceKey));
            send({ kind: "result", id, value: { handle } });
            break;
          }
          case "close": {
            await authority.close(client, resourceString(message.handleId));
            send({ kind: "result", id, value: {} });
            break;
          }
          case "read": {
            const length = message.lengthBytes;
            if (
              typeof length !== "number" ||
              !Number.isSafeInteger(length) ||
              length < 1 ||
              length > 262144
            )
              throw new Error("invalid read length");
            if (!queued.reserve(id, client, length)) throwResourceBackpressure("consumer");
            let request: ReturnType<ResourceProcess["read"]>;
            const priority = message.priority;
            if (priority !== "visible" && priority !== "background") {
              queued.settle(id);
              throw new Error("invalid resource priority");
            }
            try {
              request = authority.read(
                client,
                resourceString(message.handleId),
                resourceU64(message.offsetBytes),
                length,
                priority,
              );
            } catch (error) {
              queued.settle(id);
              throw error;
            }
            const entry = {
              cancel: request.cancel,
              delivered: false,
              timer: setTimeout(() => {
                void close();
              }, 5000),
            };
            reads.set(id, entry);
            try {
              const frame = await request.result;
              if (closed) {
                clearTimeout(entry.timer);
                reads.delete(id);
                queued.settle(id);
                return;
              }
              entry.delivered = true;
              send({ kind: "chunk", id, ...frame });
              if (observeClone !== undefined && !cloneObserved) {
                cloneObserved = true;
                observeClone(frame.payload.byteLength === length);
                // Proof-only: changing the sender after posting must not change the
                // independently hashed renderer/worker copy. Never mutate native backing.
                frame.payload[0] = (frame.payload[0] ?? 0) ^ 255;
              }
              // MessagePortMain supports port transfer only: this body is cloned.
              // The queue reservation persists until consumer adoption/discard receipt.
            } catch (error) {
              clearTimeout(entry.timer);
              reads.delete(id);
              queued.settle(id);
              throw error;
            }
            break;
          }
          default:
            throw new Error("unsupported resource operation");
        }
      } catch (error) {
        const native =
          typeof error === "object" && error !== null && "details" in error
            ? error.details
            : undefined;
        const failure =
          isExclaveError(error) && error.code === "resource.backpressure"
            ? { kind: "resourceBackpressure", scope: error.details.scope }
            : typeof native === "object" && native !== null && "kind" in native
              ? native
              : {
                  kind: "resourceContractViolation",
                  detail: error instanceof Error ? error.message : "resource request rejected",
                };
        send({ kind: "error", id, failure });
      } finally {
        operations.delete(id);
      }
    })().catch(() => {
      void close();
    });
  });
  port.start();
  return close;
}
