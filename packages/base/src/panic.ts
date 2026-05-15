/**
 * Throw a plain internal failure for base-layer code paths where a ExclaveError
 * cannot be constructed yet.
 */
export function panic(message: string): never {
  throw new Error(`Exclave internal error: ${message}`);
}
