import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ALL_PLANES,
  addAtomicU32,
  assertPlaneKey,
  BYTES_PER_ELEM,
  createPrimitivesError,
  isPlaneKey,
  loadAtomicU32,
  loadAtomicU64,
  PLANE_PACK_ORDER,
  PRIMITIVES_DOMAIN,
  PRIMITIVES_ERRORS,
  roundUpTo,
} from "../src/index";

function captureThrow(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error("expected function to throw");
}

describe("@seqlok/primitives atomics", () => {
  it("loads and adds u32 words with explicit atomic helpers", () => {
    const u32 = new Uint32Array(new SharedArrayBuffer(2 * Uint32Array.BYTES_PER_ELEMENT));

    expect(loadAtomicU32(u32, 0)).toBe(0);
    expect(addAtomicU32(u32, 0, 2)).toBe(0);
    expect(loadAtomicU32(u32, 0)).toBe(2);
  });

  it("loads u64 words from a BigUint64Array with Atomics.load", () => {
    const u64 = new BigUint64Array(new SharedArrayBuffer(BigUint64Array.BYTES_PER_ELEMENT));
    u64[0] = 42n;

    const loadSpy = vi.spyOn(Atomics, "load");
    const value = loadAtomicU64(u64, 0);

    expect(value).toBe(42n);
    expectTypeOf(value).toEqualTypeOf<bigint>();
    expect(loadSpy).toHaveBeenCalledWith(u64, 0);

    loadSpy.mockRestore();
  });

  it("wraps invalid atomic access in the primitives error domain", () => {
    const u64 = new BigUint64Array(new SharedArrayBuffer(BigUint64Array.BYTES_PER_ELEMENT));

    expect(captureThrow(() => loadAtomicU64(u64, 1))).toMatchObject({
      code: "primitives.atomicsFailed",
      details: {
        where: "primitives.atomics.loadAtomicU64",
        operation: "loadAtomicU64",
        index: 1,
        length: 1,
      },
    });
  });
});

describe("@seqlok/primitives layout helpers", () => {
  it("keeps the existing plane packing vocabulary small", () => {
    expect(PLANE_PACK_ORDER).toEqual(["MF64", "PF32", "PI32", "PU", "MF32", "MU32", "MU", "PB"]);
    expect(ALL_PLANES).toBe(PLANE_PACK_ORDER);
    expect(BYTES_PER_ELEM).toEqual({
      MF64: Float64Array.BYTES_PER_ELEMENT,
      PF32: Float32Array.BYTES_PER_ELEMENT,
      PI32: Int32Array.BYTES_PER_ELEMENT,
      PU: Uint32Array.BYTES_PER_ELEMENT,
      MF32: Float32Array.BYTES_PER_ELEMENT,
      MU32: Uint32Array.BYTES_PER_ELEMENT,
      MU: Uint32Array.BYTES_PER_ELEMENT,
      PB: Uint8Array.BYTES_PER_ELEMENT,
    });
  });

  it("checks plane keys and rounds offsets to power-of-two alignment", () => {
    expect(isPlaneKey("PF32")).toBe(true);
    expect(isPlaneKey("NOPE")).toBe(false);
    expect(captureThrow(() => assertPlaneKey("NOPE", "test"))).toMatchObject({
      code: "primitives.planeInvalid",
    });

    expect(roundUpTo(0, 4)).toBe(0);
    expect(roundUpTo(5, 4)).toBe(8);
    expect(roundUpTo(9, 8)).toBe(16);
    expect(captureThrow(() => roundUpTo(1, 3))).toMatchObject({
      code: "primitives.alignmentInvalid",
    });
  });
});

describe("@seqlok/primitives errors and public surface", () => {
  it("publishes a primitives-owned error domain for retained helpers", () => {
    expect(PRIMITIVES_DOMAIN.prefix).toBe("primitives");
    expect(Object.keys(PRIMITIVES_ERRORS).sort()).toEqual([
      "alignmentInvalid",
      "atomicsFailed",
      "planeInvalid",
    ]);

    const error = createPrimitivesError("planeInvalid", {
      where: "test",
      detail: "bad plane",
      plane: "NOPE",
    });

    expect(error.toJSON()).toMatchObject({
      code: "primitives.planeInvalid",
      message: "Plane key is invalid",
      details: { plane: "NOPE" },
    });
  });

  it("does not export old SeqPair seqlock or SWSR ring APIs from the package root", async () => {
    const primitives = await import("../src/index");

    expect(Object.keys(primitives).sort()).toEqual([
      "ALL_PLANES",
      "BYTES_PER_ELEM",
      "PLANE_PACK_ORDER",
      "PRIMITIVES_DOMAIN",
      "PRIMITIVES_ERRORS",
      "addAtomicU32",
      "assertPlaneKey",
      "createPrimitivesError",
      "isPlaneKey",
      "loadAtomicU32",
      "loadAtomicU64",
      "roundUpTo",
    ]);
    expect("createSeqPair" in primitives).toBe(false);
    expect("tryRead" in primitives).toBe(false);
    expect("allocateSwsrRing" in primitives).toBe(false);
  });
});
