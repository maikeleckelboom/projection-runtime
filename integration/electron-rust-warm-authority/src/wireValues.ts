const U64_MAX = 0xffff_ffff_ffff_ffffn;
const CANONICAL_AUTHORITY_EPOCH = /^(?:0|[1-9][0-9]*)$/;
const CANONICAL_U64_HEX = /^[0-9a-f]{16}$/;

export function encodeAuthorityEpoch(authorityEpoch: bigint): string {
  if (authorityEpoch < 0n || authorityEpoch > U64_MAX) {
    throw new RangeError("authorityEpoch must fit in u64");
  }
  return authorityEpoch.toString(10);
}

export function decodeAuthorityEpoch(value: unknown, label = "authorityEpoch"): bigint {
  if (typeof value !== "string" || !CANONICAL_AUTHORITY_EPOCH.test(value)) {
    throw new TypeError(`${label} must be a canonical unsigned decimal string`);
  }
  const decoded = BigInt(value);
  if (decoded > U64_MAX) {
    throw new RangeError(`${label} must fit in u64`);
  }
  return decoded;
}

export function encodeU64Hex(value: bigint): string {
  if (value < 0n || value > U64_MAX) {
    throw new RangeError("u64 value is out of range");
  }
  return value.toString(16).padStart(16, "0");
}

export function decodeU64Hex(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !CANONICAL_U64_HEX.test(value)) {
    throw new TypeError(`${label} must be a 16-character lowercase hexadecimal u64`);
  }
  return BigInt(`0x${value}`);
}

export function isCanonicalAuthorityEpoch(value: unknown): value is string {
  try {
    decodeAuthorityEpoch(value);
    return true;
  } catch {
    return false;
  }
}

export function isCanonicalU64Hex(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_U64_HEX.test(value);
}
