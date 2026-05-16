import type { JsonObject } from "@exclave/base";
import { checkJsonObjectRoot } from "@exclave/base";
import { throwInputRejected } from "./errors";

export type WarmFailureCode = "warm.invalidEnvelope" | "warm.staleBinding" | "warm.rejected";

export type WarmFailure = {
  readonly code: WarmFailureCode;
  readonly message: string;
  readonly details?: JsonObject;
};

const VALID_CODES: ReadonlySet<string> = new Set([
  "warm.invalidEnvelope",
  "warm.staleBinding",
  "warm.rejected",
]);

function isFailureCode(value: unknown): value is WarmFailureCode {
  return typeof value === "string" && VALID_CODES.has(value);
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throwInputRejected(`${label} must be a string`);
  }
  if (value.length === 0) {
    throwInputRejected(`${label} must be a non-empty string`);
  }
  return value;
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  const result = checkJsonObjectRoot(value);
  if (!result.ok) {
    throwInputRejected(`${label} is not a plain data object: ${result.reason}`);
  }
  return value as Record<string, unknown>;
}

function assertExactRootKeys(
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

function assertJsonObject(value: unknown, path: string): void {
  const result = checkJsonObjectRoot(value);
  if (!result.ok) {
    throwInputRejected(`${path} is not JSON-safe: ${result.reason}`);
  }
}

export function createWarmFailure(input: {
  readonly code: WarmFailureCode;
  readonly message: string;
  readonly details?: JsonObject;
}): WarmFailure {
  const obj = assertPlainObject(input, "warm failure");
  assertExactRootKeys(obj, new Set(["code", "message", "details"]), "warm failure");

  if (!isFailureCode(obj.code)) {
    throwInputRejected(`invalid warm failure code: ${String(obj.code)}`);
  }

  const code = obj.code as WarmFailureCode;

  const message = assertNonEmptyString(obj.message, "failure.message");

  if (obj.details !== undefined) {
    assertJsonObject(obj.details, "failure.details");
  }

  return {
    code,
    message,
    ...(obj.details !== undefined ? { details: obj.details as JsonObject } : {}),
  };
}

export function validateWarmFailure(value: unknown): WarmFailure {
  return createWarmFailure(
    value as {
      readonly code: WarmFailureCode;
      readonly message: string;
      readonly details?: JsonObject;
    },
  );
}
