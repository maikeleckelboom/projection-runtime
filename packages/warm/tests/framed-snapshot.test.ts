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
