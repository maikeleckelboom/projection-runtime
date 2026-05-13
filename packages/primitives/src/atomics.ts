import { createPrimitivesError, type PrimitivesAtomicsFailedDetails } from "./errors/primitives";

function atomicsFailed(
  where: string,
  operation: "loadU32" | "addU32",
  plane: Uint32Array,
  index: number,
  delta: number | undefined,
  cause?: unknown,
): never {
  const details = {
    where,
    detail: `operation=${operation}, index=${String(index)}, length=${String(
      plane.length,
    )}, delta=${typeof delta === "number" ? String(delta) : "n/a"}`,
    operation,
    index,
    length: plane.length,
    ...(delta === undefined ? {} : { delta }),
  } satisfies PrimitivesAtomicsFailedDetails;

  throw createPrimitivesError("atomicsFailed", details, cause);
}

export function loadU32(plane: Uint32Array, index: number): number {
  try {
    return Atomics.load(plane, index);
  } catch (error) {
    atomicsFailed("primitives.atomics.loadU32", "loadU32", plane, index, undefined, error);
  }
}

export function addU32(plane: Uint32Array, index: number, delta: number): number {
  try {
    return Atomics.add(plane, index, delta);
  } catch (error) {
    atomicsFailed("primitives.atomics.addU32", "addU32", plane, index, delta, error);
  }
}

export interface SpinUntilEvenResult {
  readonly value: number;
  readonly spins: number;
}

export function spinUntilEven(
  plane: Uint32Array,
  index: number,
  spinBudget: number,
): SpinUntilEvenResult | undefined {
  let spins = 0;
  let value = loadU32(plane, index);

  if ((value & 1) === 0) {
    return { value, spins };
  }

  while (spins < spinBudget) {
    spins += 1;
    value = loadU32(plane, index);

    if ((value & 1) === 0) {
      return { value, spins };
    }
  }

  return undefined;
}
