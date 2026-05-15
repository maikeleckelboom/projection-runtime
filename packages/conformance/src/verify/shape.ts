import { createConformanceError } from "../error";

const U64_HEX_RE = /^[0-9a-f]{16}$/;

export function getStringProperty(obj: Record<string, unknown>, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw createConformanceError("fixtureShapeRejected", {
      detail: `expected ${key} to be a string`,
      failureCode: "expectedString",
      path,
    });
  }
  return value;
}

export function getU64Property(obj: Record<string, unknown>, key: string, path: string): bigint {
  const value = obj[key];
  if (typeof value === "bigint") {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
      throw createConformanceError("fixtureShapeRejected", {
        detail: `expected ${key} to be a u64`,
        failureCode: "u64OutOfRange",
        path,
      });
    }
    return value;
  }

  return getU64HexProperty(obj, key, path);
}

export function getU64HexProperty(obj: Record<string, unknown>, key: string, path: string): bigint {
  const value = obj[key];
  if (typeof value !== "string") {
    throw createConformanceError("fixtureShapeRejected", {
      detail: `expected ${key} to be a string`,
      failureCode: "expectedString",
      path,
    });
  }
  if (!U64_HEX_RE.test(value)) {
    throw createConformanceError("fixtureShapeRejected", {
      detail: `expected ${key} to be 16 lowercase hex characters`,
      failureCode: "expectedU64Hex",
      path,
    });
  }
  return BigInt(`0x${value}`);
}

export function getNumberProperty(obj: Record<string, unknown>, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number") {
    throw createConformanceError("fixtureShapeRejected", {
      detail: `expected ${key} to be a number`,
      failureCode: "expectedNumber",
      path,
    });
  }
  return value;
}

export function getObjectProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
