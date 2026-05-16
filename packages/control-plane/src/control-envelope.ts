import type { JsonObject } from "@exclave/base";
import { checkJsonObjectRoot, type JsonSafetyResult, safeIsArray } from "@exclave/base";
import { throwInputRejected } from "./errors";

export const CONTROL_ENVELOPE_VERSION = 1 as const;

export type ControlEnvelopeVersion = typeof CONTROL_ENVELOPE_VERSION;

export type ControlRequestKey = string;

export type ControlOperationKey = string;

export type ControlFailureCode =
  | "control.unsupportedOperation"
  | "control.invalidEnvelope"
  | "control.rejected"
  | "control.bindingInvalid";

export type ControlFailure = {
  readonly code: ControlFailureCode;
  readonly message: string;
  readonly details?: JsonObject;
};

export type ControlRequestEnvelope = {
  readonly kind: "control.request";
  readonly envelopeVersion: 1;
  readonly requestKey: ControlRequestKey;
  readonly operationKey: ControlOperationKey;
  readonly payload: JsonObject;
};

export type ControlSuccessEnvelope = {
  readonly kind: "control.response";
  readonly envelopeVersion: 1;
  readonly requestKey: ControlRequestKey;
  readonly ok: true;
  readonly payload: JsonObject;
};

export type ControlFailureEnvelope = {
  readonly kind: "control.response";
  readonly envelopeVersion: 1;
  readonly requestKey: ControlRequestKey;
  readonly ok: false;
  readonly failure: ControlFailure;
};

export type ControlValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ControlFailure };

function isFailureCode(value: unknown): value is ControlFailureCode {
  return (
    value === "control.unsupportedOperation" ||
    value === "control.invalidEnvelope" ||
    value === "control.rejected" ||
    value === "control.bindingInvalid"
  );
}

function validationFailure(message: string): ControlValidationResult<never> {
  return {
    ok: false as const,
    failure: { code: "control.invalidEnvelope", message },
  };
}

function validationSuccess<T>(value: T): ControlValidationResult<T> {
  return { ok: true as const, value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const isArrayResult = safeIsArray(value);
  if (!isArrayResult.ok) {
    return false;
  }
  if (isArrayResult.isArray) {
    return false;
  }
  try {
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
  } catch {
    return false;
  }
}

function validateInputIsPlainData(input: unknown, label: string): void {
  if (typeof input !== "object" || input === null) {
    throwInputRejected(`${label} must be a plain object`);
  }

  const isArrayResult = safeIsArray(input);
  if (!isArrayResult.ok) {
    throwInputRejected(`${label} object inspection failed (isArray)`);
  }
  if (isArrayResult.isArray) {
    throwInputRejected(`${label} must be a plain object, not an array`);
  }

  let proto: object | null;
  try {
    proto = Object.getPrototypeOf(input);
  } catch {
    throwInputRejected(`${label} object inspection failed (getPrototypeOf)`);
  }

  if (proto !== null && proto !== Object.prototype) {
    throwInputRejected(`${label} must be a plain object, not a class instance`);
  }

  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    throwInputRejected(`${label} object inspection failed (ownKeys)`);
  }

  for (const key of keys) {
    if (typeof key === "symbol") {
      throwInputRejected(`${label} must not have symbol keys`);
    }

    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(input, key);
    } catch {
      throwInputRejected(`${label} object inspection failed (getOwnPropertyDescriptor)`);
    }

    if (desc === undefined) {
      throwInputRejected(`${label} property descriptor is missing`);
    }

    if (!desc.enumerable) {
      throwInputRejected(`${label} must not have non-enumerable properties`);
    }

    if (desc.get !== undefined || desc.set !== undefined) {
      throwInputRejected(`${label} must not have accessor properties`);
    }
  }
}

function assertExactRootKeys(value: object, allowedKeys: Set<string>, label: string): void {
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      throwInputRejected(`${label} must not have extra field: ${key}`);
    }
  }
}

function checkExactRootKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
): string | null {
  try {
    const keys = Object.keys(value);
    for (const key of keys) {
      if (!allowedKeys.has(key)) {
        return `Unexpected field: ${key}`;
      }
    }
    return null;
  } catch {
    return "Object inspection failed during exact-key check";
  }
}

export function createControlRequestEnvelope(input: {
  readonly requestKey: ControlRequestKey;
  readonly operationKey: ControlOperationKey;
  readonly payload: JsonObject;
}): ControlRequestEnvelope {
  validateInputIsPlainData(input, "control request input");

  assertExactRootKeys(
    input,
    new Set(["requestKey", "operationKey", "payload"]),
    "control request input",
  );

  if (typeof input.requestKey !== "string") {
    throwInputRejected("requestKey must be a string");
  }

  if (input.requestKey.length === 0) {
    throwInputRejected("requestKey must be a non-empty string");
  }

  if (typeof input.operationKey !== "string") {
    throwInputRejected("operationKey must be a string");
  }

  if (input.operationKey.length === 0) {
    throwInputRejected("operationKey must be a non-empty string");
  }

  const payloadResult: JsonSafetyResult = checkJsonObjectRoot(input.payload);
  if (!payloadResult.ok) {
    throwInputRejected(`payload is not JSON-safe: ${payloadResult.reason}`);
  }

  return {
    kind: "control.request",
    envelopeVersion: CONTROL_ENVELOPE_VERSION,
    requestKey: input.requestKey,
    operationKey: input.operationKey,
    payload: input.payload,
  };
}

export function createControlSuccessEnvelope(input: {
  readonly requestKey: ControlRequestKey;
  readonly payload: JsonObject;
}): ControlSuccessEnvelope {
  validateInputIsPlainData(input, "control success input");

  assertExactRootKeys(input, new Set(["requestKey", "payload"]), "control success input");

  if (typeof input.requestKey !== "string") {
    throwInputRejected("requestKey must be a string");
  }

  if (input.requestKey.length === 0) {
    throwInputRejected("requestKey must be a non-empty string");
  }

  const payloadResult: JsonSafetyResult = checkJsonObjectRoot(input.payload);
  if (!payloadResult.ok) {
    throwInputRejected(`payload is not JSON-safe: ${payloadResult.reason}`);
  }

  return {
    kind: "control.response",
    envelopeVersion: CONTROL_ENVELOPE_VERSION,
    requestKey: input.requestKey,
    ok: true as const,
    payload: input.payload,
  };
}

export function createControlFailureEnvelope(input: {
  readonly requestKey: ControlRequestKey;
  readonly failure: ControlFailure;
}): ControlFailureEnvelope {
  validateInputIsPlainData(input, "control failure input");

  assertExactRootKeys(input, new Set(["requestKey", "failure"]), "control failure input");

  if (typeof input.requestKey !== "string") {
    throwInputRejected("requestKey must be a string");
  }

  if (input.requestKey.length === 0) {
    throwInputRejected("requestKey must be a non-empty string");
  }

  validateInputIsPlainData(input.failure, "failure");

  assertExactRootKeys(input.failure, new Set(["code", "message", "details"]), "failure");

  if (typeof input.failure.code !== "string") {
    throwInputRejected("failure.code must be a string");
  }

  if (!isFailureCode(input.failure.code)) {
    throwInputRejected(`invalid failure code: ${input.failure.code}`);
  }

  if (typeof input.failure.message !== "string") {
    throwInputRejected("failure.message must be a string");
  }

  if (input.failure.message.length === 0) {
    throwInputRejected("failure message must be a non-empty string");
  }

  if (input.failure.details !== undefined) {
    const detailsResult: JsonSafetyResult = checkJsonObjectRoot(input.failure.details);
    if (!detailsResult.ok) {
      throwInputRejected(`failure details are not JSON-safe: ${detailsResult.reason}`);
    }
  }

  return {
    kind: "control.response",
    envelopeVersion: CONTROL_ENVELOPE_VERSION,
    requestKey: input.requestKey,
    ok: false as const,
    failure: {
      code: input.failure.code,
      message: input.failure.message,
      ...(input.failure.details !== undefined ? { details: input.failure.details } : {}),
    },
  };
}

export function validateControlRequestEnvelope(
  value: unknown,
): ControlValidationResult<ControlRequestEnvelope> {
  const rootResult = checkJsonObjectRoot(value);
  if (!rootResult.ok) {
    return validationFailure(`Request envelope is not a plain data object: ${rootResult.reason}`);
  }

  const obj = rootResult.value as Record<string, unknown>;

  const requestKeysError = checkExactRootKeys(
    obj,
    new Set(["kind", "envelopeVersion", "requestKey", "operationKey", "payload"]),
  );
  if (requestKeysError !== null) {
    return validationFailure(requestKeysError);
  }

  if (obj.kind !== "control.request") {
    return validationFailure(`Expected kind "control.request", got ${JSON.stringify(obj.kind)}`);
  }

  if (obj.envelopeVersion !== CONTROL_ENVELOPE_VERSION) {
    return validationFailure(
      `Expected envelopeVersion ${CONTROL_ENVELOPE_VERSION}, got ${JSON.stringify(obj.envelopeVersion)}`,
    );
  }

  if (typeof obj.requestKey !== "string" || obj.requestKey.length === 0) {
    return validationFailure("requestKey must be a non-empty string");
  }

  if (typeof obj.operationKey !== "string" || obj.operationKey.length === 0) {
    return validationFailure("operationKey must be a non-empty string");
  }

  const payloadResult: JsonSafetyResult = checkJsonObjectRoot(obj.payload);
  if (!payloadResult.ok) {
    return validationFailure(`payload is not JSON-safe: ${payloadResult.reason}`);
  }

  return validationSuccess({
    kind: "control.request",
    envelopeVersion: CONTROL_ENVELOPE_VERSION,
    requestKey: obj.requestKey,
    operationKey: obj.operationKey,
    payload: obj.payload as JsonObject,
  });
}

export function validateControlResponseEnvelope(
  value: unknown,
): ControlValidationResult<ControlSuccessEnvelope | ControlFailureEnvelope> {
  const rootResult = checkJsonObjectRoot(value);
  if (!rootResult.ok) {
    return validationFailure(`Response envelope is not a plain data object: ${rootResult.reason}`);
  }

  const obj = rootResult.value as Record<string, unknown>;

  if (obj.kind !== "control.response") {
    return validationFailure(`Expected kind "control.response", got ${JSON.stringify(obj.kind)}`);
  }

  if (obj.envelopeVersion !== CONTROL_ENVELOPE_VERSION) {
    return validationFailure(
      `Expected envelopeVersion ${CONTROL_ENVELOPE_VERSION}, got ${JSON.stringify(obj.envelopeVersion)}`,
    );
  }

  if (typeof obj.requestKey !== "string" || obj.requestKey.length === 0) {
    return validationFailure("requestKey must be a non-empty string");
  }

  if (obj.ok === true) {
    const successKeysError = checkExactRootKeys(
      obj,
      new Set(["kind", "envelopeVersion", "requestKey", "ok", "payload"]),
    );
    if (successKeysError !== null) {
      return validationFailure(successKeysError);
    }

    const payloadResult: JsonSafetyResult = checkJsonObjectRoot(obj.payload);
    if (!payloadResult.ok) {
      return validationFailure(`success payload is not JSON-safe: ${payloadResult.reason}`);
    }

    return validationSuccess({
      kind: "control.response",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      requestKey: obj.requestKey,
      ok: true as const,
      payload: obj.payload as JsonObject,
    });
  }

  if (obj.ok === false) {
    const failureEnvKeysError = checkExactRootKeys(
      obj,
      new Set(["kind", "envelopeVersion", "requestKey", "ok", "failure"]),
    );
    if (failureEnvKeysError !== null) {
      return validationFailure(failureEnvKeysError);
    }

    const failure = obj.failure;

    const isArrayResult = safeIsArray(failure);
    if (!isArrayResult.ok) {
      return validationFailure("failure object inspection failed (isArray)");
    }

    if (typeof failure !== "object" || failure === null || isArrayResult.isArray) {
      return validationFailure("failure must be a non-null object");
    }

    if (!isPlainObject(failure)) {
      return validationFailure("failure must be a plain data object");
    }

    const failureObj = failure as Record<string, unknown>;

    const failureKeysError = checkExactRootKeys(
      failureObj,
      new Set(["code", "message", "details"]),
    );
    if (failureKeysError !== null) {
      return validationFailure(failureKeysError);
    }

    if (typeof failureObj.code !== "string" || !isFailureCode(failureObj.code)) {
      return validationFailure("Invalid failure code");
    }

    if (typeof failureObj.message !== "string" || (failureObj.message as string).length === 0) {
      return validationFailure("failure message must be a non-empty string");
    }

    if (failureObj.details !== undefined) {
      const detailsResult: JsonSafetyResult = checkJsonObjectRoot(failureObj.details);
      if (!detailsResult.ok) {
        return validationFailure(`failure details are not JSON-safe: ${detailsResult.reason}`);
      }
    }

    const failureResult: ControlFailure = {
      code: failureObj.code as ControlFailureCode,
      message: failureObj.message as string,
      ...(failureObj.details !== undefined ? { details: failureObj.details as JsonObject } : {}),
    };

    return validationSuccess({
      kind: "control.response",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      requestKey: obj.requestKey,
      ok: false as const,
      failure: failureResult,
    });
  }

  return validationFailure("ok must be true or false");
}

export function validateControlResponseForRequest(
  request: ControlRequestEnvelope,
  response: ControlSuccessEnvelope | ControlFailureEnvelope,
): ControlValidationResult<ControlSuccessEnvelope | ControlFailureEnvelope> {
  if (request.requestKey !== response.requestKey) {
    return validationFailure(
      `requestKey mismatch: expected "${request.requestKey}", got "${response.requestKey}"`,
    );
  }

  return validationSuccess(response);
}
