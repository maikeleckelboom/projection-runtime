import {
  decodeWarmLaneFrame,
  encodeWarmLaneFrame,
  type WarmFrameDecodeFailure,
  type WarmFrameEncodeFailure,
  type WarmLaneFrame,
} from "@exclave/warm";
import { describe, expect, expectTypeOf, it } from "vitest";

const fixtureFrame: WarmLaneFrame = {
  contractKey: "deck.runtime",
  projectionInstanceKey: "deck.a",
  semanticVersion: 0x0102_0304_0506_0708n,
  warmCodecVersion: 0x1112_1314_1516_1718n,
  baselineEpoch: 7,
  continuityGeneration: 3,
  publicationSequence: 42n,
  laneSequence: 0,
  payload: new Uint8Array([0x01, 0x78, 0x00, 0x01]),
};

describe("Warm Codec v1 framed-snapshot binary subset", () => {
  it("exports the framed-snapshot type surface", () => {
    expect(typeof encodeWarmLaneFrame).toBe("function");
    expect(typeof decodeWarmLaneFrame).toBe("function");
    expectTypeOf<WarmLaneFrame["payload"]>().toEqualTypeOf<Uint8Array>();
    expectTypeOf<WarmFrameDecodeFailure["reason"]>().toEqualTypeOf<
      | "frameTooLarge"
      | "malformedFrameLength"
      | "malformedPayloadLength"
      | "invalidLaneSequencePresent"
      | "invalidUtf8"
      | "invalidIdentityField"
      | "invalidFrameInput"
    >();
    expectTypeOf<WarmFrameEncodeFailure["reason"]>().toEqualTypeOf<
      "frameTooLarge" | "invalidFrameInput" | "resourceBodyRejected"
    >();
  });

  it("encodes the first warm binary frame deterministically", () => {
    const first = unwrapEncode(encodeWarmLaneFrame(fixtureFrame));
    const second = unwrapEncode(encodeWarmLaneFrame({ ...fixtureFrame }));

    expect(first).toEqual(second);
    expect(new DataView(first.buffer, first.byteOffset, first.byteLength).getUint32(0, true)).toBe(
      first.byteLength - 4,
    );
    expect(bytesToHex(first)).toBe(
      "470000000c0000006465636b2e72756e74696d65060000006465636b2e610807060504030201181716151413121107000000030000002a0000000000000001000000000400000001780001",
    );
  });

  it("decodes a complete warm binary frame to the expected logical frame", () => {
    const bytes = unwrapEncode(encodeWarmLaneFrame(fixtureFrame));
    const decoded = decodeWarmLaneFrame(bytes);

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("expected decode to succeed");

    expect(decoded.frame).toEqual(fixtureFrame);
    expect(decoded.frame.payload).not.toBe(fixtureFrame.payload);
  });

  it("does not carry authorityEpoch in warm frame bytes or decoded frame state", () => {
    const bytes = unwrapEncode(encodeWarmLaneFrame(fixtureFrame));
    const decoded = decodeWarmLaneFrame(bytes);
    if (!decoded.ok) throw new Error("expected decode to succeed");

    expect("authorityEpoch" in decoded.frame).toBe(false);
    expect(new TextDecoder().decode(bytes)).not.toContain("authorityEpoch");
  });

  it("rejects malformed frameByteLength", () => {
    const bytes = unwrapEncode(encodeWarmLaneFrame(fixtureFrame));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(0, bytes.byteLength, true);

    const decoded = decodeWarmLaneFrame(bytes);

    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.failure.reason).toBe("malformedFrameLength");
    }
  });

  it("rejects malformed payloadByteLength without exposing partial decoded state", () => {
    const bytes = unwrapEncode(encodeWarmLaneFrame(fixtureFrame));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(payloadLengthOffset(bytes, fixtureFrame.payload.byteLength), 99, true);

    const decoded = decodeWarmLaneFrame(bytes);

    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.failure.reason).toBe("malformedPayloadLength");
      expect("frame" in decoded).toBe(false);
    }
  });

  it("rejects invalid laneSequencePresent", () => {
    const bytes = unwrapEncode(encodeWarmLaneFrame(fixtureFrame));
    bytes[laneSequencePresentOffset(fixtureFrame)] = 2;

    const decoded = decodeWarmLaneFrame(bytes);

    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.failure.reason).toBe("invalidLaneSequencePresent");
    }
  });

  it("rejects oversized frames before decoding", () => {
    const bytes = unwrapEncode(encodeWarmLaneFrame(fixtureFrame));

    const decoded = decodeWarmLaneFrame(bytes, { maxFrameByteLength: bytes.byteLength - 1 });

    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.failure.reason).toBe("frameTooLarge");
    }
  });

  it("rejects invalid UTF-8 in identity strings", () => {
    const bytes = unwrapEncode(encodeWarmLaneFrame(fixtureFrame));
    bytes[8] = 0xff;

    const decoded = decodeWarmLaneFrame(bytes);

    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.failure.reason).toBe("invalidUtf8");
    }
  });

  it("rejects obvious resource-body descriptor shapes as framed-snapshot payload input", () => {
    const encoded = encodeWarmLaneFrame({
      ...fixtureFrame,
      payload: { bytes: new Uint8Array([1, 2, 3]) } as never,
    });

    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.failure.reason).toBe("resourceBodyRejected");
    }
  });

  it("encodes a valid fixture without laneSequence deterministically", () => {
    const minimalFrame: WarmLaneFrame = {
      contractKey: "deck.runtime",
      projectionInstanceKey: "deck.a",
      semanticVersion: 1n,
      warmCodecVersion: 1n,
      baselineEpoch: 0,
      continuityGeneration: 0,
      publicationSequence: 0n,
      payload: new Uint8Array([0xff]),
    };

    const first = unwrapEncode(encodeWarmLaneFrame(minimalFrame));
    const second = unwrapEncode(encodeWarmLaneFrame(minimalFrame));

    expect(first).toEqual(second);
  });

  it("rejects encode input with extra authorityEpoch field", () => {
    const encoded = encodeWarmLaneFrame({
      ...fixtureFrame,
      authorityEpoch: 1n,
    } as never);

    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.failure.reason).toBe("invalidFrameInput");
      expect(encoded.failure.detail).toContain("authorityEpoch");
    }
  });

  it("rejects encode input with extra body field", () => {
    const encoded = encodeWarmLaneFrame({
      ...fixtureFrame,
      body: "smuggled",
    } as never);

    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.failure.reason).toBe("invalidFrameInput");
      expect(encoded.failure.detail).toContain("body");
    }
  });

  it("rejects encode input with extra bytes field", () => {
    const encoded = encodeWarmLaneFrame({
      ...fixtureFrame,
      bytes: new Uint8Array(0),
    } as never);

    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.failure.reason).toBe("invalidFrameInput");
      expect(encoded.failure.detail).toContain("bytes");
    }
  });

  it("rejects encode input with extra frame field", () => {
    const encoded = encodeWarmLaneFrame({
      ...fixtureFrame,
      frame: {},
    } as never);

    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.failure.reason).toBe("invalidFrameInput");
      expect(encoded.failure.detail).toContain("frame");
    }
  });

  it("rejects encode input with extra resourceVersion field", () => {
    const encoded = encodeWarmLaneFrame({
      ...fixtureFrame,
      resourceVersion: 1,
    } as never);

    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.failure.reason).toBe("invalidFrameInput");
      expect(encoded.failure.detail).toContain("resourceVersion");
    }
  });

  it("rejects encode input with arbitrary extra field", () => {
    const encoded = encodeWarmLaneFrame({
      ...fixtureFrame,
      totallyMadeUpField: true,
    } as never);

    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.failure.reason).toBe("invalidFrameInput");
      expect(encoded.failure.detail).toContain("totallyMadeUpField");
    }
  });

  it("rejects encode input with symbol keys", () => {
    const input = { ...fixtureFrame } as never;
    (input as Record<symbol, unknown>)[Symbol("hidden")] = "symbol value";

    const encoded = encodeWarmLaneFrame(input);

    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.failure.reason).toBe("invalidFrameInput");
      expect(encoded.failure.detail).toContain("symbol");
    }
  });

  it("rejects encode input that is a class instance", () => {
    class WarmFrameLike {
      contractKey = fixtureFrame.contractKey;
      projectionInstanceKey = fixtureFrame.projectionInstanceKey;
      semanticVersion = fixtureFrame.semanticVersion;
      warmCodecVersion = fixtureFrame.warmCodecVersion;
      baselineEpoch = fixtureFrame.baselineEpoch;
      continuityGeneration = fixtureFrame.continuityGeneration;
      publicationSequence = fixtureFrame.publicationSequence;
      laneSequence = fixtureFrame.laneSequence;
      payload = fixtureFrame.payload;
    }

    const encoded = encodeWarmLaneFrame(new WarmFrameLike() as never);

    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.failure.reason).toBe("invalidFrameInput");
      expect(encoded.failure.detail).toContain("class instance");
    }
  });

  it("rejects encode input that is an array", () => {
    const encoded = encodeWarmLaneFrame([] as never);

    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.failure.reason).toBe("invalidFrameInput");
      expect(encoded.failure.detail).toContain("array");
    }
  });

  it("rejects encode input with explicit laneSequence undefined", () => {
    const encoded = encodeWarmLaneFrame({
      contractKey: fixtureFrame.contractKey,
      projectionInstanceKey: fixtureFrame.projectionInstanceKey,
      semanticVersion: fixtureFrame.semanticVersion,
      warmCodecVersion: fixtureFrame.warmCodecVersion,
      baselineEpoch: fixtureFrame.baselineEpoch,
      continuityGeneration: fixtureFrame.continuityGeneration,
      publicationSequence: fixtureFrame.publicationSequence,
      laneSequence: undefined,
      payload: fixtureFrame.payload,
    });

    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.failure.reason).toBe("invalidFrameInput");
      expect(encoded.failure.detail).toContain("laneSequence");
    }
  });

  it("rejects decode of frame with empty contractKey", () => {
    const frame = new Uint8Array(8);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    view.setUint32(0, 4, true);
    view.setUint32(4, 0, true);

    const result = decodeWarmLaneFrame(frame);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe("invalidIdentityField");
      expect(result.failure.detail).toContain("contractKey");
      expect("frame" in result).toBe(false);
    }
  });

  it("rejects decode of frame with empty projectionInstanceKey", () => {
    const key = new TextEncoder().encode("ab");
    const dataLength = 4 + key.byteLength + 4;
    const frame = new Uint8Array(4 + dataLength);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

    let offset = 0;
    view.setUint32(offset, dataLength, true);
    offset += 4;
    view.setUint32(offset, key.byteLength, true);
    offset += 4;
    frame.set(key, offset);
    offset += key.byteLength;
    view.setUint32(offset, 0, true);

    const result = decodeWarmLaneFrame(frame);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe("invalidIdentityField");
      expect(result.failure.detail).toContain("projectionInstanceKey");
      expect("frame" in result).toBe(false);
    }
  });

  it("rejects decode of frame with identity length that overruns remaining bytes", () => {
    const frame = new Uint8Array(8);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    view.setUint32(0, 4, true);
    view.setUint32(4, 200, true);

    const result = decodeWarmLaneFrame(frame);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe("malformedFrameLength");
      expect("frame" in result).toBe(false);
    }
  });

  it("decode failure results do not expose partial frame state", () => {
    const truncated = new Uint8Array(12);
    const view = new DataView(truncated.buffer, truncated.byteOffset, truncated.byteLength);
    view.setUint32(0, 8, true);
    view.setUint32(4, 4, true);
    const textEncoder = new TextEncoder();
    const key = textEncoder.encode("ab");
    truncated.set(key, 8);

    const result = decodeWarmLaneFrame(truncated);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect("frame" in result).toBe(false);
      expect(result.failure.kind).toBe("warmFrameDecodeFailure");
    }
  });

  it("resourceBodyRejected is only a diagnostic refinement of invalid payload input", () => {
    const numericPayload = encodeWarmLaneFrame({
      ...fixtureFrame,
      payload: 42 as never,
    });
    expect(numericPayload.ok).toBe(false);
    if (!numericPayload.ok) {
      expect(numericPayload.failure.reason).toBe("invalidFrameInput");
    }

    const bodyDescriptorPayload = encodeWarmLaneFrame({
      ...fixtureFrame,
      payload: { body: "resource" } as never,
    });
    expect(bodyDescriptorPayload.ok).toBe(false);
    if (!bodyDescriptorPayload.ok) {
      expect(bodyDescriptorPayload.failure.reason).toBe("resourceBodyRejected");
    }

    const nullPayload = encodeWarmLaneFrame({
      ...fixtureFrame,
      payload: null as never,
    });
    expect(nullPayload.ok).toBe(false);
    if (!nullPayload.ok) {
      expect(nullPayload.failure.reason).toBe("invalidFrameInput");
    }
  });
});

function unwrapEncode(result: ReturnType<typeof encodeWarmLaneFrame>): Uint8Array {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected encode to succeed");
  return result.bytes;
}

function payloadLengthOffset(bytes: Uint8Array, payloadByteLength: number): number {
  return bytes.byteLength - payloadByteLength - 4;
}

function laneSequencePresentOffset(frame: WarmLaneFrame): number {
  return (
    4 +
    4 +
    new TextEncoder().encode(frame.contractKey).byteLength +
    4 +
    new TextEncoder().encode(frame.projectionInstanceKey).byteLength +
    8 +
    8 +
    4 +
    4 +
    8
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
