import {
  RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
  RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
  RESOURCE_MAP_WINDOW_OPERATION_KEY,
  RESOURCE_OPEN_OPERATION_KEY,
  RESOURCE_READ_CHUNK_OPERATION_KEY,
} from "@exclave/resource";
import { throwInputRejected } from "./errors";
import type { HostContractValidationResult } from "./host-failure";
import {
  assertExactRootKeys,
  assertPlainObject,
  validationFailure,
  validationMessageFromError,
  validationSuccess,
} from "./validation";

export type HostResourcePlaneDescriptor = {
  readonly kind: "host.resourcePlane";
  readonly openOperationKey: typeof RESOURCE_OPEN_OPERATION_KEY;
  readonly readChunkOperationKey: typeof RESOURCE_READ_CHUNK_OPERATION_KEY;
  readonly mapWindowOperationKey: typeof RESOURCE_MAP_WINDOW_OPERATION_KEY;
  readonly closeMappingOperationKey: typeof RESOURCE_CLOSE_MAPPING_OPERATION_KEY;
  readonly closeHandleOperationKey: typeof RESOURCE_CLOSE_HANDLE_OPERATION_KEY;
};

const OWNED_ROOT_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "openOperationKey",
  "readChunkOperationKey",
  "mapWindowOperationKey",
  "closeMappingOperationKey",
  "closeHandleOperationKey",
]);

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

  if (obj.openOperationKey !== RESOURCE_OPEN_OPERATION_KEY) {
    throwInputRejected(
      `host resource-plane descriptor openOperationKey must be "${RESOURCE_OPEN_OPERATION_KEY}", got ${JSON.stringify(obj.openOperationKey)}`,
    );
  }

  if (obj.readChunkOperationKey !== RESOURCE_READ_CHUNK_OPERATION_KEY) {
    throwInputRejected(
      `host resource-plane descriptor readChunkOperationKey must be "${RESOURCE_READ_CHUNK_OPERATION_KEY}", got ${JSON.stringify(obj.readChunkOperationKey)}`,
    );
  }

  if (obj.mapWindowOperationKey !== RESOURCE_MAP_WINDOW_OPERATION_KEY) {
    throwInputRejected(
      `host resource-plane descriptor mapWindowOperationKey must be "${RESOURCE_MAP_WINDOW_OPERATION_KEY}", got ${JSON.stringify(obj.mapWindowOperationKey)}`,
    );
  }

  if (obj.closeMappingOperationKey !== RESOURCE_CLOSE_MAPPING_OPERATION_KEY) {
    throwInputRejected(
      `host resource-plane descriptor closeMappingOperationKey must be "${RESOURCE_CLOSE_MAPPING_OPERATION_KEY}", got ${JSON.stringify(obj.closeMappingOperationKey)}`,
    );
  }

  if (obj.closeHandleOperationKey !== RESOURCE_CLOSE_HANDLE_OPERATION_KEY) {
    throwInputRejected(
      `host resource-plane descriptor closeHandleOperationKey must be "${RESOURCE_CLOSE_HANDLE_OPERATION_KEY}", got ${JSON.stringify(obj.closeHandleOperationKey)}`,
    );
  }

  return {
    kind: "host.resourcePlane",
    openOperationKey: RESOURCE_OPEN_OPERATION_KEY,
    readChunkOperationKey: RESOURCE_READ_CHUNK_OPERATION_KEY,
    mapWindowOperationKey: RESOURCE_MAP_WINDOW_OPERATION_KEY,
    closeMappingOperationKey: RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
    closeHandleOperationKey: RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
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
    const message = validationMessageFromError(error);
    const code: "host-contract.invalidDescriptor" = "host-contract.invalidDescriptor";
    return validationFailure(code, message);
  }
}
