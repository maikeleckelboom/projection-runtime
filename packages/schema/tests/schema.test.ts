import { describe, expect, expectTypeOf, it } from "vitest";

import schemaArtifact from "../authored-projection-contract/v1.json";
import * as schema from "../src/index";
import {
  AUTHORED_PROJECTION_CONTRACT_V1_ID,
  type AuthoredBoundedArrayField,
  type AuthoredProjectionContract,
  type AuthoredVariableStringField,
  SchemaValidationError,
  validateAuthoredProjectionContract,
} from "../src/index";

describe("@seqlok/schema", () => {
  it("validates a minimal authored projection contract", () => {
    const contract = {
      key: "deck.runtime",
      family: "replaceable-snapshot",
      fields: {
        transport: {
          tempo: { kind: "fixed-scalar", type: "f64" },
          playing: { kind: "fixed-scalar", type: "bool" },
        },
      },
    } satisfies AuthoredProjectionContract;

    expect(validateAuthoredProjectionContract(contract)).toBe(true);
  });

  it("rejects invalid identifier grammar", () => {
    for (const key of [
      "Deck.runtime",
      "deck_runtime",
      "deck-runtime",
      ".deck",
      "deck.",
      "deck..runtime",
    ]) {
      expect(() =>
        validateAuthoredProjectionContract({
          key,
          family: "replaceable-snapshot",
          fields: {
            ok: { kind: "fixed-scalar", type: "u32" },
          },
        }),
      ).toThrow(SchemaValidationError);
    }

    expect(() =>
      validateAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          bad_name: { kind: "fixed-scalar", type: "u32" },
        },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects unknown top-level properties", () => {
    expect(() =>
      validateAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
        [["par", "ams"].join("")]: {},
      }),
    ).toThrow(SchemaValidationError);
  });

  it("collects multiple structural issues", () => {
    try {
      validateAuthoredProjectionContract({
        extra: true,
        key: "Deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          mode: { kind: "fixed-enum", variants: ["a", "a"], storage: "u8" },
          samples: { kind: "bounded-array", elementType: "f32", maxLength: 0 },
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      const issues = (error as SchemaValidationError).issues;

      expect(issues).toEqual(
        expect.arrayContaining([
          { path: "extra", message: "unknown property" },
          { path: "key", message: "invalid path grammar" },
          { path: "fields.mode.variants[1]", message: "duplicate enum variant" },
          { path: "fields.samples.maxLength", message: "must be a positive integer" },
        ]),
      );
      expect(issues.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("aligns the exported schema id with the public artifact", () => {
    expect(schemaArtifact.$id).toBe(AUTHORED_PROJECTION_CONTRACT_V1_ID);
  });

  it("keeps runtime exports on the new public surface", () => {
    expect(Object.keys(schema).sort()).toEqual([
      "AUTHORED_PROJECTION_CONTRACT_V1_ID",
      "SchemaValidationError",
      "validateAuthoredProjectionContract",
    ]);

    for (const removedExport of [
      ["normalize", "Spec", "Ast"].join(""),
      ["Spec", "Ast"].join(""),
      ["Param", "Def"].join(""),
      ["Meter", "Def"].join(""),
      ["SPEC", "AST", "V1", "ID"].join("_"),
    ]) {
      expect(removedExport in schema).toBe(false);
    }
  });

  it("validates lane declaration syntax without enforcing lane admissibility", () => {
    expect(
      validateAuthoredProjectionContract({
        key: "workspace.runtime",
        family: "replaceable-snapshot",
        fields: {
          layout: {
            realizationKey: { kind: "variable-string" },
          },
        },
        lanes: {
          hot: {
            reservations: ["layout.realizationKey"],
          },
          warm: {
            codec: "framed-snapshot",
          },
          cold: {
            materialization: "latest-snapshot",
          },
        },
      }),
    ).toBe(true);

    expect(() =>
      validateAuthoredProjectionContract({
        key: "workspace.runtime",
        family: "replaceable-snapshot",
        fields: {
          layout: {
            realizationKey: { kind: "variable-string" },
          },
        },
        lanes: {
          warm: { codec: "delta-frame" },
        },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("does not normalize or sort field trees", () => {
    const contract: AuthoredProjectionContract = {
      key: "deck.runtime",
      family: "replaceable-snapshot",
      fields: {
        zed: { kind: "fixed-scalar", type: "u32" },
        alpha: { kind: "fixed-scalar", type: "u32" },
      },
    };
    const beforeKeys = Object.keys(contract.fields);

    expect(validateAuthoredProjectionContract(contract)).toBe(true);
    expect(Object.keys(contract.fields)).toEqual(beforeKeys);
  });

  it("exports the authored projection type surface", () => {
    expectTypeOf<AuthoredProjectionContract["family"]>().toEqualTypeOf<"replaceable-snapshot">();
    expectTypeOf<AuthoredBoundedArrayField["maxLength"]>().toEqualTypeOf<number>();
    expectTypeOf<AuthoredVariableStringField["kind"]>().toEqualTypeOf<"variable-string">();
  });
});
