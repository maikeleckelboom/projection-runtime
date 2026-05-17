import { checkJsonObjectRoot, ExclaveError } from "@exclave/base";
import { CONTROL_ENVELOPE_VERSION } from "@exclave/control-plane";
import { throwInputRejected } from "./errors";
import type { HostContractFailure, HostContractValidationResult } from "./host-failure";

export type HostControlPlaneDescriptor = {
  readonly kind: "host.controlPlane";
  readonly envelopeVersion: typeof CONTROL_ENVELOPE_VERSION;
  readonly endpointKey: string;
  readonly operationKeys: readonly string[];
};

const OWNED_ROOT_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "envelopeVersion",
  "endpointKey",
  "operationKeys",
]);

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

function validationFailure(
  code: "host-contract.invalidDescriptor" | "host-contract.rejected",
  message: string,
): HostContractValidationResult<never> {
  return {
    ok: false as const,
    failure: { code, message } as HostContractFailure,
  };
}

function validationSuccess<T>(value: T): HostContractValidationResult<T> {
  return { ok: true as const, value };
}

export function createHostControlPlaneDescriptorThrowing(
  input: unknown,
): HostControlPlaneDescriptor {
  const obj = assertPlainObject(input, "host control-plane descriptor");
  assertExactRootKeys(obj, OWNED_ROOT_KEYS, "host control-plane descriptor");

  if (obj.kind !== "host.controlPlane") {
    throwInputRejected(
      `host control-plane descriptor kind must be "host.controlPlane", got ${JSON.stringify(obj.kind)}`,
    );
  }

  if (obj.envelopeVersion !== CONTROL_ENVELOPE_VERSION) {
    throwInputRejected(
      `host control-plane descriptor envelopeVersion must be ${CONTROL_ENVELOPE_VERSION}, got ${JSON.stringify(obj.envelopeVersion)}`,
    );
  }

  const endpointKey = assertNonEmptyString(obj.endpointKey, "control.endpointKey");

  if (!Array.isArray(obj.operationKeys)) {
    throwInputRejected("control.operationKeys must be an array");
  }

  if (obj.operationKeys.length === 0) {
    throwInputRejected("control.operationKeys must be a non-empty array");
  }

  const operationKeys: string[] = [];
  for (let i = 0; i < obj.operationKeys.length; i++) {
    const key = obj.operationKeys[i];
    if (typeof key !== "string") {
      throwInputRejected(`control.operationKeys[${i}] must be a string`);
    }
    if (key.length === 0) {
      throwInputRejected(`control.operationKeys[${i}] must be a non-empty string`);
    }
    operationKeys.push(key);
  }

  return {
    kind: "host.controlPlane",
    envelopeVersion: CONTROL_ENVELOPE_VERSION,
    endpointKey,
    operationKeys,
  };
}

export function createHostControlPlaneDescriptor(
  input: HostControlPlaneDescriptor,
): HostControlPlaneDescriptor {
  return createHostControlPlaneDescriptorThrowing(input);
}

export function validateHostControlPlaneDescriptor(
  value: unknown,
): HostContractValidationResult<HostControlPlaneDescriptor> {
  try {
    return validationSuccess(createHostControlPlaneDescriptorThrowing(value));
  } catch (error) {
    const message =
      error instanceof ExclaveError && typeof error.details.detail === "string"
        ? error.details.detail
        : error instanceof Error
          ? error.message
          : "Unknown validation error";
    const code: "host-contract.rejected" = "host-contract.rejected";
    return validationFailure(code, message);
  }
}
