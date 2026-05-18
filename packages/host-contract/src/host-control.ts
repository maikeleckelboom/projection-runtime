import { CONTROL_ENVELOPE_VERSION } from "@exclave/control-plane";
import { throwInputRejected } from "./errors";
import type { HostContractValidationResult } from "./host-failure";
import {
  assertExactRootKeys,
  assertNonEmptyString,
  assertPlainObject,
  validationFailure,
  validationMessageFromError,
  validationSuccess,
} from "./validation";

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
    const message = validationMessageFromError(error);
    const code: "host-contract.invalidDescriptor" = "host-contract.invalidDescriptor";
    return validationFailure(code, message);
  }
}
