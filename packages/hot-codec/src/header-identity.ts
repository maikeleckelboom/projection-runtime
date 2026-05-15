import { createHash } from "node:crypto";
import { bytesToHex } from "./byte/hex";

export function deriveHotBlockAIdentityHashBytes(key: string): Uint8Array {
  return createHash("sha256").update(key, "utf8").digest().subarray(0, 16);
}

export function deriveHotBlockAIdentityHashHex(key: string): string {
  return bytesToHex(deriveHotBlockAIdentityHashBytes(key));
}
