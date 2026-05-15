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
