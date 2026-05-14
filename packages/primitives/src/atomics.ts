import { createPrimitivesError, type PrimitivesAtomicsFailedDetails } from "./errors/primitives";

type AtomicView = BigUint64Array | Uint32Array;

function atomicsFailed(
  where: string,
  operation: "loadAtomicU32" | "addAtomicU32" | "loadAtomicU64",
  view: AtomicView,
  index: number,
  delta: number | undefined,
  cause?: unknown,
): never {
  const details = {
    where,
    detail: `operation=${operation}, index=${String(index)}, length=${String(
      view.length,
    )}, delta=${typeof delta === "number" ? String(delta) : "n/a"}`,
    operation,
    index,
    length: view.length,
    ...(delta === undefined ? {} : { delta }),
  } satisfies PrimitivesAtomicsFailedDetails;

  throw createPrimitivesError("atomicsFailed", details, cause);
}

export function loadAtomicU32(view: Uint32Array, index: number): number {
  try {
    return Atomics.load(view, index);
  } catch (error) {
    atomicsFailed("primitives.atomics.loadAtomicU32", "loadAtomicU32", view, index, undefined, error);
  }
}

export function addAtomicU32(view: Uint32Array, index: number, delta: number): number {
  try {
    return Atomics.add(view, index, delta);
  } catch (error) {
    atomicsFailed("primitives.atomics.addAtomicU32", "addAtomicU32", view, index, delta, error);
  }
}

export function loadAtomicU64(view: BigUint64Array, index: number): bigint {
  try {
    return Atomics.load(view, index);
  } catch (error) {
    atomicsFailed("primitives.atomics.loadAtomicU64", "loadAtomicU64", view, index, undefined, error);
  }
}
