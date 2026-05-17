import type { JsonObject } from "@exclave/base";
import { checkJsonObjectRoot } from "@exclave/base";
import { throwInputRejected } from "./errors";

export type HostContractFailureCode = "host-contract.invalidDescriptor" | "host-contract.rejected";

export type HostContractFailure = {
  readonly code: HostContractFailureCode;
  readonly message: string;
  readonly details?: JsonObject;
};

export type HostContractValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: HostContractFailure };

const VALID_CODES: ReadonlySet<string> = new Set([
  "host-contract.invalidDescriptor",
  "host-contract.rejected",
]);

function isFailureCode(value: unknown): value is HostContractFailureCode {
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

export function createHostContractFailure(input: {
  readonly code: HostContractFailureCode;
  readonly message: string;
  readonly details?: JsonObject;
}): HostContractFailure {
  const obj = assertPlainObject(input, "host contract failure");
  assertExactRootKeys(obj, new Set(["code", "message", "details"]), "host contract failure");

  if (!isFailureCode(obj.code)) {
    throwInputRejected(`invalid host contract failure code: ${String(obj.code)}`);
  }

  const code = obj.code as HostContractFailureCode;
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

export function validateHostContractFailure(value: unknown): HostContractFailure {
  return createHostContractFailure(
    value as {
      readonly code: HostContractFailureCode;
      readonly message: string;
      readonly details?: JsonObject;
    },
  );
}
