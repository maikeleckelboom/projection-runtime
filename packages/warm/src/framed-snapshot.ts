export const DEFAULT_MAX_WARM_FRAME_BYTE_LENGTH: number = 1024 * 1024;

export type WarmLaneFrame = {
  readonly contractKey: string;
  readonly projectionInstanceKey: string;
  readonly semanticVersion: bigint;
  readonly warmCodecVersion: bigint;
  readonly baselineEpoch: number;
  readonly continuityGeneration: number;
  readonly publicationSequence: bigint;
  readonly laneSequence?: number;
  readonly payload: Uint8Array;
};

export type WarmFrameCodecOptions = {
  readonly maxFrameByteLength?: number;
};

export type WarmFrameDecodeFailureReason =
  | "frameTooLarge"
  | "malformedFrameLength"
  | "malformedPayloadLength"
  | "invalidLaneSequencePresent"
  | "invalidUtf8"
  | "invalidFrameInput";

export type WarmFrameEncodeFailureReason =
  | "frameTooLarge"
  | "invalidFrameInput"
  | "resourceBodyRejected";

export type WarmFrameDecodeFailure = {
  readonly kind: "warmFrameDecodeFailure";
  readonly reason: WarmFrameDecodeFailureReason;
  readonly detail: string;
};

export type WarmFrameEncodeFailure = {
  readonly kind: "warmFrameEncodeFailure";
  readonly reason: WarmFrameEncodeFailureReason;
  readonly detail: string;
};

export type WarmFrameDecodeResult =
  | { readonly ok: true; readonly frame: WarmLaneFrame }
  | { readonly ok: false; readonly failure: WarmFrameDecodeFailure };

export type WarmFrameEncodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly failure: WarmFrameEncodeFailure };

const U32_MAX = 0xffff_ffff;
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const RESOURCE_BODY_KEYS: ReadonlySet<string> = new Set([
  "arrayBuffer",
  "blob",
  "body",
  "buffer",
  "byteArray",
  "bytes",
  "payload",
  "raw",
  "sharedArrayBuffer",
  "uint8Array",
]);

export function encodeWarmLaneFrame(
  input: WarmLaneFrame,
  options: WarmFrameCodecOptions = {},
): WarmFrameEncodeResult {
  const maxFrameByteLength = normalizeMaxFrameByteLength(options.maxFrameByteLength);
  if (maxFrameByteLength === null) {
    return encodeFailure("invalidFrameInput", "maxFrameByteLength must be a positive u32 value");
  }

  if (typeof input !== "object" || input === null) {
    return encodeFailure("invalidFrameInput", "warm frame input must be a plain object");
  }

  const payloadValue = (input as { readonly payload?: unknown }).payload;
  if (!(payloadValue instanceof Uint8Array)) {
    if (looksLikeResourceBodyDescriptor(payloadValue)) {
      return encodeFailure(
        "resourceBodyRejected",
        "warm framed-snapshot payload must be already-encoded snapshot bytes, not a resource body descriptor",
      );
    }
    return encodeFailure(
      "invalidFrameInput",
      "warm framed-snapshot payload must be a Uint8Array of already-encoded snapshot bytes",
    );
  }

  const contractKeyBytes = encodeUtf8Field(input.contractKey);
  if (contractKeyBytes === null) {
    return encodeFailure("invalidFrameInput", "contractKey must be valid UTF-8 text");
  }

  const projectionInstanceKeyBytes = encodeUtf8Field(input.projectionInstanceKey);
  if (projectionInstanceKeyBytes === null) {
    return encodeFailure("invalidFrameInput", "projectionInstanceKey must be valid UTF-8 text");
  }

  if (!isU64(input.semanticVersion)) {
    return encodeFailure("invalidFrameInput", "semanticVersion must fit in u64");
  }
  if (!isU64(input.warmCodecVersion)) {
    return encodeFailure("invalidFrameInput", "warmCodecVersion must fit in u64");
  }
  if (!isU32(input.baselineEpoch)) {
    return encodeFailure("invalidFrameInput", "baselineEpoch must fit in u32");
  }
  if (!isU32(input.continuityGeneration)) {
    return encodeFailure("invalidFrameInput", "continuityGeneration must fit in u32");
  }
  if (!isU64(input.publicationSequence)) {
    return encodeFailure("invalidFrameInput", "publicationSequence must fit in u64");
  }
  if (input.laneSequence !== undefined && !isU32(input.laneSequence)) {
    return encodeFailure("invalidFrameInput", "laneSequence must fit in u32 when present");
  }

  const payload = payloadValue;
  const laneSequenceByteLength = input.laneSequence === undefined ? 0 : 4;
  const frameByteLength =
    4 +
    contractKeyBytes.byteLength +
    4 +
    projectionInstanceKeyBytes.byteLength +
    8 +
    8 +
    4 +
    4 +
    8 +
    1 +
    laneSequenceByteLength +
    4 +
    payload.byteLength;
  const totalByteLength = frameByteLength + 4;

  if (frameByteLength > U32_MAX) {
    return encodeFailure("frameTooLarge", "frameByteLength must fit in u32");
  }
  if (totalByteLength > maxFrameByteLength) {
    return encodeFailure(
      "frameTooLarge",
      `warm frame byte length ${totalByteLength} exceeds maxFrameByteLength ${maxFrameByteLength}`,
    );
  }

  const bytes = new Uint8Array(totalByteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  view.setUint32(offset, frameByteLength, true);
  offset += 4;

  offset = writeLengthPrefixedBytes(view, bytes, offset, contractKeyBytes);
  offset = writeLengthPrefixedBytes(view, bytes, offset, projectionInstanceKeyBytes);

  view.setBigUint64(offset, input.semanticVersion, true);
  offset += 8;
  view.setBigUint64(offset, input.warmCodecVersion, true);
  offset += 8;
  view.setUint32(offset, input.baselineEpoch, true);
  offset += 4;
  view.setUint32(offset, input.continuityGeneration, true);
  offset += 4;
  view.setBigUint64(offset, input.publicationSequence, true);
  offset += 8;

  bytes[offset] = input.laneSequence === undefined ? 0 : 1;
  offset += 1;
  if (input.laneSequence !== undefined) {
    view.setUint32(offset, input.laneSequence, true);
    offset += 4;
  }

  view.setUint32(offset, payload.byteLength, true);
  offset += 4;
  bytes.set(payload, offset);

  return { ok: true, bytes };
}

export function decodeWarmLaneFrame(
  bytes: Uint8Array,
  options: WarmFrameCodecOptions = {},
): WarmFrameDecodeResult {
  const maxFrameByteLength = normalizeMaxFrameByteLength(options.maxFrameByteLength);
  if (maxFrameByteLength === null) {
    return decodeFailure("invalidFrameInput", "maxFrameByteLength must be a positive u32 value");
  }

  if (!(bytes instanceof Uint8Array)) {
    return decodeFailure("invalidFrameInput", "warm frame bytes must be a Uint8Array");
  }

  if (bytes.byteLength > maxFrameByteLength) {
    return decodeFailure(
      "frameTooLarge",
      `warm frame byte length ${bytes.byteLength} exceeds maxFrameByteLength ${maxFrameByteLength}`,
    );
  }

  if (bytes.byteLength < 4) {
    return decodeFailure("malformedFrameLength", "frame is shorter than frameByteLength prefix");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredFrameByteLength = view.getUint32(0, true);
  const declaredTotalByteLength = declaredFrameByteLength + 4;

  if (declaredTotalByteLength > maxFrameByteLength) {
    return decodeFailure(
      "frameTooLarge",
      `declared warm frame byte length ${declaredTotalByteLength} exceeds maxFrameByteLength ${maxFrameByteLength}`,
    );
  }

  if (declaredFrameByteLength !== bytes.byteLength - 4) {
    return decodeFailure(
      "malformedFrameLength",
      `declared frameByteLength ${declaredFrameByteLength} does not match actual ${bytes.byteLength - 4}`,
    );
  }

  let offset = 4;

  const contractKeyResult = readUtf8Field(view, bytes, offset, "contractKey");
  if (!contractKeyResult.ok) return contractKeyResult;
  offset = contractKeyResult.offset;

  const projectionInstanceKeyResult = readUtf8Field(view, bytes, offset, "projectionInstanceKey");
  if (!projectionInstanceKeyResult.ok) return projectionInstanceKeyResult;
  offset = projectionInstanceKeyResult.offset;

  if (!hasRemaining(bytes, offset, 33)) {
    return decodeFailure(
      "malformedFrameLength",
      "frame ended before required fixed-width metadata fields",
    );
  }

  const semanticVersion = view.getBigUint64(offset, true);
  offset += 8;
  const warmCodecVersion = view.getBigUint64(offset, true);
  offset += 8;
  const baselineEpoch = view.getUint32(offset, true);
  offset += 4;
  const continuityGeneration = view.getUint32(offset, true);
  offset += 4;
  const publicationSequence = view.getBigUint64(offset, true);
  offset += 8;

  const laneSequencePresent = bytes[offset];
  offset += 1;
  if (laneSequencePresent !== 0 && laneSequencePresent !== 1) {
    return decodeFailure(
      "invalidLaneSequencePresent",
      `laneSequencePresent must be 0x00 or 0x01, got ${String(laneSequencePresent)}`,
    );
  }

  let laneSequence: number | undefined;
  if (laneSequencePresent === 1) {
    if (!hasRemaining(bytes, offset, 4)) {
      return decodeFailure("malformedFrameLength", "frame ended before laneSequence");
    }
    laneSequence = view.getUint32(offset, true);
    offset += 4;
  }

  if (!hasRemaining(bytes, offset, 4)) {
    return decodeFailure("malformedPayloadLength", "frame ended before payloadByteLength");
  }

  const payloadByteLength = view.getUint32(offset, true);
  offset += 4;
  const remainingPayloadBytes = bytes.byteLength - offset;
  if (payloadByteLength !== remainingPayloadBytes) {
    return decodeFailure(
      "malformedPayloadLength",
      `declared payloadByteLength ${payloadByteLength} does not match actual ${remainingPayloadBytes}`,
    );
  }

  const payload = bytes.slice(offset);

  return {
    ok: true,
    frame: {
      contractKey: contractKeyResult.value,
      projectionInstanceKey: projectionInstanceKeyResult.value,
      semanticVersion,
      warmCodecVersion,
      baselineEpoch,
      continuityGeneration,
      publicationSequence,
      ...(laneSequence !== undefined ? { laneSequence } : {}),
      payload,
    },
  };
}

function encodeFailure(
  reason: WarmFrameEncodeFailureReason,
  detail: string,
): { readonly ok: false; readonly failure: WarmFrameEncodeFailure } {
  return { ok: false, failure: { kind: "warmFrameEncodeFailure", reason, detail } };
}

function decodeFailure(
  reason: WarmFrameDecodeFailureReason,
  detail: string,
): { readonly ok: false; readonly failure: WarmFrameDecodeFailure } {
  return { ok: false, failure: { kind: "warmFrameDecodeFailure", reason, detail } };
}

function normalizeMaxFrameByteLength(value: number | undefined): number | null {
  const maxFrameByteLength = value ?? DEFAULT_MAX_WARM_FRAME_BYTE_LENGTH;
  if (
    typeof maxFrameByteLength !== "number" ||
    !Number.isSafeInteger(maxFrameByteLength) ||
    maxFrameByteLength <= 0 ||
    maxFrameByteLength > U32_MAX
  ) {
    return null;
  }
  return maxFrameByteLength;
}

function encodeUtf8Field(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const encoded = textEncoder.encode(value);
  try {
    const decoded = textDecoder.decode(encoded);
    return decoded === value ? encoded : null;
  } catch {
    return null;
  }
}

function isU32(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= U32_MAX;
}

function isU64(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n && value <= U64_MAX;
}

function writeLengthPrefixedBytes(
  view: DataView,
  target: Uint8Array,
  offset: number,
  value: Uint8Array,
): number {
  view.setUint32(offset, value.byteLength, true);
  const bytesOffset = offset + 4;
  target.set(value, bytesOffset);
  return bytesOffset + value.byteLength;
}

type ReadUtf8FieldResult =
  | { readonly ok: true; readonly value: string; readonly offset: number }
  | { readonly ok: false; readonly failure: WarmFrameDecodeFailure };

function readUtf8Field(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  label: "contractKey" | "projectionInstanceKey",
): ReadUtf8FieldResult {
  if (!hasRemaining(bytes, offset, 4)) {
    return decodeFailure("malformedFrameLength", `frame ended before ${label} length`);
  }

  const byteLength = view.getUint32(offset, true);
  offset += 4;

  if (!hasRemaining(bytes, offset, byteLength)) {
    return decodeFailure("malformedFrameLength", `frame ended before ${label} bytes`);
  }

  try {
    const value = textDecoder.decode(bytes.subarray(offset, offset + byteLength));
    return { ok: true, value, offset: offset + byteLength };
  } catch {
    return decodeFailure("invalidUtf8", `${label} bytes are not valid UTF-8`);
  }
}

function hasRemaining(bytes: Uint8Array, offset: number, length: number): boolean {
  return offset >= 0 && length >= 0 && offset <= bytes.byteLength - length;
}

function looksLikeResourceBodyDescriptor(value: unknown): boolean {
  if (typeof value !== "object" || value === null || value instanceof Uint8Array) {
    return false;
  }
  if (
    value instanceof ArrayBuffer ||
    value instanceof SharedArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return false;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (RESOURCE_BODY_KEYS.has(key)) {
      return true;
    }
  }
  return false;
}
