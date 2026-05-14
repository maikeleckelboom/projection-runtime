import { type AuthoredProjectionContract, SchemaValidationError } from "@seqlok/schema";
import { describe, expect, expectTypeOf, it } from "vitest";
import { compileAuthoredProjectionContractWithOptions } from "../src/compile";
import * as compiler from "../src/index";
import {
  type CanonicalFieldShape,
  type CompileProjectionResult,
  type CompileProjectionSuccess,
  CompilerError,
  compileAuthoredProjectionContract,
  type ResolvedProjectionContract,
} from "../src/index";

function unwrap(result: CompileProjectionResult): ResolvedProjectionContract {
  expect(result.ok).toBe(true);
  return (result as CompileProjectionSuccess).value;
}

function expectFailure(result: CompileProjectionResult): CompilerError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected compiler failure");
  }

  return result.error;
}

describe("@seqlok/compiler happy path", () => {
  it("compiles a minimal authored projection contract", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
      }),
    );

    expect(resolved.manifest.key).toBe("deck.runtime");
    expect(resolved.manifest.fields).toHaveLength(1);
    expect(resolved.manifest.fields[0]).toMatchObject({
      dotPath: "tempo",
      shape: { kind: "FixedScalar", type: "f64" },
    });
    expectTypeOf(resolved.semanticVersion).toEqualTypeOf<bigint>();
  });

  it("sorts fields lexicographically by dotPath", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          zed: { kind: "fixed-scalar", type: "u32" },
          group: {
            beta: { kind: "fixed-scalar", type: "u32" },
          },
          alpha: { kind: "fixed-scalar", type: "u32" },
        },
      }),
    );

    expect(resolved.manifest.fields.map((field) => field.dotPath)).toEqual([
      "alpha",
      "group.beta",
      "zed",
    ]);
  });

  it("does not let input object insertion order affect output manifest", () => {
    const left = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        revisionNote: "left note",
        fields: {
          zed: { kind: "fixed-scalar", type: "u32" },
          alpha: { kind: "fixed-scalar", type: "u32" },
        },
      }),
    );
    const right = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        revisionNote: "right note",
        fields: {
          alpha: { kind: "fixed-scalar", type: "u32" },
          zed: { kind: "fixed-scalar", type: "u32" },
        },
      }),
    );

    expect(right.manifest).toEqual(left.manifest);
    expect(right.semanticVersion).toBe(left.semanticVersion);
  });

  it("derives a deterministic semanticVersion for semantically identical input", () => {
    const contract = {
      key: "deck.runtime",
      family: "replaceable-snapshot",
      fields: {
        tempo: { kind: "fixed-scalar", type: "f64" },
        playing: { kind: "fixed-scalar", type: "bool" },
      },
      lanes: {
        warm: { codec: "framed-snapshot" },
      },
    } satisfies AuthoredProjectionContract;

    const first = unwrap(compileAuthoredProjectionContract(contract));
    const second = unwrap(compileAuthoredProjectionContract(contract));

    expect(first.semanticVersion).toBe(second.semanticVersion);
  });

  it("changes semanticVersion when nanSentinel changes", () => {
    const withoutNanSentinel = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
      }),
    );
    const withNanSentinel = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64", nanSentinel: true },
        },
      }),
    );

    expect(withNanSentinel.manifest).not.toEqual(withoutNanSentinel.manifest);
    expect(withNanSentinel.semanticVersion).not.toBe(withoutNanSentinel.semanticVersion);
  });

  it("preserves enum variant order", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          source: {
            kind: "fixed-enum",
            variants: ["link", "midi", "internal"],
            storage: "u8",
          },
        },
      }),
    );

    expect(resolved.manifest.fields[0]?.shape).toMatchObject({
      kind: "FixedEnum",
      variants: ["link", "midi", "internal"],
    });
  });
});

describe("@seqlok/compiler schema boundary", () => {
  it("returns compiler failure for a structurally invalid authored contract", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({} as AuthoredProjectionContract),
    );

    expect(error).toBeInstanceOf(CompilerError);
    expect(error.issues.map((issue) => issue.code)).toContain("schema.invalid");
  });

  it("keeps CompilerError distinct from SchemaValidationError", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({} as AuthoredProjectionContract),
    );

    expect(error).toBeInstanceOf(CompilerError);
    expect(error).not.toBeInstanceOf(SchemaValidationError);
  });
});

describe("@seqlok/compiler field ids", () => {
  it("derives deterministic field ids", () => {
    const first = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
      }),
    );
    const second = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
      }),
    );

    expect(second.manifest.fields[0]?.fieldId).toBe(first.manifest.fields[0]?.fieldId);
  });

  it("rejects field id collisions", () => {
    const error = expectFailure(
      compileAuthoredProjectionContractWithOptions(
        {
          key: "deck.runtime",
          family: "replaceable-snapshot",
          fields: {
            alpha: { kind: "fixed-scalar", type: "u32" },
            beta: { kind: "fixed-scalar", type: "u32" },
          },
        },
        { fieldIdDeriver: () => 7 },
      ),
    );

    expect(error.issues.map((issue) => issue.code)).toContain("field.fieldIdCollision");
  });
});

describe("@seqlok/compiler lane admissibility", () => {
  it("accepts a hot lane for a fixed scalar field", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
        lanes: {
          hot: {},
        },
      }),
    );

    expect(resolved.manifest.lanes.hot).toEqual({
      codec: "mapped-fixed",
      reservations: [],
    });
  });

  it("rejects a hot lane for a variable string field", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          title: { kind: "variable-string" },
        },
        lanes: {
          hot: {},
        },
      }),
    );

    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "lane.hotFieldNotAdmissible",
          path: "fields.title",
        }),
      ]),
    );
  });

  it("rejects unreserved bounded arrays and maps on the hot lane", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          samples: { kind: "bounded-array", elementType: "f32", maxLength: 8 },
          lookup: {
            kind: "bounded-map",
            keyEncoding: "fixed-ascii",
            keyByteLength: 8,
            valueShape: { kind: "fixed-scalar", type: "u32" },
            maxEntries: 4,
          },
        },
        lanes: {
          hot: {},
        },
      }),
    );

    expect(
      error.issues.filter((issue) => issue.code === "lane.hotFieldNotAdmissible"),
    ).toHaveLength(2);
  });

  it("accepts reserved bounded arrays and maps on the hot lane", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          samples: { kind: "bounded-array", elementType: "f32", maxLength: 8 },
          lookup: {
            kind: "bounded-map",
            keyEncoding: "fixed-ascii",
            keyByteLength: 8,
            valueShape: { kind: "fixed-scalar", type: "u32" },
            maxEntries: 4,
          },
        },
        lanes: {
          hot: {
            reservations: ["lookup", "samples"],
          },
        },
      }),
    );

    expect(resolved.manifest.lanes.hot?.reservations).toEqual(["lookup", "samples"]);
  });

  it("rejects reservations for fields that do not exist", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
        lanes: {
          hot: {
            reservations: ["missing"],
          },
        },
      }),
    );

    expect(error.issues.map((issue) => issue.code)).toContain("lane.hotReservationUnknownField");
  });

  it("rejects reservations for non-bounded fields", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
        lanes: {
          hot: {
            reservations: ["tempo"],
          },
        },
      }),
    );

    expect(error.issues.map((issue) => issue.code)).toContain("lane.hotReservationWrongShape");
  });

  it("deduplicates reservation mechanisms in canonical output", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          samples: {
            kind: "bounded-array",
            elementType: "f32",
            maxLength: 8,
            hotReservation: true,
          },
        },
        lanes: {
          hot: {
            reservations: ["samples", "samples"],
          },
        },
      }),
    );

    expect(resolved.manifest.lanes.hot?.reservations).toEqual(["samples"]);
  });

  it("rejects field-local hot reservations without a hot lane", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          samples: {
            kind: "bounded-array",
            elementType: "f32",
            maxLength: 8,
            hotReservation: true,
          },
        },
      }),
    );

    expect(error.issues.map((issue) => issue.code)).toContain("lane.hotReservationWithoutHotLane");
  });
});

describe("@seqlok/compiler warm and cold", () => {
  it("retains and canonicalizes warm declarations without byte encoding", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          title: { kind: "variable-string" },
        },
        lanes: {
          warm: {},
        },
      }),
    );

    expect(resolved.manifest.lanes.warm).toEqual({ codec: "framed-snapshot" });
    expect("warmCodecVersion" in resolved).toBe(false);
  });

  it("retains cold declarations without producing coldCodecVersion", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          title: { kind: "variable-string" },
        },
        lanes: {
          cold: { materialization: "latest-snapshot" },
        },
      }),
    );

    expect(resolved.manifest.lanes.cold).toEqual({ materialization: "latest-snapshot" });
    expect("coldCodecVersion" in resolved).toBe(false);
  });
});

describe("@seqlok/compiler public surface", () => {
  it("exports only the intended runtime API", () => {
    expect(Object.keys(compiler).sort()).toEqual([
      "CompilerError",
      "compileAuthoredProjectionContract",
    ]);

    for (const runtimeExport of [
      "compileAuthoredProjectionContractWithOptions",
      "deriveSemanticVersion",
      "deriveFieldId",
      "normalizeSpecAst",
      "core",
      "createRuntimeBinding",
    ]) {
      expect(runtimeExport in compiler).toBe(false);
    }
  });

  it("exports the intended compiler type surface", () => {
    expectTypeOf<CanonicalFieldShape["kind"]>().toEqualTypeOf<
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
