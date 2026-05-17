import { checkJsonObjectRoot, ExclaveError } from "@exclave/base";
import { RESOURCE_READ_RANGE_OPERATION_KEY } from "@exclave/resource";
import { throwInputRejected } from "./errors";
import type { HostContractFailure, HostContractValidationResult } from "./host-failure";

export type HostResourcePlaneDescriptor = {
  readonly kind: "host.resourcePlane";
  readonly readRangeOperationKey: typeof RESOURCE_READ_RANGE_OPERATION_KEY;
};

const OWNED_ROOT_KEYS: ReadonlySet<string> = new Set(["kind", "readRangeOperationKey"]);

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

export function createHostResourcePlaneDescriptorThrowing(
  input: unknown,
): HostResourcePlaneDescriptor {
  const obj = assertPlainObject(input, "host resource-plane descriptor");
  assertExactRootKeys(obj, OWNED_ROOT_KEYS, "host resource-plane descriptor");

  if (obj.kind !== "host.resourcePlane") {
    throwInputRejected(
      `host resource-plane descriptor kind must be "host.resourcePlane", got ${JSON.stringify(obj.kind)}`,
    );
  }

  if (obj.readRangeOperationKey !== RESOURCE_READ_RANGE_OPERATION_KEY) {
    throwInputRejected(
      `host resource-plane descriptor readRangeOperationKey must be "${RESOURCE_READ_RANGE_OPERATION_KEY}", got ${JSON.stringify(obj.readRangeOperationKey)}`,
    );
  }

  return {
    kind: "host.resourcePlane",
    readRangeOperationKey: RESOURCE_READ_RANGE_OPERATION_KEY,
  };
}

export function createHostResourcePlaneDescriptor(
  input: HostResourcePlaneDescriptor,
): HostResourcePlaneDescriptor {
  return createHostResourcePlaneDescriptorThrowing(input);
}

export function validateHostResourcePlaneDescriptor(
  value: unknown,
): HostContractValidationResult<HostResourcePlaneDescriptor> {
  try {
    return validationSuccess(createHostResourcePlaneDescriptorThrowing(value));
  } catch (error) {
    const message =
      error instanceof ExclaveError && typeof error.details.detail === "string"
        ? error.details.detail
        : error instanceof Error
          ? error.message
          : "Unknown validation error";
    const code: "host-contract.invalidDescriptor" = "host-contract.invalidDescriptor";
    return validationFailure(code, message);
  }
}
