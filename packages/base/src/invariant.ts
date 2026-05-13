import type { SeqlokError } from "./error";

export type InvariantErrorFactory<E extends SeqlokError = SeqlokError> = () => E;

export function invariant<E extends SeqlokError>(
  condition: unknown,
  createError: InvariantErrorFactory<E>,
): asserts condition {
  if (!condition) {
    throw createError();
  }
}
