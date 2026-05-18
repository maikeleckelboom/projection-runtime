import { checkJsonObjectRoot, ExclaveError } from "@exclave/base";

import { throwInputRejected } from "./errors";
import type { HostContractFailure, HostContractValidationResult } from "./host-failure";

const CANONICAL_DECIMAL_RE = /^(?:0|[1-9][0-9]*)$/;

export function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throwInputRejected(`${label} must be a string`);
  }
  if (value.length === 0) {
    throwInputRejected(`${label} must be a non-empty string`);
  }
  return value;
}

export function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  const result = checkJsonObjectRoot(value);
  if (!result.ok) {
    throwInputRejected(`${label} is not a plain data object: ${result.reason}`);
  }
  return value as Record<string, unknown>;
}

export function assertExactRootKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throwInputRejected(`${label} must not have extra field: ${key}`);
    }
  }
}

export function assertJsonObject(value: unknown, path: string): void {
  const result = checkJsonObjectRoot(value);
  if (!result.ok) {
    throwInputRejected(`${path} is not JSON-safe: ${result.reason}`);
  }
}

export function assertCanonicalDecimalString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throwInputRejected(`${label} must be a string, not a number or bigint`);
  }
  if (!CANONICAL_DECIMAL_RE.test(value)) {
    throwInputRejected(`${label} must be a canonical non-negative decimal string (e.g. "0", "42")`);
  }
  return value;
}

export function assertSafeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throwInputRejected(`${label} must be a number`);
  }
  if (!Number.isFinite(value)) {
    throwInputRejected(`${label} must be a finite number`);
  }
  if (!Number.isSafeInteger(value)) {
    throwInputRejected(`${label} must be a safe integer`);
  }
  if (value < 0) {
    throwInputRejected(`${label} must be a non-negative integer`);
  }
  return value;
}

export function assertSafePositiveInteger(value: unknown, label: string): number {
  const num = assertSafeNonNegativeInteger(value, label);
  if (num === 0) {
    throwInputRejected(`${label} must be a positive integer`);
  }
  return num;
}

export function validationFailure(
  code: "host-contract.invalidDescriptor" | "host-contract.rejected",
  message: string,
): HostContractValidationResult<never> {
  return {
    ok: false as const,
    failure: { code, message } as HostContractFailure,
  };
}

export function validationSuccess<T>(value: T): HostContractValidationResult<T> {
  return { ok: true as const, value };
}

export function validationMessageFromError(error: unknown): string {
  return error instanceof ExclaveError && typeof error.details.detail === "string"
    ? error.details.detail
    : error instanceof Error
      ? error.message
      : "Unknown validation error";
}
