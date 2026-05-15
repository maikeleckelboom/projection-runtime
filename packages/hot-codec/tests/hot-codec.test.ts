import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SeqlokError } from "@seqlok/base";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  HotByteDecodeResult as PublicByteDecodeResult,
  HotByteEncodeResult as PublicByteEncodeResult,
  HotFieldScalarValue as PublicByteFieldScalarValue,
  HotFieldValue as PublicByteFieldValue,
  HotFieldValues as PublicByteFieldValues,
} from "../src/byte";
import * as hotByte from "../src/byte";
import * as hotCodec from "../src/index";
import {
  bytesToHex,
  decodeHotBlockAHeader,
  decodeHotBlockBHeader,
  decodeHotFieldValues,
  deriveHotLayoutVersion,
  encodeHotBlockAHeader,
  encodeHotBlockBHeader,
  encodeHotCompleteFixtureRegion,
  encodeHotFieldData,
  encodeHotFieldValues,
  encodeHotFixtureRegion,
  HOT_BASELINE_EPOCH_U32_OFFSET,
  HOT_BLOCK_A_BYTE_LENGTH,
  HOT_BLOCK_B_BYTE_LENGTH,
  HOT_BLOCK_B_BYTE_OFFSET,
  HOT_BLOCK_B_END_OFFSET,
  HOT_CONTINUITY_GENERATION_U32_OFFSET,
  HOT_FIELD_DATA_BYTE_OFFSET,
  HOT_PUBLICATION_SEQUENCE_U64_OFFSET,
  HOT_SEQLOCK_U64_OFFSET,
  type HotBlockAHeaderInput,
  type HotBlockBHeaderInput,
  type HotByteCodecError,
  type HotByteDecodeResult,
  type HotByteEncodeResult,
  type HotCodecError,
  type HotFieldScalarValue,
  type HotFieldValue,
  type HotFieldValues,
  type HotLayoutManifest,
  type HotLayoutPlanningField,
  type HotLayoutPlanningInput,
  type HotLayoutPlanningShape,
  type HotLayoutPlanResult,
  type HotLayoutPlanSuccess,
  hexToBytes,
  planHotLayoutManifest,
  validateHotBlockAHeader,
  validateHotBlockBHeader,
} from "../src/index";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const hotBasicLayoutPath = resolve(
  repoRoot,
  "fixtures/projection-runtime/hot-basic-v0/hot-layout-manifest.json",
);
const hotCodecSourceRoot = resolve(repoRoot, "packages/hot-codec/src");
const compilerSourceRoot = resolve(repoRoot, "packages/compiler/src");
const conformanceSourceRoot = resolve(repoRoot, "packages/conformance/src");
const guardedProductionSourceRoots = [
  hotCodecSourceRoot,
  compilerSourceRoot,
  conformanceSourceRoot,
];

const HOT_BASIC_SAMPLE_VALUES = {
  cursor: 123,
  health: "warn",
  level: 0.75,
  peaks: [0.125, 0.25, 0.5],
  phase: 12.5,
} as const satisfies HotFieldValues;

const HOT_BASIC_EXPECTED_FIELD_BYTES_HEX =
  "7b000000010000000000403f030000000000003e0000803e0000003f000000000000000000002940";
const HOT_BASIC_EXPECTED_FIXTURE_REGION_BYTES_HEX = `${"00".repeat(96)}${HOT_BASIC_EXPECTED_FIELD_BYTES_HEX}`;
const HOT_BASIC_BLOCK_A_INPUT = {
  contractKey: "fixture.hotBasic",
  instanceKey: "hot-basic-v0.instance",
  semanticVersion: 0x67b271f31c6b06a0n,
  hotLayoutVersion: 0x8f3eb897fd88495cn,
  fieldCount: 5,
  mutableRegionByteLength: 64,
} as const satisfies HotBlockAHeaderInput;
const HOT_BASIC_BLOCK_B_INPUT = {
  seqlockCounter: 2n,
  baselineEpoch: 7,
  continuityGeneration: 3,
  publicationSequence: 42n,
} as const satisfies HotBlockBHeaderInput;

function unwrap(result: HotLayoutPlanResult): HotLayoutManifest {
  expect(result.ok).toBe(true);
  return (result as HotLayoutPlanSuccess).value;
}

function expectFailure(result: HotLayoutPlanResult): HotCodecError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected hot-codec failure");
  }

  expect(result.error).toBeInstanceOf(SeqlokError);
  expect(result.error.code).toBe("hotCodec.layoutRejected");
  expect(result.error.details.issueCount).toBe(result.error.details.issues.length);
  return result.error;
}

function expectHotByteCodecError(action: () => unknown): HotByteCodecError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SeqlokError);
    expect((error as HotByteCodecError).code).toBe("hotCodec.byteRejected");
    return error as HotByteCodecError;
  }

  throw new Error("expected hot byte codec failure");
}

function input(
  fields: readonly HotLayoutPlanningField[],
  reservations: readonly string[] = [],
): HotLayoutPlanningInput {
  return {
    contractKey: "fixture.hot",
    fields,
    hot: { codec: "mapped-fixed", reservations },
  };
}

function field(
  dotPath: string,
  fieldId: number,
  shape: HotLayoutPlanningShape,
): HotLayoutPlanningField {
  return { dotPath, fieldId, shape };
}

function scalar(
  type: "bool" | "u8" | "u16" | "u32" | "u64" | "i8" | "i16" | "i32" | "i64" | "f32" | "f64",
): HotLayoutPlanningShape {
  return { kind: "FixedScalar", type };
}

function fixedFixture(): HotLayoutPlanningInput {
  return input([
    field("cursor", 1, scalar("u8")),
    field("phase", 2, scalar("f64")),
    field("tempo", 3, scalar("f64")),
  ]);
}

function hotBasicLayout(): HotLayoutManifest {
  const raw = JSON.parse(readFileSync(hotBasicLayoutPath, "utf8")) as Record<string, unknown>;
  const hotLayoutVersion = raw.hotLayoutVersion;

  if (typeof hotLayoutVersion !== "string") {
    throw new Error("hot-basic-v0 hotLayoutVersion must be a hex string");
  }

  return {
    ...raw,
    hotLayoutVersion: BigInt(`0x${hotLayoutVersion}`),
  } as unknown as HotLayoutManifest;
}

function sourceText(root: string): string {
  let text = "";

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      text += sourceText(path);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      text += readFileSync(path, "utf8");
    }
  }

  return text;
}

function guardedProductionSourceText(): string {
  return guardedProductionSourceRoots.map(sourceText).join("\n");
}

describe("@seqlok/hot-codec constants", () => {
  it("exports fixed Block A and Block B offsets", () => {
    expect(HOT_BLOCK_A_BYTE_LENGTH).toBe(72);
    expect(HOT_BLOCK_B_BYTE_OFFSET).toBe(72);
    expect(HOT_BLOCK_B_BYTE_LENGTH).toBe(24);
    expect(HOT_BLOCK_B_END_OFFSET).toBe(96);
    expect(HOT_FIELD_DATA_BYTE_OFFSET).toBe(96);
    expect(HOT_SEQLOCK_U64_OFFSET).toBe(72);
    expect(HOT_BASELINE_EPOCH_U32_OFFSET).toBe(80);
    expect(HOT_CONTINUITY_GENERATION_U32_OFFSET).toBe(84);
    expect(HOT_PUBLICATION_SEQUENCE_U64_OFFSET).toBe(88);
  });
});

describe("@seqlok/hot-codec deterministic layout", () => {
  it("plans deterministic offsets for fixed scalar fields", () => {
    const manifest = unwrap(planHotLayoutManifest(fixedFixture()));

    expect(
      manifest.fields.map(({ dotPath, absoluteOffset, byteSpan, alignment }) => ({
        dotPath,
        absoluteOffset,
        byteSpan,
        alignment,
      })),
    ).toEqual([
      { dotPath: "cursor", absoluteOffset: 96, byteSpan: 1, alignment: 1 },
      { dotPath: "phase", absoluteOffset: 104, byteSpan: 8, alignment: 8 },
      { dotPath: "tempo", absoluteOffset: 112, byteSpan: 8, alignment: 8 },
    ]);
  });

  it("rejects input fields that are not sorted by UTF-8 dotPath", () => {
    const error = expectFailure(
      planHotLayoutManifest(
        input([field("tempo", 1, scalar("f64")), field("cursor", 2, scalar("u8"))]),
      ),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain("field.orderInvalid");
  });

  it("re-running equivalent input produces identical manifests and layout versions", () => {
    const first = unwrap(planHotLayoutManifest(fixedFixture()));
    const second = unwrap(planHotLayoutManifest(fixedFixture()));

    expect(second).toEqual(first);
    expect(second.hotLayoutVersion).toBe(first.hotLayoutVersion);
  });

  it("accepts field ids across the full u32 range when deriving layout versions", () => {
    const manifest = unwrap(
      planHotLayoutManifest(input([field("tempo", 0xf0000000, scalar("f64"))])),
    );

    expect(manifest.fields[0]?.fieldId).toBe(0xf0000000);
    expectTypeOf(manifest.hotLayoutVersion).toEqualTypeOf<bigint>();
  });
});

describe("@seqlok/hot-codec alignment", () => {
  it("aligns f64 to 8, u8 to 1, and FixedStringEncoded to 1", () => {
    const manifest = unwrap(
      planHotLayoutManifest(
        input([
          field("cursor", 1, scalar("u8")),
          field("flags", 2, { kind: "FixedStringEncoded", byteLength: 5, encoding: "ascii" }),
          field("tempo", 3, scalar("f64")),
        ]),
      ),
    );

    expect(manifest.fields.map(({ dotPath, alignment }) => ({ dotPath, alignment }))).toEqual([
      { dotPath: "cursor", alignment: 1 },
      { dotPath: "flags", alignment: 1 },
      { dotPath: "tempo", alignment: 8 },
    ]);
  });

  it("pads a BoundedArray of f64 after the count so elements are 8-aligned", () => {
    const manifest = unwrap(
      planHotLayoutManifest(
        input(
          [field("peaks", 1, { kind: "BoundedArray", elementType: "f64", maxLength: 4 })],
          ["peaks"],
        ),
      ),
    );

    expect(manifest.fields[0]).toMatchObject({
      dotPath: "peaks",
      absoluteOffset: 96,
      byteSpan: 40,
      alignment: 8,
    });
    expect(manifest.reservations[0]).toEqual({
      dotPath: "peaks",
      countFieldOffset: 96,
      elementsOffset: 104,
      maxCount: 4,
      unitByteLength: 8,
    });
  });

  it("plans BoundedMap entries using key padding and value alignment formulas", () => {
    const manifest = unwrap(
      planHotLayoutManifest(
        input(
          [
            field("lookup", 1, {
              kind: "BoundedMap",
              keyEncoding: "fixed-ascii",
              keyByteLength: 3,
              valueShape: { kind: "FixedScalar", type: "f64" },
              maxEntries: 4,
            }),
          ],
          ["lookup"],
        ),
      ),
    );

    expect(manifest.fields[0]).toMatchObject({
      dotPath: "lookup",
      absoluteOffset: 96,
      byteSpan: 72,
      alignment: 8,
    });
    expect(manifest.reservations[0]).toEqual({
      dotPath: "lookup",
      countFieldOffset: 96,
      elementsOffset: 104,
      maxCount: 4,
      unitByteLength: 16,
    });
  });
});

describe("@seqlok/hot-codec region sizing", () => {
  it("includes Block A, Block B, and field data, padded to a multiple of 8", () => {
    const manifest = unwrap(planHotLayoutManifest(fixedFixture()));

    expect(manifest.totalRegionByteLength).toBe(120);
    expect(manifest.totalRegionByteLength % 8).toBe(0);
    expect(manifest.totalRegionByteLength).toBeGreaterThan(HOT_FIELD_DATA_BYTE_OFFSET);
  });

  it("derives mutableRegionByteLength from totalRegionByteLength minus Block A", () => {
    const manifest = unwrap(planHotLayoutManifest(fixedFixture()));

    expect(manifest.mutableRegionByteLength).toBe(
      manifest.totalRegionByteLength - HOT_BLOCK_A_BYTE_LENGTH,
    );
  });
});

describe("@seqlok/hot-codec hotLayoutVersion", () => {
  it("changes when a hot field is added", () => {
    const oneField = unwrap(planHotLayoutManifest(input([field("tempo", 1, scalar("f64"))])));
    const twoFields = unwrap(
      planHotLayoutManifest(
        input([field("phase", 2, scalar("f64")), field("tempo", 1, scalar("f64"))]),
      ),
    );

    expect(twoFields.hotLayoutVersion).not.toBe(oneField.hotLayoutVersion);
  });

  it("changes when a hot field width changes", () => {
    const f32Layout = unwrap(planHotLayoutManifest(input([field("tempo", 1, scalar("f32"))])));
    const f64Layout = unwrap(planHotLayoutManifest(input([field("tempo", 1, scalar("f64"))])));

    expect(f64Layout.hotLayoutVersion).not.toBe(f32Layout.hotLayoutVersion);
  });

  it("changes when an earlier field shifts a later field offset", () => {
    const compact = unwrap(
      planHotLayoutManifest(
        input([
          field("flags", 1, { kind: "FixedStringEncoded", byteLength: 1, encoding: "ascii" }),
          field("tempo", 2, scalar("f64")),
        ]),
      ),
    );
    const shifted = unwrap(
      planHotLayoutManifest(
        input([
          field("flags", 1, { kind: "FixedStringEncoded", byteLength: 9, encoding: "ascii" }),
          field("tempo", 2, scalar("f64")),
        ]),
      ),
    );

    expect(compact.fields.find((entry) => entry.dotPath === "tempo")?.absoluteOffset).toBe(104);
    expect(shifted.fields.find((entry) => entry.dotPath === "tempo")?.absoluteOffset).toBe(112);
    expect(shifted.hotLayoutVersion).not.toBe(compact.hotLayoutVersion);
  });

  it("changes when a reservation is removed from the canonical version input", () => {
    const withReservation = unwrap(
      planHotLayoutManifest(
        input(
          [field("peaks", 1, { kind: "BoundedArray", elementType: "f64", maxLength: 4 })],
          ["peaks"],
        ),
      ),
    );

    expect(deriveHotLayoutVersion({ ...withReservation, reservations: [] })).not.toBe(
      withReservation.hotLayoutVersion,
    );
  });

  it("ignores irrelevant object identity", () => {
    const first = unwrap(
      planHotLayoutManifest(input([field("tempo", 1, { kind: "FixedScalar", type: "f64" })])),
    );
    const second = unwrap(
      planHotLayoutManifest(input([field("tempo", 1, { kind: "FixedScalar", type: "f64" })])),
    );

    expect(second.hotLayoutVersion).toBe(first.hotLayoutVersion);
  });

  it("includes nanSentinel in canonical shape identity", () => {
    const withoutNanSentinel = unwrap(
      planHotLayoutManifest(input([field("tempo", 1, { kind: "FixedScalar", type: "f64" })])),
    );
    const withNanSentinel = unwrap(
      planHotLayoutManifest(
        input([field("tempo", 1, { kind: "FixedScalar", type: "f64", nanSentinel: true })]),
      ),
    );

    expect(withNanSentinel.hotLayoutVersion).not.toBe(withoutNanSentinel.hotLayoutVersion);
  });
});

describe("@seqlok/hot-codec byte helpers", () => {
  it("encodes hot-basic-v0 sample values to expected field bytes", () => {
    const encoded = encodeHotFieldValues(hotBasicLayout(), HOT_BASIC_SAMPLE_VALUES);

    expect(bytesToHex(encoded.fieldBytes)).toBe(HOT_BASIC_EXPECTED_FIELD_BYTES_HEX);
  });

  it("encodes hot-basic-v0 sample values to expected fixture region bytes", () => {
    const fixtureRegionBytes = encodeHotFixtureRegion(hotBasicLayout(), HOT_BASIC_SAMPLE_VALUES);

    expect(bytesToHex(fixtureRegionBytes)).toBe(HOT_BASIC_EXPECTED_FIXTURE_REGION_BYTES_HEX);
    expect(bytesToHex(fixtureRegionBytes.slice(0, 96))).toBe("00".repeat(96));
  });

  it("decodes hot-basic-v0 field and fixture region bytes to expected values", () => {
    const layout = hotBasicLayout();
    const fieldBytes = hexToBytes(HOT_BASIC_EXPECTED_FIELD_BYTES_HEX);
    const fixtureRegionBytes = hexToBytes(HOT_BASIC_EXPECTED_FIXTURE_REGION_BYTES_HEX);

    expect(decodeHotFieldValues(layout, fieldBytes).values).toEqual(HOT_BASIC_SAMPLE_VALUES);
    expect(decodeHotFieldValues(layout, fixtureRegionBytes).values).toEqual(
      HOT_BASIC_SAMPLE_VALUES,
    );
  });

  it("makes FixedScalar little-endian numeric encoding explicit", () => {
    const manifest = unwrap(
      planHotLayoutManifest(
        input([
          field("a", 1, scalar("u16")),
          field("b", 2, scalar("u32")),
          field("c", 3, scalar("f64")),
        ]),
      ),
    );

    expect(
      bytesToHex(
        encodeHotFieldData(manifest, {
          a: 0x1234,
          b: 0x01020304,
          c: 12.5,
        }),
      ),
    ).toBe("34120000040302010000000000002940");
  });

  it("encodes FixedEnum by ordinal and decodes to the variant label", () => {
    const manifest = unwrap(
      planHotLayoutManifest(
        input([
          field("health", 1, {
            kind: "FixedEnum",
            storage: "u16",
            variants: ["ok", "warn", "fail"],
          }),
        ]),
      ),
    );
    const fieldBytes = encodeHotFieldData(manifest, { health: "fail" });

    expect(bytesToHex(fieldBytes)).toBe("0200000000000000");
    expect(decodeHotFieldValues(manifest, fieldBytes).values).toEqual({ health: "fail" });
  });

  it("encodes BoundedArray as a u32 live count followed by live f32 elements", () => {
    const manifest = unwrap(
      planHotLayoutManifest(
        input(
          [field("peaks", 1, { kind: "BoundedArray", elementType: "f32", maxLength: 3 })],
          ["peaks"],
        ),
      ),
    );
    const fieldBytes = encodeHotFieldData(manifest, { peaks: [0.125, 0.5] });

    expect(bytesToHex(fieldBytes)).toBe("020000000000003e0000003f00000000");
    expect(decodeHotFieldValues(manifest, fieldBytes).values).toEqual({
      peaks: [0.125, 0.5],
    });
  });

  it("changes the byte output when a sample value changes", () => {
    const layout = hotBasicLayout();
    const baseline = bytesToHex(encodeHotFieldData(layout, HOT_BASIC_SAMPLE_VALUES));
    const changed = bytesToHex(
      encodeHotFieldData(layout, {
        ...HOT_BASIC_SAMPLE_VALUES,
        level: 0.5,
      }),
    );

    expect(changed).not.toBe(baseline);
  });

  it("fails explicitly for unsupported or invalid field values", () => {
    expectHotByteCodecError(() =>
      encodeHotFieldData(hotBasicLayout(), { ...HOT_BASIC_SAMPLE_VALUES, health: "bad" }),
    );
    expectHotByteCodecError(() =>
      encodeHotFieldData(hotBasicLayout(), {
        ...HOT_BASIC_SAMPLE_VALUES,
        peaks: [0.125, 0.25, 0.5, 1],
      }),
    );

    const manifest = unwrap(
      planHotLayoutManifest(
        input(
          [
            field("lookup", 1, {
              kind: "BoundedMap",
              keyEncoding: "fixed-ascii",
              keyByteLength: 4,
              valueShape: { kind: "FixedScalar", type: "f32" },
              maxEntries: 1,
            }),
          ],
          ["lookup"],
        ),
      ),
    );

    expectHotByteCodecError(() => encodeHotFieldData(manifest, { lookup: [] }));
  });

  it("does not introduce runtime retry, Atomics, SAB lifecycle, or handle APIs", () => {
    const text = sourceText(hotCodecSourceRoot);

    expect(text).not.toContain("Atomics");
    expect(text).not.toContain("SharedArrayBuffer");
    expect(text).not.toContain("retry");
    expect(text).not.toContain("handle");
    expect("createHotReader" in hotCodec).toBe(false);
    expect("createHotWriter" in hotCodec).toBe(false);
    expect("openHotBinding" in hotCodec).toBe(false);
  });
});

describe("@seqlok/hot-codec complete fixture region", () => {
  function encodeHotBasicCompleteFixtureRegion(): Uint8Array {
    return encodeHotCompleteFixtureRegion(hotBasicLayout(), {
      blockA: HOT_BASIC_BLOCK_A_INPUT,
      blockB: HOT_BASIC_BLOCK_B_INPUT,
      values: HOT_BASIC_SAMPLE_VALUES,
    });
  }

  it("returns exactly manifest.totalRegionByteLength bytes", () => {
    const manifest = hotBasicLayout();
    const bytes = encodeHotBasicCompleteFixtureRegion();

    expect(bytes.byteLength).toBe(manifest.totalRegionByteLength);
  });

  it("places Block A, Block B, and field data in the ABI offsets", () => {
    const bytes = encodeHotBasicCompleteFixtureRegion();

    expect(bytesToHex(bytes.subarray(0, HOT_BLOCK_A_BYTE_LENGTH))).toBe(
      bytesToHex(encodeHotBlockAHeader(HOT_BASIC_BLOCK_A_INPUT)),
    );
    expect(bytesToHex(bytes.subarray(HOT_BLOCK_B_BYTE_OFFSET, HOT_BLOCK_B_END_OFFSET))).toBe(
      bytesToHex(encodeHotBlockBHeader(HOT_BASIC_BLOCK_B_INPUT)),
    );
    expect(bytesToHex(bytes.subarray(HOT_FIELD_DATA_BYTE_OFFSET))).toBe(
      bytesToHex(encodeHotFieldData(hotBasicLayout(), HOT_BASIC_SAMPLE_VALUES)),
    );
    expect(bytesToHex(bytes.subarray(HOT_FIELD_DATA_BYTE_OFFSET))).toBe(
      bytesToHex(encodeHotFieldValues(hotBasicLayout(), HOT_BASIC_SAMPLE_VALUES).fieldBytes),
    );
  });

  it("decodes the assembled Block A, Block B, and field-data slices", () => {
    const manifest = hotBasicLayout();
    const bytes = encodeHotBasicCompleteFixtureRegion();

    expect(decodeHotBlockAHeader(bytes.subarray(0, HOT_BLOCK_A_BYTE_LENGTH))).toMatchObject({
      hotLayoutVersion: HOT_BASIC_BLOCK_A_INPUT.hotLayoutVersion,
      fieldCount: HOT_BASIC_BLOCK_A_INPUT.fieldCount,
      mutableRegionByteLength: HOT_BASIC_BLOCK_A_INPUT.mutableRegionByteLength,
    });
    expect(
      decodeHotBlockBHeader(bytes.subarray(HOT_BLOCK_B_BYTE_OFFSET, HOT_BLOCK_B_END_OFFSET)),
    ).toEqual(HOT_BASIC_BLOCK_B_INPUT);
    expect(
      decodeHotFieldValues(manifest, bytes.subarray(HOT_FIELD_DATA_BYTE_OFFSET)).values,
    ).toEqual(HOT_BASIC_SAMPLE_VALUES);
  });

  it("rejects blockA contractKey mismatch with a typed issue code", () => {
    const error = expectHotByteCodecError(() =>
      encodeHotCompleteFixtureRegion(hotBasicLayout(), {
        blockA: { ...HOT_BASIC_BLOCK_A_INPUT, contractKey: "fixture.other" },
        blockB: HOT_BASIC_BLOCK_B_INPUT,
        values: HOT_BASIC_SAMPLE_VALUES,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain(
      "byte.fixtureRegionContractKeyMismatch",
    );
  });

  it("rejects blockA hotLayoutVersion mismatch with a typed issue code", () => {
    const error = expectHotByteCodecError(() =>
      encodeHotCompleteFixtureRegion(hotBasicLayout(), {
        blockA: { ...HOT_BASIC_BLOCK_A_INPUT, hotLayoutVersion: 0n },
        blockB: HOT_BASIC_BLOCK_B_INPUT,
        values: HOT_BASIC_SAMPLE_VALUES,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain(
      "header.hotLayoutVersionMismatch",
    );
  });

  it("rejects blockA fieldCount mismatch with a typed issue code", () => {
    const error = expectHotByteCodecError(() =>
      encodeHotCompleteFixtureRegion(hotBasicLayout(), {
        blockA: { ...HOT_BASIC_BLOCK_A_INPUT, fieldCount: 6 },
        blockB: HOT_BASIC_BLOCK_B_INPUT,
        values: HOT_BASIC_SAMPLE_VALUES,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain("header.fieldCountMismatch");
  });

  it("rejects blockA mutableRegionByteLength mismatch with a typed issue code", () => {
    const error = expectHotByteCodecError(() =>
      encodeHotCompleteFixtureRegion(hotBasicLayout(), {
        blockA: { ...HOT_BASIC_BLOCK_A_INPUT, mutableRegionByteLength: 65 },
        blockB: HOT_BASIC_BLOCK_B_INPUT,
        values: HOT_BASIC_SAMPLE_VALUES,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain(
      "header.mutableRegionByteLengthMismatch",
    );
  });

  it("does not introduce runtime reader, writer, seqlock retry, Atomics, SAB, or handle surfaces", () => {
    const text = sourceText(hotCodecSourceRoot);

    expect(text).not.toContain("Atomics");
    expect(text).not.toContain("SharedArrayBuffer");
    expect(text).not.toContain("retry");
    expect(text).not.toContain("runtime reader");
    expect(text).not.toContain("runtime writer");
    expect(text).not.toContain("handle");
    expect("createHotReader" in hotCodec).toBe(false);
    expect("createHotWriter" in hotCodec).toBe(false);
    expect("openHotBinding" in hotCodec).toBe(false);
  });
});

describe("@seqlok/hot-codec fixture artifact guard", () => {
  it("leaves hot-basic-v0 fixture artifacts unchanged", () => {
    const changedFixtureArtifacts = execFileSync(
      "git",
      ["diff", "--name-only", "--", "fixtures/projection-runtime/hot-basic-v0"],
      { cwd: repoRoot, encoding: "utf8" },
    ).trim();

    expect(changedFixtureArtifacts).toBe("");
  });
});

describe("@seqlok/hot-codec Block A header", () => {
  const validInput: HotBlockAHeaderInput = {
    contractKey: "fixture.hotBasic",
    instanceKey: "hot-basic-v0.instance",
    semanticVersion: 0x67b271f31c6b06a0n,
    hotLayoutVersion: 0x8f3eb897fd88495cn,
    fieldCount: 5,
    mutableRegionByteLength: 64,
  };

  it("encodeHotBlockAHeader returns exactly 72 bytes", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    expect(bytes.byteLength).toBe(72);
  });

  it("encoded bytes contain magic 53514c4b", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    expect(bytesToHex(bytes.subarray(0, 4))).toBe("53514c4b");
  });

  it("hotAbiVersion is encoded u32 little-endian", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(4, true)).toBe(1);
    expect(view.getUint32(4, false)).not.toBe(1);
  });

  it("semanticVersion and hotLayoutVersion are encoded u64 little-endian", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getBigUint64(40, true)).toBe(validInput.semanticVersion);
    expect(view.getBigUint64(48, true)).toBe(validInput.hotLayoutVersion);
  });

  it("contractKeyHash and instanceKeyHash are deterministic", () => {
    const first = encodeHotBlockAHeader(validInput);
    const second = encodeHotBlockAHeader(validInput);
    expect(bytesToHex(first.subarray(8, 24))).toBe(bytesToHex(second.subarray(8, 24)));
    expect(bytesToHex(first.subarray(24, 40))).toBe(bytesToHex(second.subarray(24, 40)));
  });

  it("fieldCount and mutableRegionByteLength are encoded u32 little-endian", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(56, true)).toBe(validInput.fieldCount);
    expect(view.getUint32(60, true)).toBe(validInput.mutableRegionByteLength);
  });

  it("reserved bytes are zero", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    expect(bytesToHex(bytes.subarray(64, 72))).toBe("0000000000000000");
  });

  it("decodeHotBlockAHeader round-trips the fixture", () => {
    const fixturePath = resolve(
      repoRoot,
      "fixtures/projection-runtime/hot-basic-v0/hot-block-a-fixture.json",
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
    const expected = fixture.expected as Record<string, unknown>;
    const decodedExpected = expected.decoded as Record<string, unknown>;
    const bytes = hexToBytes(expected.blockABytesHex as string);
    const decoded = decodeHotBlockAHeader(bytes);

    expect(decoded.regionMagicHex).toBe("53514c4b");
    expect(decoded.hotAbiVersion).toBe(1);
    expect(decoded.contractKeyHashHex).toBe(decodedExpected.contractKeyHashHex);
    expect(decoded.instanceKeyHashHex).toBe(decodedExpected.instanceKeyHashHex);
    expect(decoded.semanticVersion).toBe(BigInt(`0x${decodedExpected.semanticVersion}`));
    expect(decoded.hotLayoutVersion).toBe(BigInt(`0x${decodedExpected.hotLayoutVersion}`));
    expect(decoded.fieldCount).toBe(decodedExpected.fieldCount);
    expect(decoded.mutableRegionByteLength).toBe(decodedExpected.mutableRegionByteLength);
    expect(decoded.reservedHex).toBe("0000000000000000");
  });

  it("validateHotBlockAHeader succeeds for matching expected input", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    const result = validateHotBlockAHeader(bytes, validInput);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected validation to succeed");
    }
    expect(result.value.semanticVersion).toBe(validInput.semanticVersion);
  });

  it("rejects bad magic", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    bytes[0] = 0xde;
    expectHotByteCodecError(() => decodeHotBlockAHeader(bytes));
  });

  it("rejects unsupported hotAbiVersion", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(4, 2, true);
    expectHotByteCodecError(() => decodeHotBlockAHeader(bytes));
  });

  it("rejects non-zero reserved bytes", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    bytes[64] = 0xff;
    expectHotByteCodecError(() => decodeHotBlockAHeader(bytes));
  });

  it("fails validation for mismatched contractKey", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    const result = validateHotBlockAHeader(bytes, { ...validInput, contractKey: "other" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.error.details.issues.map((i) => i.code)).toContain(
      "header.contractKeyHashMismatch",
    );
  });

  it("fails validation for mismatched instanceKey", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    const result = validateHotBlockAHeader(bytes, { ...validInput, instanceKey: "other" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.error.details.issues.map((i) => i.code)).toContain(
      "header.instanceKeyHashMismatch",
    );
  });

  it("fails validation for mismatched semanticVersion", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    const result = validateHotBlockAHeader(bytes, { ...validInput, semanticVersion: 0n });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.error.details.issues.map((i) => i.code)).toContain(
      "header.semanticVersionMismatch",
    );
  });

  it("fails validation for mismatched hotLayoutVersion", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    const result = validateHotBlockAHeader(bytes, { ...validInput, hotLayoutVersion: 0n });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.error.details.issues.map((i) => i.code)).toContain(
      "header.hotLayoutVersionMismatch",
    );
  });

  it("fails validation for mismatched fieldCount", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    const result = validateHotBlockAHeader(bytes, { ...validInput, fieldCount: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.error.details.issues.map((i) => i.code)).toContain("header.fieldCountMismatch");
  });

  it("fails validation for mismatched mutableRegionByteLength", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    const result = validateHotBlockAHeader(bytes, { ...validInput, mutableRegionByteLength: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.error.details.issues.map((i) => i.code)).toContain(
      "header.mutableRegionByteLengthMismatch",
    );
  });

  it("rejects empty contractKey", () => {
    expectHotByteCodecError(() => encodeHotBlockAHeader({ ...validInput, contractKey: "" }));
  });

  it("rejects empty instanceKey", () => {
    expectHotByteCodecError(() => encodeHotBlockAHeader({ ...validInput, instanceKey: "" }));
  });

  it("rejects semanticVersion outside u64 range", () => {
    expectHotByteCodecError(() => encodeHotBlockAHeader({ ...validInput, semanticVersion: -1n }));
    expectHotByteCodecError(() =>
      encodeHotBlockAHeader({ ...validInput, semanticVersion: 0x1_0000_0000_0000_0000n }),
    );
  });

  it("rejects hotLayoutVersion outside u64 range", () => {
    expectHotByteCodecError(() => encodeHotBlockAHeader({ ...validInput, hotLayoutVersion: -1n }));
    expectHotByteCodecError(() =>
      encodeHotBlockAHeader({ ...validInput, hotLayoutVersion: 0x1_0000_0000_0000_0000n }),
    );
  });

  it("rejects fieldCount outside u32 range", () => {
    expectHotByteCodecError(() => encodeHotBlockAHeader({ ...validInput, fieldCount: -1 }));
    expectHotByteCodecError(() =>
      encodeHotBlockAHeader({ ...validInput, fieldCount: 0x1_0000_0000 }),
    );
  });

  it("rejects mutableRegionByteLength outside u32 range", () => {
    expectHotByteCodecError(() =>
      encodeHotBlockAHeader({ ...validInput, mutableRegionByteLength: -1 }),
    );
    expectHotByteCodecError(() =>
      encodeHotBlockAHeader({ ...validInput, mutableRegionByteLength: 0x1_0000_0000 }),
    );
  });
});

describe("@seqlok/hot-codec Block B header", () => {
  const validInput: HotBlockBHeaderInput = {
    seqlockCounter: 2n,
    baselineEpoch: 7,
    continuityGeneration: 3,
    publicationSequence: 42n,
  };

  it("encodeHotBlockBHeader returns exactly 24 bytes", () => {
    expect(encodeHotBlockBHeader(validInput).byteLength).toBe(24);
  });

  it("seqlockCounter is encoded u64 little-endian", () => {
    const bytes = encodeHotBlockBHeader({ ...validInput, seqlockCounter: 0x0102_0304_0506_0708n });
    expect(bytesToHex(bytes.subarray(0, 8))).toBe("0807060504030201");
  });

  it("baselineEpoch is encoded u32 little-endian", () => {
    const bytes = encodeHotBlockBHeader({ ...validInput, baselineEpoch: 0x0102_0304 });
    expect(bytesToHex(bytes.subarray(8, 12))).toBe("04030201");
  });

  it("continuityGeneration is encoded u32 little-endian", () => {
    const bytes = encodeHotBlockBHeader({ ...validInput, continuityGeneration: 0x0102_0304 });
    expect(bytesToHex(bytes.subarray(12, 16))).toBe("04030201");
  });

  it("publicationSequence is encoded u64 little-endian", () => {
    const bytes = encodeHotBlockBHeader({
      ...validInput,
      publicationSequence: 0x0102_0304_0506_0708n,
    });
    expect(bytesToHex(bytes.subarray(16, 24))).toBe("0807060504030201");
  });

  it("decodeHotBlockBHeader round-trips the fixture", () => {
    const fixturePath = resolve(
      repoRoot,
      "fixtures/projection-runtime/hot-basic-v0/hot-block-b-fixture.json",
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
    const expected = fixture.expected as Record<string, unknown>;
    const decodedExpected = expected.decoded as Record<string, unknown>;
    const decoded = decodeHotBlockBHeader(hexToBytes(expected.blockBBytesHex as string));

    expect(decoded.seqlockCounter).toBe(BigInt(`0x${decodedExpected.seqlockCounter}`));
    expect(decoded.baselineEpoch).toBe(decodedExpected.baselineEpoch);
    expect(decoded.continuityGeneration).toBe(decodedExpected.continuityGeneration);
    expect(decoded.publicationSequence).toBe(BigInt(`0x${decodedExpected.publicationSequence}`));
  });

  it("validateHotBlockBHeader succeeds for matching expected input", () => {
    const bytes = encodeHotBlockBHeader(validInput);
    const result = validateHotBlockBHeader(bytes, validInput);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected validation to succeed");
    }
    expect(result.value.publicationSequence).toBe(validInput.publicationSequence);
  });

  it("rejects wrong byte length with typed issue code header.blockBByteLengthInvalid", () => {
    const error = expectHotByteCodecError(() => decodeHotBlockBHeader(new Uint8Array(23)));
    expect(error.details.issues.map((i) => i.code)).toContain("header.blockBByteLengthInvalid");
  });

  it("rejects out-of-range u64 and u32 inputs with typed issue codes", () => {
    expect(
      expectHotByteCodecError(() =>
        encodeHotBlockBHeader({ ...validInput, seqlockCounter: -1n }),
      ).details.issues.map((i) => i.code),
    ).toContain("header.seqlockCounterOutOfRange");
    expect(
      expectHotByteCodecError(() =>
        encodeHotBlockBHeader({ ...validInput, publicationSequence: 0x1_0000_0000_0000_0000n }),
      ).details.issues.map((i) => i.code),
    ).toContain("header.publicationSequenceOutOfRange");
    expect(
      expectHotByteCodecError(() =>
        encodeHotBlockBHeader({ ...validInput, baselineEpoch: 0x1_0000_0000 }),
      ).details.issues.map((i) => i.code),
    ).toContain("header.baselineEpochOutOfRange");
    expect(
      expectHotByteCodecError(() =>
        encodeHotBlockBHeader({ ...validInput, continuityGeneration: -1 }),
      ).details.issues.map((i) => i.code),
    ).toContain("header.continuityGenerationOutOfRange");
  });

  it("rejects validation mismatches with typed issue codes", () => {
    const bytes = encodeHotBlockBHeader(validInput);
    const result = validateHotBlockBHeader(bytes, {
      seqlockCounter: 4n,
      baselineEpoch: 8,
      continuityGeneration: 9,
      publicationSequence: 43n,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.error.details.issues.map((i) => i.code).sort()).toEqual([
      "header.baselineEpochMismatch",
      "header.continuityGenerationMismatch",
      "header.publicationSequenceMismatch",
      "header.seqlockCounterMismatch",
    ]);
  });
});

describe("@seqlok/hot-codec error model", () => {
  const validInput: HotBlockAHeaderInput = {
    contractKey: "fixture.hotBasic",
    instanceKey: "hot-basic-v0.instance",
    semanticVersion: 0x67b271f31c6b06a0n,
    hotLayoutVersion: 0x8f3eb897fd88495cn,
    fieldCount: 5,
    mutableRegionByteLength: 64,
  };

  it("hot layout errors are SeqlokError values with code hotCodec.layoutRejected", () => {
    const error = expectFailure(
      planHotLayoutManifest(input([field("tempo", 1, scalar("f64"))], ["missing"])),
    );
    expect(error.code).toBe("hotCodec.layoutRejected");
    expect(error).toBeInstanceOf(SeqlokError);
  });

  it("hot byte errors are SeqlokError values with code hotCodec.byteRejected", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    bytes[0] = 0xde;
    const error = expectHotByteCodecError(() => decodeHotBlockAHeader(bytes));
    expect(error).toBeInstanceOf(SeqlokError);
    expect(error.code).toBe("hotCodec.byteRejected");
  });

  it("bad magic returns typed issue code header.magicInvalid", () => {
    const bytes = encodeHotBlockAHeader(validInput);
    bytes[0] = 0xde;
    const error = expectHotByteCodecError(() => decodeHotBlockAHeader(bytes));
    expect(error.details.issues.map((i) => i.code)).toContain("header.magicInvalid");
  });

  it("has no production generic Error subclass construction", () => {
    const text = guardedProductionSourceText();
    expect(text).not.toContain("throw new Error");
    expect(text).not.toContain("throw new RangeError");
    expect(text).not.toContain("throw new TypeError");
  });

  it("has no production code: string in issue types", () => {
    const text = guardedProductionSourceText();
    expect(text).not.toMatch(/code\s*:\s*string/);
  });

  it("has no production runtime hot-codec error subclasses or subclass checks", () => {
    const text = guardedProductionSourceText();
    expect(text).not.toMatch(
      /class HotCodecError|class HotByteCodecError|class CompilerError|class ConformanceError/,
    );
    expect(text).not.toMatch(
      /instanceof HotCodecError|instanceof HotByteCodecError|instanceof CompilerError|instanceof ConformanceError/,
    );
  });

  it("does not duplicate HOT_REGION_MAGIC_BYTES definition outside constants", () => {
    const text = sourceText(hotCodecSourceRoot);
    const definitions = [...text.matchAll(/(?:export\s+)?const\s+HOT_REGION_MAGIC_BYTES/g)];
    expect(definitions.length).toBe(1);
  });
});

describe("@seqlok/hot-codec rejections", () => {
  it("rejects unsupported hot codec names", () => {
    const error = expectFailure(
      planHotLayoutManifest({
        ...input([field("tempo", 1, scalar("f64"))]),
        hot: { codec: "other", reservations: [] },
      } as unknown as HotLayoutPlanningInput),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain("hot.codecUnsupported");
  });

  it("rejects VariableString for hot layout", () => {
    const error = expectFailure(
      planHotLayoutManifest(input([field("flags", 1, { kind: "VariableString" })])),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain(
      "shape.variableStringUnsupported",
    );
  });

  it("rejects VariableMap for hot layout", () => {
    const error = expectFailure(
      planHotLayoutManifest(
        input([
          field("lookup", 1, {
            kind: "VariableMap",
            valueShape: { kind: "FixedScalar", type: "f64" },
          }),
        ]),
      ),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain(
      "shape.variableMapUnsupported",
    );
  });

  it("rejects unreserved BoundedArray fields", () => {
    const error = expectFailure(
      planHotLayoutManifest(
        input([field("peaks", 1, { kind: "BoundedArray", elementType: "f32", maxLength: 8 })]),
      ),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain("field.hotNotAdmissible");
  });

  it("rejects unreserved BoundedMap fields", () => {
    const error = expectFailure(
      planHotLayoutManifest(
        input([
          field("lookup", 1, {
            kind: "BoundedMap",
            keyEncoding: "fixed-ascii",
            keyByteLength: 4,
            valueShape: { kind: "FixedScalar", type: "f32" },
            maxEntries: 4,
          }),
        ]),
      ),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain("field.hotNotAdmissible");
  });

  it("rejects reservations for missing fields", () => {
    const error = expectFailure(
      planHotLayoutManifest(input([field("tempo", 1, scalar("f64"))], ["missing"])),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain("reservation.unknownField");
  });

  it("rejects reservations for non-bounded fields", () => {
    const error = expectFailure(
      planHotLayoutManifest(input([field("tempo", 1, scalar("f64"))], ["tempo"])),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain("reservation.wrongShape");
  });

  it("rejects duplicate dotPaths", () => {
    const error = expectFailure(
      planHotLayoutManifest(
        input([field("tempo", 1, scalar("f64")), field("tempo", 2, scalar("f64"))]),
      ),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain("field.duplicateDotPath");
  });

  it("rejects duplicate fieldIds", () => {
    const error = expectFailure(
      planHotLayoutManifest(
        input([field("phase", 1, scalar("f64")), field("tempo", 1, scalar("f64"))]),
      ),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain("field.duplicateFieldId");
  });

  it("rejects unsupported shape kinds explicitly", () => {
    const error = expectFailure(
      planHotLayoutManifest(
        input([field("tempo", 1, { kind: "Mystery" } as unknown as HotLayoutPlanningShape)]),
      ),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain("shape.unknownKind");
  });
});

describe("@seqlok/hot-codec public surface", () => {
  it("keeps src/byte.ts as the public byte facade", () => {
    expect(Object.keys(hotByte).sort()).toEqual([
      "bytesToHex",
      "decodeHotFieldValues",
      "encodeHotFieldData",
      "encodeHotFieldValues",
      "encodeHotFixtureRegion",
      "hexToBytes",
    ]);

    const byteSource = readFileSync(resolve(hotCodecSourceRoot, "byte.ts"), "utf8");
    expect(byteSource).toContain('export { bytesToHex, hexToBytes } from "./byte/hex"');
    expect(byteSource).toContain('} from "./byte/types"');
    expect(byteSource).not.toContain("function writeScalar");
    expect(byteSource).not.toContain("function readScalar");
    expect(byteSource).not.toContain("function writeEnum");
    expect(byteSource).not.toContain("function readEnum");
    expect(byteSource).not.toContain("function writeVector");
    expect(byteSource).not.toContain("function readVector");
    expect(byteSource).not.toContain("function writeFixedString");
    expect(byteSource).not.toContain("function readFixedString");
    expect(byteSource).not.toContain("function writeBoundedArray");
    expect(byteSource).not.toContain("function readBoundedArray");
  });

  it("keeps byte type definitions separate from runtime issue helpers", () => {
    const byteTypesSource = readFileSync(resolve(hotCodecSourceRoot, "byte/types.ts"), "utf8");
    const byteIssueSource = readFileSync(resolve(hotCodecSourceRoot, "byte/issue.ts"), "utf8");

    expect(byteTypesSource).not.toContain("../error");
    expect(byteTypesSource).not.toContain("throwByteIssue");
    expect(byteIssueSource).toContain("export function throwByteIssue");
  });

  it("keeps byte public types equivalent through the root export", () => {
    expectTypeOf<PublicByteDecodeResult>().toEqualTypeOf<HotByteDecodeResult>();
    expectTypeOf<PublicByteEncodeResult>().toEqualTypeOf<HotByteEncodeResult>();
    expectTypeOf<PublicByteFieldScalarValue>().toEqualTypeOf<HotFieldScalarValue>();
    expectTypeOf<PublicByteFieldValue>().toEqualTypeOf<HotFieldValue>();
    expectTypeOf<PublicByteFieldValues>().toEqualTypeOf<HotFieldValues>();
  });

  it("exports only the intended runtime API values", () => {
    expect(Object.keys(hotCodec).sort()).toEqual([
      "HOT_ABI_VERSION",
      "HOT_BASELINE_EPOCH_U32_OFFSET",
      "HOT_BLOCK_A_BYTE_LENGTH",
      "HOT_BLOCK_B_BYTE_LENGTH",
      "HOT_BLOCK_B_BYTE_OFFSET",
      "HOT_BLOCK_B_END_OFFSET",
      "HOT_CODEC_ERRORS",
      "HOT_CODEC_ISSUE_DEFS",
      "HOT_CONTINUITY_GENERATION_U32_OFFSET",
      "HOT_FIELD_DATA_BYTE_OFFSET",
      "HOT_PUBLICATION_SEQUENCE_U64_OFFSET",
      "HOT_REGION_MAGIC_BYTES",
      "HOT_SEQLOCK_U64_OFFSET",
      "bytesToHex",
      "createHotByteRejectedError",
      "createHotCodecError",
      "createHotCodecIssue",
      "createHotLayoutRejectedError",
      "decodeHotBlockAHeader",
      "decodeHotBlockBHeader",
      "decodeHotFieldValues",
      "deriveHotLayoutVersion",
      "encodeHotBlockAHeader",
      "encodeHotBlockBHeader",
      "encodeHotCompleteFixtureRegion",
      "encodeHotFieldData",
      "encodeHotFieldValues",
      "encodeHotFixtureRegion",
      "hexToBytes",
      "isHotCodecError",
      "planHotLayoutManifest",
      "validateHotBlockAHeader",
      "validateHotBlockBHeader",
    ]);

    expect("HotByteCodecError" in hotCodec).toBe(false);
    expect("HotCodecError" in hotCodec).toBe(false);

    for (const runtimeExport of [
      "createHotReader",
      "createHotWriter",
      "openHotBinding",
      "createHotHandle",
      "compileAuthoredProjectionContract",
      "emitHotLayoutManifest",
      "createElectronAdapter",
      "Atomics",
      "SharedArrayBuffer",
      "core",
    ]) {
      expect(runtimeExport in hotCodec).toBe(false);
    }
  });

  it("exports the intended type surface", () => {
    expectTypeOf<HotCodecError["code"]>().toEqualTypeOf<"hotCodec.layoutRejected">();
    expectTypeOf<HotByteCodecError["code"]>().toEqualTypeOf<"hotCodec.byteRejected">();
    expectTypeOf<HotLayoutPlanningShape["kind"]>().toEqualTypeOf<
      | "FixedScalar"
      | "FixedEnum"
      | "FixedVector"
      | "FixedStringEncoded"
      | "BoundedArray"
      | "BoundedMap"
      | "VariableString"
      | "VariableMap"
    >();
  });
});
