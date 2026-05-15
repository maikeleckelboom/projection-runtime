import type { ExclaveError } from "./error";

export type InvariantErrorFactory<E extends ExclaveError = ExclaveError> = () => E;

export function invariant<E extends ExclaveError>(
  condition: unknown,
  createError: InvariantErrorFactory<E>,
): asserts condition {
  if (!condition) {
    throw createError();
  }
}
