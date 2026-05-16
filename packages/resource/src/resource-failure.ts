import type { JsonObject } from "@exclave/base";
import { checkJsonObjectRoot } from "@exclave/base";
import type { BindingValidityFailure } from "@exclave/session";
import { throwInputRejected } from "./errors";

export type ResourceFailureCode =
  | "resource.invalidHandle"
  | "resource.staleBinding"
  | "resource.invalidRange"
  | "resource.unavailable"
  | "resource.rejected";

export type ResourceFailure = {
  readonly code: ResourceFailureCode;
  readonly message: string;
  readonly details?: JsonObject;
};

const VALID_CODES: ReadonlySet<string> = new Set([
  "resource.invalidHandle",
  "resource.staleBinding",
  "resource.invalidRange",
  "resource.unavailable",
  "resource.rejected",
]);

function isFailureCode(value: unknown): value is ResourceFailureCode {
  return typeof value === "string" && VALID_CODES.has(value);
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

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throwInputRejected(`${label} must be a string`);
  }
  if (value.length === 0) {
    throwInputRejected(`${label} must be a non-empty string`);
  }
  return value;
}

function assertJsonObject(value: unknown, path: string): void {
  const result = checkJsonObjectRoot(value);
  if (!result.ok) {
    throwInputRejected(`${path} is not JSON-safe: ${result.reason}`);
  }
}

export function createResourceFailure(input: {
  readonly code: ResourceFailureCode;
  readonly message: string;
  readonly details?: JsonObject;
}): ResourceFailure {
  const obj = assertPlainObject(input, "resource failure");
  assertExactRootKeys(obj, new Set(["code", "message", "details"]), "resource failure");

  if (!isFailureCode(obj.code)) {
    throwInputRejected(`invalid resource failure code: ${String(obj.code)}`);
  }

  const code = obj.code as ResourceFailureCode;

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

export function validateResourceFailure(value: unknown): ResourceFailure {
  return createResourceFailure(
    value as {
      readonly code: ResourceFailureCode;
      readonly message: string;
      readonly details?: JsonObject;
    },
  );
}

export function createInvalidRangeResourceFailure(input: {
  readonly message: string;
  readonly handleKey?: string;
  readonly offset?: number;
  readonly byteLength?: number;
  readonly descriptorByteLength?: number;
}): ResourceFailure {
  const obj = assertPlainObject(input, "invalid range failure input");
  assertExactRootKeys(
    obj,
    new Set(["message", "handleKey", "offset", "byteLength", "descriptorByteLength"]),
    "invalid range failure input",
  );

  const message = assertNonEmptyString(obj.message, "invalid range failure message");

  const details: Record<string, unknown> = {};

  if (obj.handleKey !== undefined) {
    details.handleKey = assertNonEmptyString(obj.handleKey, "invalid range handleKey");
  }

  if (obj.offset !== undefined) {
    if (typeof obj.offset !== "number" || !Number.isFinite(obj.offset)) {
      throwInputRejected("invalid range offset must be a finite number");
    }
    details.offset = obj.offset;
  }

  if (obj.byteLength !== undefined) {
    if (typeof obj.byteLength !== "number" || !Number.isFinite(obj.byteLength)) {
      throwInputRejected("invalid range byteLength must be a finite number");
    }
    details.byteLength = obj.byteLength;
  }

  if (obj.descriptorByteLength !== undefined) {
    if (
      typeof obj.descriptorByteLength !== "number" ||
      !Number.isFinite(obj.descriptorByteLength)
    ) {
      throwInputRejected("invalid range descriptorByteLength must be a finite number");
    }
    details.descriptorByteLength = obj.descriptorByteLength;
  }

  const code: ResourceFailureCode = "resource.invalidRange";

  return {
    code,
    message,
    ...(Object.keys(details).length > 0 ? { details: details as JsonObject } : {}),
  };
}

function encodeEpoch(epoch: string): string {
  const CANONICAL_EPOCH_RE = /^(?:0|[1-9][0-9]*)$/;
  if (!CANONICAL_EPOCH_RE.test(epoch)) {
    throwInputRejected(
      `authorityEpoch must be a canonical non-negative decimal string, got: ${epoch}`,
    );
  }
  return epoch;
}

export function createStaleBindingResourceFailure(
  failure: BindingValidityFailure,
): ResourceFailure {
  const code: ResourceFailureCode = "resource.staleBinding";

  const binding = failure.binding;
  const bindingDetails: Record<string, unknown> = {
    authorityKey: binding.authorityKey,
    surfaceKey: binding.surfaceKey,
    authorityEpoch: encodeEpoch(String(binding.authorityEpoch)),
  };

  const details: Record<string, unknown> = {
    reason: failure.reason,
    rebindRequired: failure.rebindRequired,
    binding: bindingDetails,
  };

  if (failure.reason === "bindingInvalidated") {
    details.invalidationReason = failure.invalidationReason;
  }

  if ("expected" in failure) {
    const expected = failure.expected;
    details.expected = {
      authorityKey: expected.authorityKey,
      surfaceKey: expected.surfaceKey,
      authorityEpoch: encodeEpoch(String(expected.authorityEpoch)),
    };
  }

  assertJsonObject(details, "stale binding failure details");

  return {
    code,
    message: `Resource access rejected: ${failure.reason}`,
    details: details as JsonObject,
  };
}
