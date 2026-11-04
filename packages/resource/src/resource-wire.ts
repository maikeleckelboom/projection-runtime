import { throwInputRejected } from "./errors";

export const RESOURCE_WIRE_VERSION = 1;
export const RESOURCE_HEADER_BYTES = 48;
export const RESOURCE_MAX_CHUNK_BYTES: number = 256 * 1024;

export type ResourceFrameHeader = {
  readonly transferId: bigint;
  readonly authorityEpoch: bigint;
  readonly resourceVersion: bigint;
  readonly offsetBytes: bigint;
  readonly lengthBytes: number;
  readonly eof: boolean;
};
export type ResourceFrame = ResourceFrameHeader & { readonly payload: Uint8Array<ArrayBuffer> };

export function decodeResourceHeader(bytes: Uint8Array): ResourceFrameHeader {
  if (bytes.byteLength !== RESOURCE_HEADER_BYTES) throwInputRejected("resource header length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, false) !== 0x45585242 ||
    view.getUint16(4, true) !== RESOURCE_WIRE_VERSION ||
    view.getUint16(6, true) !== 1
  ) {
    throwInputRejected("resource magic, version or packet kind");
  }
  const lengthBytes = view.getUint32(8, true);
  const flags = view.getUint32(12, true);
  const transferId = view.getBigUint64(16, true);
  const authorityEpoch = view.getBigUint64(24, true);
  const offsetBytes = view.getBigUint64(32, true);
  const resourceVersion = view.getBigUint64(40, true);
  if (
    lengthBytes === 0 ||
    lengthBytes > RESOURCE_MAX_CHUNK_BYTES ||
    flags > 1 ||
    transferId === 0n ||
    authorityEpoch === 0n ||
    resourceVersion === 0n ||
    offsetBytes + BigInt(lengthBytes) > 0xffff_ffff_ffff_ffffn
  ) {
    throwInputRejected("resource length, flags or identity");
  }
  return {
    transferId,
    authorityEpoch,
    resourceVersion,
    offsetBytes,
    lengthBytes,
    eof: flags === 1,
  };
}

/** One checked allocation per body, linear copying even for one-byte input.
 * admit runs BEFORE allocation. Callbacks consume synchronously; no frame queue.
 * A callback failure poisons the decoder and the caller must tear down the link.
 */
export class ResourceFrameDecoder {
  private readonly headerBytes = new Uint8Array(RESOURCE_HEADER_BYTES);
  private headerUsed = 0;
  private header: ResourceFrameHeader | undefined;
  private body: Uint8Array<ArrayBuffer> | undefined;
  private bodyUsed = 0;
  private ended = false;
  private copied = 0;
  private allocations = 0;
  private readonly admit: (header: ResourceFrameHeader) => void;
  private readonly receive: (frame: ResourceFrame) => void;

  constructor(
    admit: (header: ResourceFrameHeader) => void,
    receive: (frame: ResourceFrame) => void,
  ) {
    this.admit = admit;
    this.receive = receive;
  }

  push(chunk: Uint8Array): void {
    if (this.ended || !(chunk instanceof Uint8Array))
      throwInputRejected("resource decoder closed/input invalid");
    try {
      let offset = 0;
      while (offset < chunk.byteLength) {
        if (this.header === undefined) {
          const count = Math.min(
            RESOURCE_HEADER_BYTES - this.headerUsed,
            chunk.byteLength - offset,
          );
          this.headerBytes.set(chunk.subarray(offset, offset + count), this.headerUsed);
          offset += count;
          this.headerUsed += count;
          this.copied += count;
          if (this.headerUsed !== RESOURCE_HEADER_BYTES) continue;
          this.header = decodeResourceHeader(this.headerBytes);
          this.admit(this.header);
          this.body = new Uint8Array(this.header.lengthBytes);
          this.allocations++;
        }
        const body = this.body;
        if (body === undefined) throwInputRejected("missing resource frame allocation");
        const count = Math.min(body.byteLength - this.bodyUsed, chunk.byteLength - offset);
        body.set(chunk.subarray(offset, offset + count), this.bodyUsed);
        offset += count;
        this.bodyUsed += count;
        this.copied += count;
        if (this.bodyUsed === body.byteLength) {
          const frame: ResourceFrame = { ...this.header, payload: body };
          this.header = undefined;
          this.body = undefined;
          this.headerUsed = 0;
          this.bodyUsed = 0;
          this.receive(frame);
        }
      }
    } catch (error) {
      this.ended = true;
      this.body = undefined;
      this.header = undefined;
      throw error;
    }
  }

  finish(): void {
    if (this.ended) throwInputRejected("resource decoder already closed");
    this.ended = true;
    const truncated = this.headerUsed !== 0 || this.body !== undefined;
    this.body = undefined;
    this.header = undefined;
    if (truncated) throwInputRejected("resource truncated EOF");
  }

  diagnostics(): { readonly copiedBytes: number; readonly bodyAllocations: number } {
    return { copiedBytes: this.copied, bodyAllocations: this.allocations };
  }
}
