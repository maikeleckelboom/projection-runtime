import { describe, expect, expectTypeOf, it } from "vitest";

import schemaArtifact from "../spec-ast/v1.json";
import {
  SPEC_AST_V1_ID,
  SchemaValidationError,
  normalizeSpecAst,
  validateSpecAst,
  type MeterDef,
  type ParamDef,
  type SpecAst,
  type SpecNamespace,
} from "../src/index";
import * as schema from "../src/index";

describe("@seqlok/schema", () => {
  it("validates a minimal authored spec", () => {
    const spec = {
      id: "transport",
      params: {
        gain: { kind: "f32", min: 0, max: 1 },
        lane: {
          mode: { kind: "enum", values: ["vinyl", "sync"] },
        },
      },
      meters: {
        peak: { kind: "f64" },
      },
    } satisfies SpecAst;

    expect(validateSpecAst(spec)).toBe(true);
  });

  it("keeps runtime exports narrow", () => {
    expect(Object.keys(schema).sort()).toEqual([
      "SPEC_AST_V1_ID",
      "SchemaValidationError",
      "normalizeSpecAst",
      "validateSpecAst",
    ]);
  });

  it("aligns the exported schema id with the public artifact", () => {
    expect(schemaArtifact.$id).toBe(SPEC_AST_V1_ID);
  });

  it("rejects unknown authored properties", () => {
    expect(() =>
      validateSpecAst({
        params: {
          gain: { kind: "f32", step: 0.1 },
        },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("collects multiple structural issues", () => {
    try {
      validateSpecAst({
        extra: true,
        params: {
          mode: { kind: "enum", values: ["a", "a"] },
          flags: { kind: "bool.array", length: 0 },
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      expect((error as SchemaValidationError).issues).toEqual([
        { path: "extra", message: "unknown top-level property" },
        { path: "params.mode.values[1]", message: "duplicate enum label" },
        { path: "params.flags.length", message: "must be a positive integer" },
      ]);
    }
  });

  it("does not perform semantic range validation", () => {
    expect(
      validateSpecAst({
        params: {
          inverted: { kind: "f32", min: 10, max: 1 },
        },
      }),
    ).toBe(true);
  });

  it("normalizes only authored-layer structure", () => {
    const normalized = normalizeSpecAst({
      meters: {},
      params: {
        zed: { max: 1, kind: "f32", min: 0 },
        nested: {
          beta: { values: ["b", "a"], kind: "enum" },
          alpha: { length: 2, kind: "u8.array" },
        },
      },
    });

    expect(normalized).toEqual({
      params: {
        nested: {
          alpha: { kind: "u8.array", length: 2 },
          beta: { kind: "enum", values: ["b", "a"] },
        },
        zed: { kind: "f32", max: 1, min: 0 },
      },
    });
  });

  it("exports the canonical authored AST type surface", () => {
    expectTypeOf<Extract<ParamDef, { kind: "enum" }>["values"]>().toEqualTypeOf<
      readonly [string, ...string[]]
    >();
    expectTypeOf<Extract<MeterDef, { kind: "f64.array" }>["length"]>().toEqualTypeOf<number>();
    expectTypeOf<SpecAst["params"]>().toEqualTypeOf<SpecNamespace<ParamDef> | undefined>();
  });
});
