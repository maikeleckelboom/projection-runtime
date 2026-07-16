export const SIDECAR_FRAME_MAGIC = "EXCL";
export const SIDECAR_PROTOCOL_VERSION = 0;
export const MIN_SIDECAR_DECLARED_FRAME_BYTE_LENGTH = 8;
export const DEFAULT_MAX_SIDECAR_TOTAL_FRAME_BYTE_LENGTH = 1024 * 1024;

export const SIDECAR_PACKET_KIND = {
  authorityStarting: 1,
  authorityReady: 2,
  subscribeRequest: 3,
  subscribeResult: 4,
  controlRequest: 5,
  controlResponse: 6,
  warmPublication: 7,
  publicationCredit: 8,
  metricsRequest: 9,
  metricsResponse: 10,
  shutdown: 11,
  unsubscribeRequest: 12,
  unsubscribeResult: 13,
} as const;

export type SidecarPacketKindName = keyof typeof SIDECAR_PACKET_KIND;
export type SidecarPacketKind = (typeof SIDECAR_PACKET_KIND)[SidecarPacketKindName];

export type SidecarFrame = {
  readonly packetKind: SidecarPacketKind;
  readonly payload: Uint8Array;
};

export type SidecarFrameCodecOptions = {
  readonly maxTotalFrameByteLength?: number;
};

export type SidecarFrameFailureReason =
  | "invalidCodecOptions"
  | "invalidFrameInput"
  | "invalidDecoderInput"
  | "decoderClosed"
  | "frameTooLarge"
  | "malformedFrameLength"
  | "invalidMagic"
  | "unsupportedVersion"
  | "unknownPacketKind"
  | "truncatedEof";

export type SidecarFrameFailure = {
  readonly kind: "sidecarFrameFailure";
  readonly reason: SidecarFrameFailureReason;
  readonly detail: string;
};

export type SidecarFrameEncodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly failure: SidecarFrameFailure };

export type SidecarFrameDecodeResult =
  | {
      readonly ok: true;
      readonly kind: "sidecarFramesDecoded";
      readonly frames: readonly SidecarFrame[];
    }
  | {
      readonly ok: false;
      readonly kind: "sidecarFrameDecodeFailed";
      readonly frames: readonly SidecarFrame[];
      readonly failure: SidecarFrameFailure;
    };

export type SidecarFrameEofResult =
  | { readonly ok: true; readonly kind: "sidecarStreamEnded" }
  | {
      readonly ok: false;
      readonly kind: "sidecarFrameDecodeFailed";
      readonly failure: SidecarFrameFailure;
    };

export interface SidecarFrameDecoder {
  push(chunk: Uint8Array): SidecarFrameDecodeResult;
  finish(): SidecarFrameEofResult;
}

const FRAME_LENGTH_PREFIX_BYTE_LENGTH = 4;
const FIXED_HEADER_BYTE_LENGTH = MIN_SIDECAR_DECLARED_FRAME_BYTE_LENGTH;
const MIN_TOTAL_FRAME_BYTE_LENGTH =
  FRAME_LENGTH_PREFIX_BYTE_LENGTH + MIN_SIDECAR_DECLARED_FRAME_BYTE_LENGTH;
const MAX_DECLARED_FRAME_BYTE_LENGTH = 0xffff_ffff;
const MAX_TOTAL_FRAME_BYTE_LENGTH =
  FRAME_LENGTH_PREFIX_BYTE_LENGTH + MAX_DECLARED_FRAME_BYTE_LENGTH;
const EMPTY_BYTES = new Uint8Array(0);
const MAGIC_BYTES = Uint8Array.of(0x45, 0x58, 0x43, 0x4c);
const KNOWN_PACKET_KINDS: ReadonlySet<number> = new Set(Object.values(SIDECAR_PACKET_KIND));

export function encodeSidecarFrame(
  frame: SidecarFrame,
  options: SidecarFrameCodecOptions = {},
): SidecarFrameEncodeResult {
  const maxTotalFrameByteLength = normalizeMaxTotalFrameByteLength(options.maxTotalFrameByteLength);
  if (maxTotalFrameByteLength === null) {
    return encodeFailure(
      "invalidCodecOptions",
      `maxTotalFrameByteLength must be an integer from ${MIN_TOTAL_FRAME_BYTE_LENGTH} through ${MAX_TOTAL_FRAME_BYTE_LENGTH}`,
    );
  }

  if (typeof frame !== "object" || frame === null) {
    return encodeFailure("invalidFrameInput", "sidecar frame must be an object");
  }
  if (!isSidecarPacketKind(frame.packetKind)) {
    return encodeFailure(
      "unknownPacketKind",
      `sidecar packet kind ${String(frame.packetKind)} is not defined by protocol v0`,
    );
  }
  if (!(frame.payload instanceof Uint8Array)) {
    return encodeFailure("invalidFrameInput", "sidecar frame payload must be a Uint8Array");
  }

  const declaredFrameByteLength = FIXED_HEADER_BYTE_LENGTH + frame.payload.byteLength;
  const totalFrameByteLength = FRAME_LENGTH_PREFIX_BYTE_LENGTH + declaredFrameByteLength;
  if (
    declaredFrameByteLength > MAX_DECLARED_FRAME_BYTE_LENGTH ||
    totalFrameByteLength > maxTotalFrameByteLength
  ) {
    return encodeFailure(
      "frameTooLarge",
      `sidecar frame total byte length ${totalFrameByteLength} exceeds maximum ${maxTotalFrameByteLength}`,
    );
  }

  const bytes = new Uint8Array(totalFrameByteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(0, declaredFrameByteLength, true);
  bytes.set(MAGIC_BYTES, FRAME_LENGTH_PREFIX_BYTE_LENGTH);
  view.setUint16(8, SIDECAR_PROTOCOL_VERSION, true);
  view.setUint16(10, frame.packetKind, true);
  bytes.set(frame.payload, MIN_TOTAL_FRAME_BYTE_LENGTH);
  return { ok: true, bytes };
}

export function createSidecarFrameDecoder(
  options: SidecarFrameCodecOptions = {},
): SidecarFrameDecoder {
  const maxTotalFrameByteLength = normalizeMaxTotalFrameByteLength(options.maxTotalFrameByteLength);
  if (maxTotalFrameByteLength === null) {
    return new IncrementalSidecarFrameDecoder(
      DEFAULT_MAX_SIDECAR_TOTAL_FRAME_BYTE_LENGTH,
      createFailure(
        "invalidCodecOptions",
        `maxTotalFrameByteLength must be an integer from ${MIN_TOTAL_FRAME_BYTE_LENGTH} through ${MAX_TOTAL_FRAME_BYTE_LENGTH}`,
      ),
    );
  }
  return new IncrementalSidecarFrameDecoder(maxTotalFrameByteLength);
}

class IncrementalSidecarFrameDecoder implements SidecarFrameDecoder {
  private pendingBytes: Uint8Array = EMPTY_BYTES;
  private fatalFailure: SidecarFrameFailure | undefined;
  private ended = false;

  constructor(
    private readonly maxTotalFrameByteLength: number,
    initialFailure?: SidecarFrameFailure,
  ) {
    this.fatalFailure = initialFailure;
  }

  push(chunk: Uint8Array): SidecarFrameDecodeResult {
    if (this.fatalFailure !== undefined) {
      return decodeFailure([], this.fatalFailure);
    }
    if (this.ended) {
      return this.latchFailure(
        [],
        createFailure("decoderClosed", "cannot push bytes after sidecar stream EOF"),
      );
    }
    if (!(chunk instanceof Uint8Array)) {
      return this.latchFailure(
        [],
        createFailure("invalidDecoderInput", "sidecar stream chunks must be Uint8Array values"),
      );
    }
    if (chunk.byteLength === 0) {
      return decodeSuccess([]);
    }

    const bytes = appendPendingBytes(this.pendingBytes, chunk);
    this.pendingBytes = EMPTY_BYTES;
    const frames: SidecarFrame[] = [];
    let offset = 0;

    while (offset < bytes.byteLength) {
      const availableByteLength = bytes.byteLength - offset;
      if (availableByteLength < FRAME_LENGTH_PREFIX_BYTE_LENGTH) {
        this.pendingBytes = copyBytes(bytes, offset, bytes.byteLength);
        return decodeSuccess(frames);
      }

      const declaredFrameByteLength = readU32Le(bytes, offset);
      if (declaredFrameByteLength < MIN_SIDECAR_DECLARED_FRAME_BYTE_LENGTH) {
        return this.latchFailure(
          frames,
          createFailure(
            "malformedFrameLength",
            `declared sidecar frame byte length ${declaredFrameByteLength} is smaller than ${MIN_SIDECAR_DECLARED_FRAME_BYTE_LENGTH}`,
          ),
        );
      }

      const totalFrameByteLength = FRAME_LENGTH_PREFIX_BYTE_LENGTH + declaredFrameByteLength;
      if (totalFrameByteLength > this.maxTotalFrameByteLength) {
        return this.latchFailure(
          frames,
          createFailure(
            "frameTooLarge",
            `declared sidecar frame total byte length ${totalFrameByteLength} exceeds maximum ${this.maxTotalFrameByteLength}`,
          ),
        );
      }

      if (availableByteLength < MIN_TOTAL_FRAME_BYTE_LENGTH) {
        this.pendingBytes = copyBytes(bytes, offset, bytes.byteLength);
        return decodeSuccess(frames);
      }

      const headerFailure = validateHeader(bytes, offset);
      if (headerFailure !== null) {
        return this.latchFailure(frames, headerFailure);
      }

      if (availableByteLength < totalFrameByteLength) {
        this.pendingBytes = copyBytes(bytes, offset, bytes.byteLength);
        return decodeSuccess(frames);
      }

      const packetKind = readU16Le(bytes, offset + 10);
      const payloadOffset = offset + MIN_TOTAL_FRAME_BYTE_LENGTH;
      frames.push({
        packetKind: packetKind as SidecarPacketKind,
        payload: copyBytes(bytes, payloadOffset, offset + totalFrameByteLength),
      });
      offset += totalFrameByteLength;
    }

    return decodeSuccess(frames);
  }

  finish(): SidecarFrameEofResult {
    if (this.fatalFailure !== undefined) {
      return eofFailure(this.fatalFailure);
    }
    if (this.ended) {
      return { ok: true, kind: "sidecarStreamEnded" };
    }

    this.ended = true;
    if (this.pendingBytes.byteLength === 0) {
      return { ok: true, kind: "sidecarStreamEnded" };
    }

    let detail: string;
    if (this.pendingBytes.byteLength < FRAME_LENGTH_PREFIX_BYTE_LENGTH) {
      detail = `sidecar stream ended with ${this.pendingBytes.byteLength} of ${FRAME_LENGTH_PREFIX_BYTE_LENGTH} frame-length bytes`;
    } else {
      const declaredFrameByteLength = readU32Le(this.pendingBytes, 0);
      const totalFrameByteLength = FRAME_LENGTH_PREFIX_BYTE_LENGTH + declaredFrameByteLength;
      detail = `sidecar stream ended after ${this.pendingBytes.byteLength} of ${totalFrameByteLength} declared frame bytes`;
    }

    const failure = createFailure("truncatedEof", detail);
    this.fatalFailure = failure;
    this.pendingBytes = EMPTY_BYTES;
    return eofFailure(failure);
  }

  private latchFailure(
    frames: readonly SidecarFrame[],
    failure: SidecarFrameFailure,
  ): SidecarFrameDecodeResult {
    this.fatalFailure = failure;
    this.pendingBytes = EMPTY_BYTES;
    return decodeFailure(frames, failure);
  }
}

function validateHeader(bytes: Uint8Array, frameOffset: number): SidecarFrameFailure | null {
  const magicOffset = frameOffset + FRAME_LENGTH_PREFIX_BYTE_LENGTH;
  for (let index = 0; index < MAGIC_BYTES.byteLength; index += 1) {
    if (bytes[magicOffset + index] !== MAGIC_BYTES[index]) {
      return createFailure("invalidMagic", "sidecar frame magic must be ASCII EXCL");
    }
  }

  const version = readU16Le(bytes, frameOffset + 8);
  if (version !== SIDECAR_PROTOCOL_VERSION) {
    return createFailure(
      "unsupportedVersion",
      `sidecar protocol version ${version} is unsupported; expected ${SIDECAR_PROTOCOL_VERSION}`,
    );
  }

  const packetKind = readU16Le(bytes, frameOffset + 10);
  if (!isSidecarPacketKind(packetKind)) {
    return createFailure(
      "unknownPacketKind",
      `sidecar packet kind ${packetKind} is not defined by protocol v0`,
    );
  }
  return null;
}

function normalizeMaxTotalFrameByteLength(value: number | undefined): number | null {
  const maxTotalFrameByteLength = value ?? DEFAULT_MAX_SIDECAR_TOTAL_FRAME_BYTE_LENGTH;
  if (
    !Number.isSafeInteger(maxTotalFrameByteLength) ||
    maxTotalFrameByteLength < MIN_TOTAL_FRAME_BYTE_LENGTH ||
    maxTotalFrameByteLength > MAX_TOTAL_FRAME_BYTE_LENGTH
  ) {
    return null;
  }
  return maxTotalFrameByteLength;
}

function isSidecarPacketKind(value: unknown): value is SidecarPacketKind {
  return typeof value === "number" && Number.isInteger(value) && KNOWN_PACKET_KINDS.has(value);
}

function appendPendingBytes(pending: Uint8Array, chunk: Uint8Array): Uint8Array {
  if (pending.byteLength === 0) return chunk;
  const bytes = new Uint8Array(pending.byteLength + chunk.byteLength);
  bytes.set(pending, 0);
  bytes.set(chunk, pending.byteLength);
  return bytes;
}

function copyBytes(bytes: Uint8Array, start: number, end: number): Uint8Array {
  return Uint8Array.from(bytes.subarray(start, end));
}

function readU16Le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function readU32Le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function createFailure(reason: SidecarFrameFailureReason, detail: string): SidecarFrameFailure {
  return { kind: "sidecarFrameFailure", reason, detail };
}

function encodeFailure(
  reason: SidecarFrameFailureReason,
  detail: string,
): Extract<SidecarFrameEncodeResult, { readonly ok: false }> {
  return { ok: false, failure: createFailure(reason, detail) };
}

function decodeSuccess(frames: readonly SidecarFrame[]): SidecarFrameDecodeResult {
  return { ok: true, kind: "sidecarFramesDecoded", frames };
}

function decodeFailure(
  frames: readonly SidecarFrame[],
  failure: SidecarFrameFailure,
): SidecarFrameDecodeResult {
  return { ok: false, kind: "sidecarFrameDecodeFailed", frames, failure };
}

function eofFailure(failure: SidecarFrameFailure): SidecarFrameEofResult {
  return { ok: false, kind: "sidecarFrameDecodeFailed", failure };
}
