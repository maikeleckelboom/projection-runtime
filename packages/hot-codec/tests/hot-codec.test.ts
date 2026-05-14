import { describe, expect, expectTypeOf, it } from "vitest";

import * as hotCodec from "../src/index";
import {
  deriveHotLayoutVersion,
  HOT_BASELINE_EPOCH_U32_OFFSET,
  HOT_BLOCK_A_BYTE_LENGTH,
  HOT_BLOCK_B_BYTE_OFFSET,
  HOT_CONTINUITY_GENERATION_U32_OFFSET,
  HOT_FIELD_DATA_BYTE_OFFSET,
  HOT_PUBLICATION_SEQUENCE_U64_OFFSET,
  HOT_SEQLOCK_U64_OFFSET,
  HotCodecError,
  type HotLayoutManifest,
  type HotLayoutPlanningField,
  type HotLayoutPlanningInput,
  type HotLayoutPlanningShape,
  type HotLayoutPlanResult,
  type HotLayoutPlanSuccess,
  planHotLayoutManifest,
} from "../src/index";

function unwrap(result: HotLayoutPlanResult): HotLayoutManifest {
  expect(result.ok).toBe(true);
  return (result as HotLayoutPlanSuccess).value;
}

function expectFailure(result: HotLayoutPlanResult): HotCodecError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected hot-codec failure");
  }

  expect(result.error).toBeInstanceOf(HotCodecError);
  expect(result.error.code).toBe("hotCodec.layoutRejected");
  expect(result.error.details.issueCount).toBe(result.error.issues.length);
  return result.error;
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

describe("@seqlok/hot-codec constants", () => {
  it("exports fixed Block A and Block B offsets", () => {
    expect(HOT_BLOCK_A_BYTE_LENGTH).toBe(72);
    expect(HOT_BLOCK_B_BYTE_OFFSET).toBe(72);
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

    expect(error.issues.map((issue) => issue.code)).toContain("field.orderInvalid");
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

describe("@seqlok/hot-codec rejections", () => {
  it("rejects unsupported hot codec names", () => {
    const error = expectFailure(
      planHotLayoutManifest({
        ...input([field("tempo", 1, scalar("f64"))]),
        hot: { codec: "other", reservations: [] },
      } as unknown as HotLayoutPlanningInput),
    );

    expect(error.issues.map((issue) => issue.code)).toContain("hot.codecUnsupported");
  });

  it("rejects VariableString for hot layout", () => {
    const error = expectFailure(
      planHotLayoutManifest(input([field("flags", 1, { kind: "VariableString" })])),
    );

    expect(error.issues.map((issue) => issue.code)).toContain("shape.variableStringUnsupported");
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

    expect(error.issues.map((issue) => issue.code)).toContain("shape.variableMapUnsupported");
  });

  it("rejects unreserved BoundedArray fields", () => {
    const error = expectFailure(
      planHotLayoutManifest(
        input([field("peaks", 1, { kind: "BoundedArray", elementType: "f32", maxLength: 8 })]),
      ),
    );

    expect(error.issues.map((issue) => issue.code)).toContain("field.hotNotAdmissible");
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

    expect(error.issues.map((issue) => issue.code)).toContain("field.hotNotAdmissible");
  });

  it("rejects reservations for missing fields", () => {
    const error = expectFailure(
      planHotLayoutManifest(input([field("tempo", 1, scalar("f64"))], ["missing"])),
    );

    expect(error.issues.map((issue) => issue.code)).toContain("reservation.unknownField");
  });

  it("rejects reservations for non-bounded fields", () => {
    const error = expectFailure(
      planHotLayoutManifest(input([field("tempo", 1, scalar("f64"))], ["tempo"])),
    );

    expect(error.issues.map((issue) => issue.code)).toContain("reservation.wrongShape");
  });

  it("rejects duplicate dotPaths", () => {
    const error = expectFailure(
      planHotLayoutManifest(
        input([field("tempo", 1, scalar("f64")), field("tempo", 2, scalar("f64"))]),
      ),
    );

    expect(error.issues.map((issue) => issue.code)).toContain("field.duplicateDotPath");
  });

  it("rejects duplicate fieldIds", () => {
    const error = expectFailure(
      planHotLayoutManifest(
        input([field("phase", 1, scalar("f64")), field("tempo", 1, scalar("f64"))]),
      ),
    );

    expect(error.issues.map((issue) => issue.code)).toContain("field.duplicateFieldId");
  });

  it("rejects unsupported shape kinds explicitly", () => {
    const error = expectFailure(
      planHotLayoutManifest(
        input([field("tempo", 1, { kind: "Mystery" } as unknown as HotLayoutPlanningShape)]),
      ),
    );

    expect(error.issues.map((issue) => issue.code)).toContain("shape.unknownKind");
  });
});

describe("@seqlok/hot-codec public surface", () => {
  it("exports only the intended runtime API values", () => {
    expect(Object.keys(hotCodec).sort()).toEqual([
      "HOT_ABI_VERSION",
      "HOT_BASELINE_EPOCH_U32_OFFSET",
      "HOT_BLOCK_A_BYTE_LENGTH",
      "HOT_BLOCK_B_BYTE_OFFSET",
      "HOT_CONTINUITY_GENERATION_U32_OFFSET",
      "HOT_FIELD_DATA_BYTE_OFFSET",
      "HOT_PUBLICATION_SEQUENCE_U64_OFFSET",
      "HOT_SEQLOCK_U64_OFFSET",
      "HotCodecError",
      "deriveHotLayoutVersion",
      "planHotLayoutManifest",
    ]);

    for (const runtimeExport of [
      "createHotReader",
      "createHotWriter",
      "openHotBinding",
      "compileAuthoredProjectionContract",
      "emitHotLayoutManifest",
      "createElectronAdapter",
      "core",
    ]) {
      expect(runtimeExport in hotCodec).toBe(false);
    }
  });

  it("exports the intended type surface", () => {
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
