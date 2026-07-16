import { describe, expect, it } from "vitest";

import { dispatchSidecarFramesUntilFailure } from "../src/authorityProcess.js";
import {
  createSidecarFrameDecoder,
  DEFAULT_MAX_SIDECAR_TOTAL_FRAME_BYTE_LENGTH,
  encodeSidecarFrame,
  MIN_SIDECAR_DECLARED_FRAME_BYTE_LENGTH,
  SIDECAR_FRAME_MAGIC,
  SIDECAR_PACKET_KIND,
  SIDECAR_PROTOCOL_VERSION,
  type SidecarFrameDecodeResult,
  type SidecarFrameFailure,
  type SidecarPacketKind,
} from "../src/sidecarFrame.js";

describe("private Electron/Rust sidecar framing v0", () => {
  it("stops same-chunk dispatch immediately after a semantically fatal packet", () => {
    const frames = [
      { packetKind: SIDECAR_PACKET_KIND.subscribeResult, payload: new Uint8Array([0xff]) },
      { packetKind: SIDECAR_PACKET_KIND.warmPublication, payload: new Uint8Array([0x00]) },
    ] as const;
    const receivedKinds: number[] = [];

    expect(
      dispatchSidecarFramesUntilFailure(frames, (frame) => {
        receivedKinds.push(frame.packetKind);
        return false;
      }),
    ).toBe(0);
    expect(receivedKinds).toEqual([SIDECAR_PACKET_KIND.subscribeResult]);
  });

  it("defines the complete v0 packet-kind vocabulary without a TypeScript enum", () => {
    expect(SIDECAR_PACKET_KIND).toEqual({
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
    });
  });

  it("encodes the exact little-endian prefix, magic, version, kind, and payload layout", () => {
    const payload = Uint8Array.of(0xde, 0xad, 0xbe);
    const bytes = encode(SIDECAR_PACKET_KIND.authorityReady, payload);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(bytes.byteLength).toBe(15);
    expect(view.getUint32(0, true)).toBe(MIN_SIDECAR_DECLARED_FRAME_BYTE_LENGTH + 3);
    expect(new TextDecoder().decode(bytes.subarray(4, 8))).toBe(SIDECAR_FRAME_MAGIC);
    expect(view.getUint16(8, true)).toBe(SIDECAR_PROTOCOL_VERSION);
    expect(view.getUint16(10, true)).toBe(SIDECAR_PACKET_KIND.authorityReady);
    expect(bytes.subarray(12)).toEqual(payload);
  });

  it("decodes a frame across arbitrary one-byte fragmentation", () => {
    const bytes = encode(SIDECAR_PACKET_KIND.warmPublication, Uint8Array.of(1, 2, 3, 4));
    const decoder = createSidecarFrameDecoder();
    const frames = [];

    for (let index = 0; index < bytes.byteLength; index += 1) {
      const result = decoder.push(bytes.subarray(index, index + 1));
      expect(result.ok).toBe(true);
      frames.push(...result.frames);
    }

    expect(frames).toEqual([
      {
        packetKind: SIDECAR_PACKET_KIND.warmPublication,
        payload: Uint8Array.of(1, 2, 3, 4),
      },
    ]);
    expect(decoder.finish()).toEqual({ ok: true, kind: "sidecarStreamEnded" });
  });

  it("decodes several concatenated frames from one chunk", () => {
    const decoder = createSidecarFrameDecoder();
    const bytes = concatenate(
      encode(SIDECAR_PACKET_KIND.authorityStarting, Uint8Array.of(1)),
      encode(SIDECAR_PACKET_KIND.authorityReady, Uint8Array.of(2, 3)),
      encode(SIDECAR_PACKET_KIND.shutdown, new Uint8Array(0)),
    );

    const result = decoder.push(bytes);

    expect(result.ok).toBe(true);
    expect(result.frames).toEqual([
      { packetKind: SIDECAR_PACKET_KIND.authorityStarting, payload: Uint8Array.of(1) },
      { packetKind: SIDECAR_PACKET_KIND.authorityReady, payload: Uint8Array.of(2, 3) },
      { packetKind: SIDECAR_PACKET_KIND.shutdown, payload: new Uint8Array(0) },
    ]);
  });

  it("rejects invalid magic as soon as the fixed header is available", () => {
    const bytes = encode(SIDECAR_PACKET_KIND.controlRequest, new Uint8Array(32));
    bytes[4] = 0;

    const result = createSidecarFrameDecoder().push(bytes.subarray(0, 12));

    expectFailure(result, "invalidMagic");
  });

  it("rejects an unknown protocol version as soon as the fixed header is available", () => {
    const bytes = encode(SIDECAR_PACKET_KIND.controlRequest, new Uint8Array(32));
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(8, 1, true);

    const result = createSidecarFrameDecoder().push(bytes.subarray(0, 12));

    expectFailure(result, "unsupportedVersion");
  });

  it("rejects an unknown packet kind as soon as the fixed header is available", () => {
    const bytes = encode(SIDECAR_PACKET_KIND.controlRequest, new Uint8Array(32));
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(10, 0xffff, true);

    const result = createSidecarFrameDecoder().push(bytes.subarray(0, 12));

    expectFailure(result, "unknownPacketKind");
  });

  it("rejects a too-small declared length from the prefix alone", () => {
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, MIN_SIDECAR_DECLARED_FRAME_BYTE_LENGTH - 1, true);

    const result = createSidecarFrameDecoder().push(prefix);

    expectFailure(result, "malformedFrameLength");
  });

  it("rejects an oversized declaration from the four-byte prefix without waiting or allocating it", () => {
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, DEFAULT_MAX_SIDECAR_TOTAL_FRAME_BYTE_LENGTH, true);

    const result = createSidecarFrameDecoder().push(prefix);

    const failure = expectFailure(result, "frameTooLarge");
    expect(failure.detail).toContain(String(DEFAULT_MAX_SIDECAR_TOTAL_FRAME_BYTE_LENGTH + 4));
  });

  it("enforces the configured maximum before encoding an output allocation", () => {
    const result = encodeSidecarFrame(
      {
        packetKind: SIDECAR_PACKET_KIND.metricsResponse,
        payload: new Uint8Array(5),
      },
      { maxTotalFrameByteLength: 16 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected sidecar encode failure");
    expect(result.failure.reason).toBe("frameTooLarge");
  });

  it("reports truncated EOF for a partial frame", () => {
    const bytes = encode(SIDECAR_PACKET_KIND.subscribeRequest, Uint8Array.of(1, 2, 3));
    const decoder = createSidecarFrameDecoder();
    const pushed = decoder.push(bytes.subarray(0, bytes.byteLength - 1));

    expect(pushed.ok).toBe(true);
    expect(pushed.frames).toEqual([]);
    const ended = decoder.finish();
    expect(ended.ok).toBe(false);
    if (ended.ok) throw new Error("expected truncated EOF");
    expect(ended.failure.reason).toBe("truncatedEof");
    expect(ended.failure.detail).toContain(`of ${bytes.byteLength} declared frame bytes`);
  });

  it("treats EOF with no pending bytes as clean", () => {
    const emptyDecoder = createSidecarFrameDecoder();
    expect(emptyDecoder.finish()).toEqual({ ok: true, kind: "sidecarStreamEnded" });

    const frameDecoder = createSidecarFrameDecoder();
    const result = frameDecoder.push(encode(SIDECAR_PACKET_KIND.shutdown, new Uint8Array(0)));
    expect(result.ok).toBe(true);
    expect(frameDecoder.finish()).toEqual({ ok: true, kind: "sidecarStreamEnded" });
  });

  it("returns decoded leading frames with a later fatal error and latches that first failure", () => {
    const valid = encode(SIDECAR_PACKET_KIND.authorityStarting, Uint8Array.of(1));
    const invalid = encode(SIDECAR_PACKET_KIND.authorityReady, Uint8Array.of(2));
    invalid[4] = 0;
    const decoder = createSidecarFrameDecoder();

    const first = decoder.push(concatenate(valid, invalid));
    const failure = expectFailure(first, "invalidMagic");
    expect(first.frames).toEqual([
      { packetKind: SIDECAR_PACKET_KIND.authorityStarting, payload: Uint8Array.of(1) },
    ]);

    const second = decoder.push(encode(SIDECAR_PACKET_KIND.shutdown, new Uint8Array(0)));
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("expected latched sidecar failure");
    expect(second.frames).toEqual([]);
    expect(second.failure).toBe(failure);

    const ended = decoder.finish();
    expect(ended.ok).toBe(false);
    if (ended.ok) throw new Error("expected latched sidecar failure at EOF");
    expect(ended.failure).toBe(failure);
  });
});

function encode(packetKind: SidecarPacketKind, payload: Uint8Array): Uint8Array {
  const result = encodeSidecarFrame({ packetKind, payload });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`failed to encode fixture: ${result.failure.detail}`);
  return result.bytes;
}

function expectFailure(
  result: SidecarFrameDecodeResult,
  reason: SidecarFrameFailure["reason"],
): SidecarFrameFailure {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`expected ${reason} sidecar frame failure`);
  expect(result.failure.kind).toBe("sidecarFrameFailure");
  expect(result.failure.reason).toBe(reason);
  return result.failure;
}

function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
