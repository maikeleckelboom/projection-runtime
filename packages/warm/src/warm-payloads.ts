import type { JsonObject } from "@exclave/base";
import { checkJsonObjectRoot } from "@exclave/base";
import { throwInputRejected } from "./errors";

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

const INVALIDATION_ROOT_KEYS: ReadonlySet<string> = new Set(["reason", "affectedKey", "revision"]);

export function createWarmInvalidationPayload(input: {
  readonly reason: string;
  readonly affectedKey?: string;
  readonly revision?: string;
}): JsonObject {
  const obj = assertPlainObject(input, "warm invalidation payload input");
  assertExactRootKeys(obj, INVALIDATION_ROOT_KEYS, "warm invalidation payload input");

  const reason = assertNonEmptyString(obj.reason, "invalidation.reason");

  const payload: Record<string, unknown> = { reason };

  if (obj.affectedKey !== undefined) {
    payload.affectedKey = assertNonEmptyString(obj.affectedKey, "invalidation.affectedKey");
  }

  if (obj.revision !== undefined) {
    payload.revision = assertNonEmptyString(obj.revision, "invalidation.revision");
  }

  const result = checkJsonObjectRoot(payload);
  if (!result.ok) {
    throwInputRejected(`internal: invalidation payload is not JSON-safe: ${result.reason}`);
  }

  return result.value as JsonObject;
}
