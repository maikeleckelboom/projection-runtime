export function encodeFixtureJson(value: unknown): unknown {
  if (typeof value === "bigint") {
    return encodeU64Hex(value);
  }

  if (Array.isArray(value)) {
    return value.map(encodeFixtureJson);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, encodeFixtureJson(nested)]),
    );
  }

  return value;
}

function encodeU64Hex(value: bigint): string {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("fixture u64 value is out of range");
  }

  return value.toString(16).padStart(16, "0");
}
