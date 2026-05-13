import { invariant } from "@seqlok/base";

import { addU32, loadU32, spinUntilEven } from "./atomics";
import {
  createPrimitivesError,
  type PrimitivesInvalidSpinBudgetDetails,
  type PrimitivesSeqlockTimeoutDetails,
} from "./errors/primitives";

export interface SeqPair {
  readonly u32: Uint32Array;
  readonly lockIndex: number;
  readonly seqIndex: number;
}

export function createSeqPair(u32: Uint32Array, lockIndex: number, seqIndex: number): SeqPair {
  const length = u32.length;

  if (
    !Number.isInteger(lockIndex) ||
    !Number.isInteger(seqIndex) ||
    lockIndex < 0 ||
    seqIndex < 0 ||
    lockIndex >= length ||
    seqIndex >= length
  ) {
    throw createPrimitivesError("seqlockInvalidPair", {
      where: "primitives.seqlock.createSeqPair",
      detail: `indices out of range: lockIndex=${String(lockIndex)}, seqIndex=${String(
        seqIndex,
      )}, length=${String(length)}`,
      lockIndex,
      seqIndex,
      length,
    });
  }

  if (lockIndex === seqIndex) {
    throw createPrimitivesError("seqlockInvalidPair", {
      where: "primitives.seqlock.createSeqPair",
      detail: `lockIndex and seqIndex must be distinct, both=${String(lockIndex)}`,
      lockIndex,
      seqIndex,
      length,
    });
  }

  return { u32, lockIndex, seqIndex };
}

export interface TryReadOptions {
  readonly spinBudget?: number;
  readonly retryBudget?: number;
}

export interface ReadStatus {
  readonly spins: number;
  readonly retries: number;
  readonly kind: "ok" | "writerActive" | "budgetExhausted";
}

export type TryReadResult<T> =
  | { readonly ok: true; readonly value: T; readonly status: ReadStatus }
  | { readonly ok: false; readonly value: T; readonly status: ReadStatus };

export function beginWrite(pair: SeqPair): void {
  addU32(pair.u32, pair.lockIndex, 1);
}

export function endWrite(pair: SeqPair): void {
  addU32(pair.u32, pair.seqIndex, 1);
  addU32(pair.u32, pair.lockIndex, 1);
}

export function publish<T>(pair: SeqPair, writer: () => T): T {
  beginWrite(pair);

  try {
    const result = writer();
    endWrite(pair);
    return result;
  } catch (error) {
    addU32(pair.u32, pair.seqIndex, 1);
    addU32(pair.u32, pair.lockIndex, 1);
    throw error;
  }
}

export function tryRead<T>(
  pair: SeqPair,
  reader: () => T,
  options?: TryReadOptions,
): TryReadResult<T> {
  const spinBudgetOption = options?.spinBudget ?? 1024;
  const retryBudgetOption = options?.retryBudget ?? 8;

  const invalidBudgetDetails = {
    where: "primitives.seqlock.tryRead",
    detail: `spinBudget=${String(spinBudgetOption)}, retryBudget=${String(retryBudgetOption)}`,
    spinBudget: spinBudgetOption,
    retryBudget: retryBudgetOption,
  } satisfies PrimitivesInvalidSpinBudgetDetails;

  invariant(
    Number.isFinite(spinBudgetOption) &&
      Number.isFinite(retryBudgetOption) &&
      spinBudgetOption >= 0 &&
      retryBudgetOption >= 0 &&
      Number.isInteger(spinBudgetOption) &&
      Number.isInteger(retryBudgetOption),
    () => createPrimitivesError("invalidSpinBudget", invalidBudgetDetails),
  );

  const spinBudget = spinBudgetOption;
  const retryBudget = retryBudgetOption;
  let totalSpins = 0;
  let retriesUsed = 0;

  while (retriesUsed <= retryBudget) {
    const spinResult = spinUntilEven(pair.u32, pair.lockIndex, spinBudget);

    if (spinResult === undefined) {
      const status: ReadStatus = {
        spins: totalSpins,
        retries: retriesUsed,
        kind: "writerActive",
      };

      return { ok: false, value: reader(), status };
    }

    totalSpins += spinResult.spins;

    const seq0 = loadU32(pair.u32, pair.seqIndex);
    const value = reader();
    const seq1 = loadU32(pair.u32, pair.seqIndex);
    const lockNow = loadU32(pair.u32, pair.lockIndex);

    if (seq0 === seq1 && (lockNow & 1) === 0) {
      const status: ReadStatus = {
        spins: totalSpins,
        retries: retriesUsed,
        kind: "ok",
      };

      return { ok: true, value, status };
    }

    retriesUsed += 1;
  }

  const timeoutDetails = {
    where: "primitives.seqlock.tryRead",
    detail: `spinBudget=${String(spinBudget)}, retryBudget=${String(
      retryBudget,
    )}, spins=${String(totalSpins)}, retriesUsed=${String(retriesUsed)}`,
    spinBudget,
    actualSpins: totalSpins,
    retryBudget,
    retriesUsed,
    lockIndex: pair.lockIndex,
    seqIndex: pair.seqIndex,
  } satisfies PrimitivesSeqlockTimeoutDetails;

  throw createPrimitivesError("seqlockTimeout", timeoutDetails);
}
