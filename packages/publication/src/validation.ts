import { throwInputRejected } from "./errors";

export const U32_MAX = 0xffff_ffff;

export function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throwInputRejected(`${label} must be a plain object`);
  }

  let proto: object | null;
  try {
    proto = Object.getPrototypeOf(value);
  } catch {
    throwInputRejected(`${label} object inspection failed`);
  }

  if (proto !== null && proto !== Object.prototype) {
    throwInputRejected(`${label} must be a plain object, not a class instance`);
  }

  return value as Record<string, unknown>;
}

export function assertExactRootKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throwInputRejected(`${label} must not have symbol keys`);
    }
    if (!allowedKeys.has(key)) {
      throwInputRejected(`${label} must not have extra field: ${key}`);
    }
  }
}

export function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throwInputRejected(`${label} must be a non-empty string`);
  }
  return value;
}

export function assertNonNegativeBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throwInputRejected(`${label} must be a non-negative bigint`);
  }
  return value;
}

export function assertU32(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
    throwInputRejected(`${label} must fit in u32`);
  }
  return value;
}
