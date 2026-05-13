import { invariant } from "@seqlok/base";

import { createPrimitivesError } from "./errors/primitives";

export const SWSR_HEADER_WORDS = 16;
export const SWSR_HEADER_WRITE_INDEX = 0;
export const SWSR_HEADER_READ_INDEX = 1;
export const SWSR_HEADER_WRITE_SEQ = 2;
export const SWSR_HEADER_DROPPED = 3;

export interface SwsrRingLayout {
  readonly capacity: number;
  readonly wordsPerSlot: number;
}

export interface SwsrRingBacking {
  readonly sab: SharedArrayBuffer;
  readonly header: Uint32Array;
  readonly slots: Uint32Array;
  readonly capacity: number;
  readonly wordsPerSlot: number;
}

export interface SwsrRingEncode<T> {
  encode(value: T, dst: Uint32Array, offset: number): void;
}

export interface SwsrRingDecode<T> {
  decode(src: Uint32Array, offset: number): T;
}

export interface SwsrRingStats {
  readonly dropped: number;
}

export interface SwsrRingProducer<T> {
  enqueue(value: T): boolean;
  stats(): SwsrRingStats;
}

export interface SwsrRingConsumer<T> {
  drain(handle: (value: T) => void): void;
}

export function allocateSwsrRing(layout: SwsrRingLayout): SwsrRingBacking {
  const { capacity, wordsPerSlot } = layout;

  invariant(Number.isInteger(capacity) && capacity > 0, () =>
    createPrimitivesError("swsrRingInvalidLayout", {
      where: "primitives.swsrRing.allocateSwsrRing",
      detail: "capacity must be a positive integer",
      capacity,
      wordsPerSlot,
    }),
  );

  invariant(Number.isInteger(wordsPerSlot) && wordsPerSlot > 0, () =>
    createPrimitivesError("swsrRingInvalidLayout", {
      where: "primitives.swsrRing.allocateSwsrRing",
      detail: "wordsPerSlot must be a positive integer",
      capacity,
      wordsPerSlot,
    }),
  );

  const totalWords = SWSR_HEADER_WORDS + capacity * wordsPerSlot;
  const sab = new SharedArrayBuffer(totalWords * Uint32Array.BYTES_PER_ELEMENT);
  const header = new Uint32Array(sab, 0, SWSR_HEADER_WORDS);
  const slots = new Uint32Array(
    sab,
    SWSR_HEADER_WORDS * Uint32Array.BYTES_PER_ELEMENT,
    capacity * wordsPerSlot,
  );

  return {
    sab,
    header,
    slots,
    capacity,
    wordsPerSlot,
  };
}

export function bindSwsrRingProducer<T>(
  backing: SwsrRingBacking,
  encode: SwsrRingEncode<T>,
): SwsrRingProducer<T> {
  const { header, slots, capacity, wordsPerSlot } = backing;

  const enqueue = (value: T): boolean => {
    const readIndex = Atomics.load(header, SWSR_HEADER_READ_INDEX);
    const writeIndex = Atomics.load(header, SWSR_HEADER_WRITE_INDEX);
    const next = writeIndex + 1 === capacity ? 0 : writeIndex + 1;

    if (next === readIndex) {
      Atomics.add(header, SWSR_HEADER_DROPPED, 1);
      return false;
    }

    encode.encode(value, slots, writeIndex * wordsPerSlot);
    Atomics.store(header, SWSR_HEADER_WRITE_INDEX, next);
    Atomics.add(header, SWSR_HEADER_WRITE_SEQ, 1);

    return true;
  };

  const stats = (): SwsrRingStats => ({
    dropped: Atomics.load(header, SWSR_HEADER_DROPPED),
  });

  return { enqueue, stats };
}

export function bindSwsrRingConsumer<T>(
  backing: SwsrRingBacking,
  decode: SwsrRingDecode<T>,
): SwsrRingConsumer<T> {
  const { header, slots, capacity, wordsPerSlot } = backing;

  const drain = (handle: (value: T) => void): void => {
    let readIndex = Atomics.load(header, SWSR_HEADER_READ_INDEX);
    const writeIndex = Atomics.load(header, SWSR_HEADER_WRITE_INDEX);

    while (readIndex !== writeIndex) {
      const value = decode.decode(slots, readIndex * wordsPerSlot);
      handle(value);
      readIndex = readIndex + 1 === capacity ? 0 : readIndex + 1;
    }

    Atomics.store(header, SWSR_HEADER_READ_INDEX, readIndex);
  };

  return { drain };
}
