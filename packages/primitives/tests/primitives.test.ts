import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ALL_PLANES,
  addU32,
  allocateSwsrRing,
  assertPlaneKey,
  BYTES_PER_ELEM,
  beginWrite,
  bindSwsrRingConsumer,
  bindSwsrRingProducer,
  createPrimitivesError,
  createSeqPair,
  endWrite,
  isPlaneKey,
  loadU32,
  PLANE_PACK_ORDER,
  PRIMITIVES_DOMAIN,
  PRIMITIVES_ERRORS,
  publish,
  type ReadStatus,
  roundUpTo,
  type SeqPair,
  SWSR_HEADER_DROPPED,
  SWSR_HEADER_READ_INDEX,
  SWSR_HEADER_WORDS,
  SWSR_HEADER_WRITE_INDEX,
  SWSR_HEADER_WRITE_SEQ,
  spinUntilEven,
  type TryReadResult,
  tryRead,
} from "../src/index";

function makeSeqPair(): { pair: SeqPair; u32: Uint32Array; dataIndex: number } {
  const u32 = new Uint32Array(new SharedArrayBuffer(4 * Uint32Array.BYTES_PER_ELEMENT));
  return { pair: createSeqPair(u32, 0, 1), u32, dataIndex: 2 };
}

function captureThrow(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error("expected function to throw");
}

describe("@seqlok/primitives seqlock", () => {
  it("publishes coherent multi-word reads with stable even lock state", () => {
    const { pair, u32, dataIndex } = makeSeqPair();

    publish(pair, () => {
      u32[dataIndex] = 42;
      u32[dataIndex + 1] = 84;
    });

    const result = tryRead(pair, () => ({
      a: u32[dataIndex] ?? 0,
      b: u32[dataIndex + 1] ?? 0,
    }));

    expect(result).toEqual({
      ok: true,
      value: { a: 42, b: 84 },
      status: { spins: 0, retries: 0, kind: "ok" },
    });
    expect(u32[pair.lockIndex] ?? 0).toBe(2);
    expect(u32[pair.seqIndex] ?? 0).toBe(1);
  });

  it("exposes begin/end write mechanics and recovers lock state when publish throws", () => {
    const { pair, u32, dataIndex } = makeSeqPair();

    beginWrite(pair);
    expect((u32[pair.lockIndex] ?? 0) & 1).toBe(1);
    endWrite(pair);
    expect((u32[pair.lockIndex] ?? 0) & 1).toBe(0);
    expect(u32[pair.seqIndex]).toBe(1);

    expect(() =>
      publish(pair, () => {
        u32[dataIndex] = 9;
        throw new Error("write failed");
      }),
    ).toThrow("write failed");

    expect((u32[pair.lockIndex] ?? 0) & 1).toBe(0);
    expect(u32[pair.seqIndex]).toBe(2);
    expect(u32[dataIndex]).toBe(9);
  });

  it("returns a best-effort result when the writer stays active", () => {
    const { pair, u32, dataIndex } = makeSeqPair();
    u32[dataIndex] = 7;

    beginWrite(pair);
    try {
      const result = tryRead(pair, () => u32[dataIndex] ?? 0, {
        spinBudget: 1,
        retryBudget: 0,
      });

      expect(result.ok).toBe(false);
      expect(result.value).toBe(7);
      expect(result.status.kind).toBe("writerActive");
    } finally {
      endWrite(pair);
    }
  });

  it("throws a primitives timeout when stable verification never succeeds", () => {
    const { pair, u32, dataIndex } = makeSeqPair();

    expect(
      captureThrow(() =>
        tryRead(
          pair,
          () => {
            u32[dataIndex] = (u32[dataIndex] ?? 0) + 1;
            u32[pair.seqIndex] = (u32[pair.seqIndex] ?? 0) + 1;
            return u32[dataIndex] ?? 0;
          },
          { spinBudget: 0, retryBudget: 1 },
        ),
      ),
    ).toMatchObject({ code: "primitives.seqlockTimeout" });
  });

  it("rejects invalid seqlock pair indices", () => {
    const u32 = new Uint32Array(new SharedArrayBuffer(2 * Uint32Array.BYTES_PER_ELEMENT));

    expect(captureThrow(() => createSeqPair(u32, 0, 0))).toMatchObject({
      code: "primitives.seqlockInvalidPair",
    });
    expect(captureThrow(() => createSeqPair(u32, 0, 3))).toMatchObject({
      code: "primitives.seqlockInvalidPair",
    });
  });

  it("rejects invalid read budgets", () => {
    const { pair } = makeSeqPair();

    expect(
      captureThrow(() => tryRead(pair, () => 1, { spinBudget: -1, retryBudget: 0 })),
    ).toMatchObject({ code: "primitives.invalidSpinBudget" });
  });

  it("exports the seqlock type surface", () => {
    expectTypeOf<ReadStatus["kind"]>().toEqualTypeOf<"ok" | "writerActive" | "budgetExhausted">();
    expectTypeOf<TryReadResult<number>["value"]>().toEqualTypeOf<number>();
  });
});

describe("@seqlok/primitives planes", () => {
  it("exposes stable plane vocabulary and byte sizes", () => {
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

describe("@seqlok/primitives atomics", () => {
  it("loads, adds, and spins on u32 words", () => {
    const u32 = new Uint32Array(new SharedArrayBuffer(2 * Uint32Array.BYTES_PER_ELEMENT));

    expect(loadU32(u32, 0)).toBe(0);
    expect(addU32(u32, 0, 2)).toBe(0);
    expect(loadU32(u32, 0)).toBe(2);
    expect(spinUntilEven(u32, 0, 0)).toEqual({ value: 2, spins: 0 });

    u32[1] = 1;
    expect(spinUntilEven(u32, 1, 1)).toBeUndefined();
  });
});

describe("@seqlok/primitives swsr ring", () => {
  const encodeNumber = {
    encode(value: number, dst: Uint32Array, offset: number): void {
      dst[offset] = value;
    },
  };
  const decodeNumber = {
    decode(src: Uint32Array, offset: number): number {
      return src[offset] ?? 0;
    },
  };

  it("allocates validated backing layout", () => {
    const backing = allocateSwsrRing({ capacity: 4, wordsPerSlot: 2 });

    expect(backing.sab).toBeInstanceOf(SharedArrayBuffer);
    expect(backing.header.length).toBe(SWSR_HEADER_WORDS);
    expect(backing.slots.length).toBe(8);
    expect(backing.sab.byteLength).toBe((SWSR_HEADER_WORDS + 8) * Uint32Array.BYTES_PER_ELEMENT);
    expect([...backing.header]).toEqual(new Array<number>(SWSR_HEADER_WORDS).fill(0));

    expect(captureThrow(() => allocateSwsrRing({ capacity: 0, wordsPerSlot: 1 }))).toMatchObject({
      code: "primitives.swsrRingInvalidLayout",
    });
    expect(captureThrow(() => allocateSwsrRing({ capacity: 1, wordsPerSlot: 0 }))).toMatchObject({
      code: "primitives.swsrRingInvalidLayout",
    });
  });

  it("enqueues, drops when full, drains in FIFO order, and tracks header counters", () => {
    const backing = allocateSwsrRing({ capacity: 3, wordsPerSlot: 1 });
    const producer = bindSwsrRingProducer(backing, encodeNumber);
    const consumer = bindSwsrRingConsumer(backing, decodeNumber);

    expect(producer.enqueue(10)).toBe(true);
    expect(producer.enqueue(11)).toBe(true);
    expect(producer.enqueue(12)).toBe(false);
    expect(backing.header[SWSR_HEADER_WRITE_SEQ]).toBe(2);
    expect(backing.header[SWSR_HEADER_DROPPED]).toBe(1);
    expect(producer.stats()).toEqual({ dropped: 1 });

    const values: number[] = [];
    consumer.drain((value) => {
      values.push(value);
    });

    expect(values).toEqual([10, 11]);
    expect(backing.header[SWSR_HEADER_READ_INDEX]).toBe(backing.header[SWSR_HEADER_WRITE_INDEX]);
  });

  it("wraps indices across the slot boundary", () => {
    const backing = allocateSwsrRing({ capacity: 4, wordsPerSlot: 1 });
    const producer = bindSwsrRingProducer(backing, encodeNumber);
    const consumer = bindSwsrRingConsumer(backing, decodeNumber);

    expect(producer.enqueue(1)).toBe(true);
    expect(producer.enqueue(2)).toBe(true);
    expect(producer.enqueue(3)).toBe(true);

    const first: number[] = [];
    consumer.drain((value) => {
      first.push(value);
    });
    expect(first).toEqual([1, 2, 3]);

    expect(producer.enqueue(4)).toBe(true);
    expect(producer.enqueue(5)).toBe(true);

    const second: number[] = [];
    consumer.drain((value) => {
      second.push(value);
    });

    expect(second).toEqual([4, 5]);
    expect(backing.header[SWSR_HEADER_READ_INDEX]).toBe(backing.header[SWSR_HEADER_WRITE_INDEX]);
  });
});

describe("@seqlok/primitives errors and public surface", () => {
  it("publishes a primitives-owned error domain", () => {
    expect(PRIMITIVES_DOMAIN.prefix).toBe("primitives");
    expect(Object.keys(PRIMITIVES_ERRORS).sort()).toEqual([
      "alignmentInvalid",
      "atomicsFailed",
      "invalidSpinBudget",
      "planeInvalid",
      "planeUnaligned",
      "seqlockInvalidPair",
      "seqlockTimeout",
      "swsrRingInvalidLayout",
    ]);

    const error = createPrimitivesError("invalidSpinBudget", {
      where: "test",
      detail: "bad budgets",
      spinBudget: -1,
      retryBudget: 0,
    });

    expect(error.toJSON()).toMatchObject({
      code: "primitives.invalidSpinBudget",
      message: "Spin and retry budgets must be non-negative integers",
      details: { spinBudget: -1, retryBudget: 0 },
    });
  });

  it("keeps runtime exports limited to primitive mechanisms", async () => {
    const primitives = await import("../src/index");

    expect(Object.keys(primitives).sort()).toEqual([
      "ALL_PLANES",
      "BYTES_PER_ELEM",
      "PLANE_PACK_ORDER",
      "PRIMITIVES_DOMAIN",
      "PRIMITIVES_ERRORS",
      "SWSR_HEADER_DROPPED",
      "SWSR_HEADER_READ_INDEX",
      "SWSR_HEADER_WORDS",
      "SWSR_HEADER_WRITE_INDEX",
      "SWSR_HEADER_WRITE_SEQ",
      "addU32",
      "allocateSwsrRing",
      "assertPlaneKey",
      "beginWrite",
      "bindSwsrRingConsumer",
      "bindSwsrRingProducer",
      "createPrimitivesError",
      "createSeqPair",
      "endWrite",
      "isPlaneKey",
      "loadU32",
      "publish",
      "roundUpTo",
      "spinUntilEven",
      "tryRead",
    ]);
  });
});
