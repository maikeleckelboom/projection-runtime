import {
  decodeWarmLaneFrame,
  decodeWarmSnapshotPayload,
  encodeWarmLaneFrame,
  encodeWarmSnapshotPayload,
  type WarmLaneFrame,
  type WarmSnapshotObject,
  type WarmSnapshotPayloadDecodeResult,
  type WarmSnapshotPayloadEncodeResult,
  type WarmSnapshotPayloadManifest,
} from "@exclave/warm";
import { describe, expect, expectTypeOf, it } from "vitest";

const broadManifest = {
  warmCodecVersion: 0x0102_0304_0506_0708n,
  fields: [
    {
      dotPath: "vector",
      fieldId: 11,
      shape: { kind: "FixedVector", elementType: "i16", length: 3 },
    },
    { dotPath: "message", fieldId: 6, shape: { kind: "VariableString" } },
    {
      dotPath: "nameUtf8",
      fieldId: 8,
      shape: { kind: "FixedStringEncoded", byteLength: 8, encoding: "utf8" },
    },
    { dotPath: "active", fieldId: 1, shape: { kind: "FixedScalar", type: "bool" } },
    {
      dotPath: "bounded",
      fieldId: 3,
      shape: {
        kind: "BoundedMap",
        keyEncoding: "fixed-ascii",
        keyByteLength: 4,
        maxEntries: 3,
        valueShape: { kind: "FixedScalar", type: "u8" },
      },
    },
    { dotPath: "sequence", fieldId: 9, shape: { kind: "FixedScalar", type: "u64" } },
    { dotPath: "float", fieldId: 5, shape: { kind: "FixedScalar", type: "f64" } },
    {
      dotPath: "array",
      fieldId: 2,
      shape: { kind: "BoundedArray", elementType: "u16", maxLength: 4 },
    },
    {
      dotPath: "variable",
      fieldId: 10,
      shape: { kind: "VariableMap", valueShape: { kind: "VariableString" } },
    },
    {
      dotPath: "nameAscii",
      fieldId: 7,
      shape: { kind: "FixedStringEncoded", byteLength: 8, encoding: "ascii" },
    },
    {
      dotPath: "enum",
      fieldId: 4,
      shape: { kind: "FixedEnum", storage: "u16", variants: ["idle", "run", "stop"] },
    },
  ],
} as const satisfies WarmSnapshotPayloadManifest;

const broadSnapshot = {
  active: true,
  array: [1, 513],
  bounded: { bb: 2, a: 1 },
  enum: "stop",
  float: 1.5,
  message: "hello",
  nameAscii: "mix",
  nameUtf8: "éon",
  sequence: 0x0102_0304_0506_0708n,
  variable: { beta: "two", alpha: "one" },
  vector: [1, -2, 300],
} as const satisfies WarmSnapshotObject;

const expectedBroadSnapshot = {
  active: true,
  array: [1, 513],
  bounded: { a: 1, bb: 2 },
  enum: "stop",
  float: 1.5,
  message: "hello",
  nameAscii: "mix",
  nameUtf8: "éon",
  sequence: 0x0102_0304_0506_0708n,
  variable: { alpha: "one", beta: "two" },
  vector: [1, -2, 300],
} satisfies WarmSnapshotObject;

describe("Warm Codec v1 manifest-derived snapshot payloads", () => {
  it("exports the payload codec type surface", () => {
    expect(typeof encodeWarmSnapshotPayload).toBe("function");
    expect(typeof decodeWarmSnapshotPayload).toBe("function");
    expectTypeOf<WarmSnapshotPayloadEncodeResult>().toEqualTypeOf<
      | { readonly ok: true; readonly bytes: Uint8Array }
      | {
          readonly ok: false;
          readonly failure: {
            readonly kind: "warmSnapshotPayloadEncodeFailure";
            readonly reason:
              | "invalidManifest"
              | "invalidSnapshotObject"
              | "snapshotFieldMissing"
              | "snapshotFieldUnknown"
              | "invalidSnapshotValue";
            readonly detail: string;
            readonly path?: string;
            readonly fieldDotPath?: string;
            readonly fieldId?: number;
          };
        }
    >();
    expectTypeOf<WarmSnapshotPayloadDecodeResult>().toEqualTypeOf<
      | { readonly ok: true; readonly snapshot: WarmSnapshotObject }
      | {
          readonly ok: false;
          readonly failure: {
            readonly kind: "warmSnapshotPayloadDecodeFailure";
            readonly reason:
              | "invalidManifest"
              | "invalidPayloadInput"
              | "malformedPayload"
              | "invalidUtf8";
            readonly detail: string;
            readonly path?: string;
            readonly fieldDotPath?: string;
            readonly fieldId?: number;
            readonly offset?: number;
          };
        }
    >();
  });

  it("encodes payload golden bytes for all current warm field shapes", () => {
    const encoded = unwrapPayloadEncode(encodeWarmSnapshotPayload(broadManifest, broadSnapshot));

    expect(bytesToHex(encoded)).toBe(
      "01020000000100010202000000610000000162620000020200000000000000f83f0500000068656c6c6f03006d69780400c3a96f6e08070605040302010200000005000000616c706861030000006f6e6504000000626574610300000074776f0100feff2c01",
    );
  });

  it("round trips encoded payload bytes to a normalized logical snapshot", () => {
    const encoded = unwrapPayloadEncode(encodeWarmSnapshotPayload(broadManifest, broadSnapshot));
    const decoded = unwrapPayloadDecode(decodeWarmSnapshotPayload(broadManifest, encoded));

    expect(decoded).toEqual(expectedBroadSnapshot);
  });

  it("sorts bounded and variable map entries by encoded key bytes deterministically", () => {
    const manifest = {
      fields: [
        {
          dotPath: "bounded",
          shape: {
            kind: "BoundedMap",
            keyByteLength: 2,
            maxEntries: 4,
            valueShape: { kind: "FixedScalar", type: "u8" },
          },
        },
        {
          dotPath: "variable",
          shape: {
            kind: "VariableMap",
            valueShape: { kind: "FixedScalar", type: "u8" },
          },
        },
      ],
    } as const satisfies WarmSnapshotPayloadManifest;

    const encoded = unwrapPayloadEncode(
      encodeWarmSnapshotPayload(manifest, {
        bounded: { b: 2, aa: 1 },
        variable: { beta: 4, alpha: 3 },
      }),
    );

    expect(bytesToHex(encoded)).toBe(
      "020000006161016200020200000005000000616c70686103040000006265746104",
    );
  });

  it("rejects duplicate map keys when object key enumeration exposes them", () => {
    const duplicateKeyMap = new Proxy(Object.create(null) as Record<string, unknown>, {
      ownKeys: () => ["dup", "dup"],
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
      get: () => 1,
    });

    const result = encodeWarmSnapshotPayload(
      {
        fields: [
          {
            dotPath: "bounded",
            shape: {
              kind: "BoundedMap",
              keyByteLength: 4,
              maxEntries: 2,
              valueShape: { kind: "FixedScalar", type: "u8" },
            },
          },
        ],
      },
      { bounded: duplicateKeyMap },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe("invalidSnapshotValue");
      expect(result.failure.detail).toContain("duplicate");
    }
  });

  it.each([
    {
      name: "truncated scalar",
      manifest: oneField({ kind: "FixedScalar", type: "u32" }),
      bytes: [0x01, 0x02, 0x03],
      reason: "malformedPayload",
    },
    {
      name: "invalid bool byte",
      manifest: oneField({ kind: "FixedScalar", type: "bool" }),
      bytes: [0x02],
      reason: "malformedPayload",
    },
    {
      name: "enum discriminant out of range",
      manifest: oneField({ kind: "FixedEnum", storage: "u8", variants: ["idle"] }),
      bytes: [0x01],
      reason: "malformedPayload",
    },
    {
      name: "fixed vector truncation",
      manifest: oneField({ kind: "FixedVector", elementType: "u16", length: 2 }),
      bytes: [0x01, 0x00, 0x02],
      reason: "malformedPayload",
    },
    {
      name: "bounded array count above max",
      manifest: oneField({ kind: "BoundedArray", elementType: "u8", maxLength: 1 }),
      bytes: [0x02, 0x00, 0x00, 0x00],
      reason: "malformedPayload",
    },
    {
      name: "bounded map count above max",
      manifest: oneField({
        kind: "BoundedMap",
        keyByteLength: 2,
        maxEntries: 1,
        valueShape: { kind: "FixedScalar", type: "u8" },
      }),
      bytes: [0x02, 0x00, 0x00, 0x00],
      reason: "malformedPayload",
    },
    {
      name: "non-increasing bounded map keys",
      manifest: oneField({
        kind: "BoundedMap",
        keyByteLength: 2,
        maxEntries: 2,
        valueShape: { kind: "FixedScalar", type: "u8" },
      }),
      bytes: [0x02, 0x00, 0x00, 0x00, 0x62, 0x00, 0x01, 0x61, 0x00, 0x02],
      reason: "malformedPayload",
    },
    {
      name: "invalid UTF-8 variable map key",
      manifest: oneField({
        kind: "VariableMap",
        valueShape: { kind: "FixedScalar", type: "u8" },
      }),
      bytes: [0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff, 0x01],
      reason: "invalidUtf8",
    },
    {
      name: "fixed string length above max",
      manifest: oneField({ kind: "FixedStringEncoded", byteLength: 3, encoding: "utf8" }),
      bytes: [0x04, 0x00, 0x61, 0x62, 0x63, 0x64],
      reason: "malformedPayload",
    },
    {
      name: "extra trailing bytes",
      manifest: oneField({ kind: "FixedScalar", type: "bool" }),
      bytes: [0x01, 0x00],
      reason: "malformedPayload",
    },
  ] as const)("rejects malformed payload bytes: $name", ({ manifest, bytes, reason }) => {
    const decoded = decodeWarmSnapshotPayload(manifest, Uint8Array.from(bytes));

    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.failure.reason).toBe(reason);
      expect("snapshot" in decoded).toBe(false);
    }
  });

  it("composes manifest payload bytes with the existing outer warm lane frame codec", () => {
    const payload = unwrapPayloadEncode(encodeWarmSnapshotPayload(broadManifest, broadSnapshot));
    const frame: WarmLaneFrame = {
      contractKey: "fixture.warmPayload",
      projectionInstanceKey: "warm-payload-v0.instance",
      semanticVersion: 0x1111_2222_3333_4444n,
      warmCodecVersion: broadManifest.warmCodecVersion,
      baselineEpoch: 9,
      continuityGeneration: 4,
      publicationSequence: 0x21n,
      laneSequence: 2,
      payload,
    };

    const frameBytes = unwrapFrameEncode(encodeWarmLaneFrame(frame));
    const decodedFrame = decodeWarmLaneFrame(frameBytes);
    expect(decodedFrame.ok).toBe(true);
    if (!decodedFrame.ok) throw new Error("expected frame decode to succeed");

    expect(decodedFrame.frame).toEqual(frame);
    const decodedPayload = unwrapPayloadDecode(
      decodeWarmSnapshotPayload(broadManifest, decodedFrame.frame.payload),
    );
    expect(decodedPayload).toEqual(expectedBroadSnapshot);
  });
});

function oneField(
  shape: WarmSnapshotPayloadManifest["fields"][number]["shape"],
): WarmSnapshotPayloadManifest {
  return { fields: [{ dotPath: "value", shape }] };
}

function unwrapPayloadEncode(result: WarmSnapshotPayloadEncodeResult): Uint8Array {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected payload encode to succeed");
  return result.bytes;
}

function unwrapPayloadDecode(result: WarmSnapshotPayloadDecodeResult): WarmSnapshotObject {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected payload decode to succeed");
  return result.snapshot;
}

function unwrapFrameEncode(result: ReturnType<typeof encodeWarmLaneFrame>): Uint8Array {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected frame encode to succeed");
  return result.bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
