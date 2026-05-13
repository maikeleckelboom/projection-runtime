/**
 * Throw a plain internal failure for base-layer code paths where a SeqlokError
 * cannot be constructed yet.
 */
export function panic(message: string): never {
  throw new Error(`Seqlok internal error: ${message}`);
}
