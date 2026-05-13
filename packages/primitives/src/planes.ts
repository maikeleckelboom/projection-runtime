import { createPrimitivesError } from "./errors/primitives";

export const PLANE_PACK_ORDER = ["MF64", "PF32", "PI32", "PU", "MF32", "MU32", "MU", "PB"] as const;

export type PlaneKey = (typeof PLANE_PACK_ORDER)[number];
export type PlaneRecord<V> = Readonly<Record<PlaneKey, V>>;

export const ALL_PLANES: readonly PlaneKey[] = PLANE_PACK_ORDER;

type BytesPerElem = 1 | 4 | 8;

export const BYTES_PER_ELEM: PlaneRecord<BytesPerElem> = {
  MF64: 8,
  PF32: 4,
  PI32: 4,
  PU: 4,
  MF32: 4,
  MU32: 4,
  MU: 4,
  PB: 1,
} as const;

const PLANE_SET: ReadonlySet<string> = new Set<string>(PLANE_PACK_ORDER);

export function isPlaneKey(value: string): value is PlaneKey {
  return PLANE_SET.has(value);
}

export function assertPlaneKey(value: string, where: string): asserts value is PlaneKey {
  if (!isPlaneKey(value)) {
    throw createPrimitivesError("planeInvalid", {
      where,
      detail: `invalid plane key: ${value}`,
      plane: value,
    });
  }
}

export function roundUpTo(value: number, align: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createPrimitivesError("alignmentInvalid", {
      where: "primitives.planes.roundUpTo",
      detail: `value must be a non-negative safe integer, got ${String(value)}`,
      value,
      align,
    });
  }

  if (!Number.isSafeInteger(align) || align <= 0 || (align & (align - 1)) !== 0) {
    throw createPrimitivesError("alignmentInvalid", {
      where: "primitives.planes.roundUpTo",
      detail: `align must be a positive power-of-two safe integer, got ${String(align)}`,
      value,
      align,
    });
  }

  const rounded = Math.ceil(value / align) * align;

  if (!Number.isSafeInteger(rounded)) {
    throw createPrimitivesError("alignmentInvalid", {
      where: "primitives.planes.roundUpTo",
      detail: `rounded result must be a safe integer, got ${String(rounded)}`,
      value,
      align,
    });
  }

  return rounded;
}
