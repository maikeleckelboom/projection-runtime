/**
 * Assert that a boolean type is exactly true.
 */
export type AssertTrue<T extends true> = T;

/**
 * Return whether `Sub` is assignable to `Super`.
 */
export type IsExtends<Sub, Super> = Sub extends Super ? true : false;

/**
 * Return whether two types have the same assignable shape.
 */
export type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Canonical JavaScript typed-array constructor names used in portable details.
 */
export type TypedArrayName =
  | "Int8Array"
  | "Uint8Array"
  | "Uint8ClampedArray"
  | "Int16Array"
  | "Uint16Array"
  | "Int32Array"
  | "Uint32Array"
  | "Float32Array"
  | "Float64Array"
  | "BigInt64Array"
  | "BigUint64Array";
