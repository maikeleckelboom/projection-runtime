import type { JsonObject } from "@exclave/base";
import type {
  ControlFailureEnvelope,
  ControlRequestEnvelope,
  ControlRequestKey,
  ControlSuccessEnvelope,
} from "@exclave/control-plane";
import {
  createControlFailureEnvelope,
  createControlRequestEnvelope,
  createControlSuccessEnvelope,
} from "@exclave/control-plane";
import { createResourceReceiptFailure, type ResourceReceiptFailure } from "./resource-failure";
import {
  createResourceReadRangeReceiptPayload,
  createResourceReadRangeRequestPayload,
  type ResourceReadRangeReceiptPayload,
  type ResourceReadRangeRequestPayload,
} from "./resource-range";

export const RESOURCE_READ_RANGE_OPERATION_KEY = "resource.readRange" as const;
export const RESOURCE_OPEN_OPERATION_KEY = "resource.open" as const;
export const RESOURCE_READ_CHUNK_OPERATION_KEY = "resource.readChunk" as const;
export const RESOURCE_MAP_WINDOW_OPERATION_KEY = "resource.mapWindow" as const;
export const RESOURCE_CLOSE_MAPPING_OPERATION_KEY = "resource.closeMapping" as const;
export const RESOURCE_CLOSE_HANDLE_OPERATION_KEY = "resource.closeHandle" as const;

export const RESOURCE_PLANE_V1_OPERATION_KEYS: readonly [
  typeof RESOURCE_OPEN_OPERATION_KEY,
  typeof RESOURCE_READ_CHUNK_OPERATION_KEY,
  typeof RESOURCE_MAP_WINDOW_OPERATION_KEY,
  typeof RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
  typeof RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
] = [
  RESOURCE_OPEN_OPERATION_KEY,
  RESOURCE_READ_CHUNK_OPERATION_KEY,
  RESOURCE_MAP_WINDOW_OPERATION_KEY,
  RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
  RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
] as const;

export type ResourcePlaneV1OperationKey = (typeof RESOURCE_PLANE_V1_OPERATION_KEYS)[number];

export function createResourceReadRangeControlRequest(input: {
  readonly requestKey: ControlRequestKey;
  readonly payload: ResourceReadRangeRequestPayload;
}): ControlRequestEnvelope {
  const normalizedPayload = createResourceReadRangeRequestPayload(input.payload);
  return createControlRequestEnvelope({
    requestKey: input.requestKey,
    operationKey: RESOURCE_READ_RANGE_OPERATION_KEY,
    payload: normalizedPayload as unknown as JsonObject,
  });
}

export function createResourceReadRangeControlSuccess(input: {
  readonly requestKey: ControlRequestKey;
  readonly payload: ResourceReadRangeReceiptPayload;
}): ControlSuccessEnvelope {
  const normalizedPayload = createResourceReadRangeReceiptPayload(input.payload);
  return createControlSuccessEnvelope({
    requestKey: input.requestKey,
    payload: normalizedPayload as unknown as JsonObject,
  });
}

export function createResourceControlFailure(input: {
  readonly requestKey: ControlRequestKey;
  readonly resourceFailure: ResourceReceiptFailure;
}): ControlFailureEnvelope {
  const normalizedResourceFailure = createResourceReceiptFailure(input.resourceFailure);
  const details = {
    resourceFailure: normalizedResourceFailure,
  };

  return createControlFailureEnvelope({
    requestKey: input.requestKey,
    failure: {
      code: "control.rejected" as const,
      message: `Resource operation failed: ${normalizedResourceFailure.code}`,
      details,
    } as unknown as {
      readonly code: "control.rejected";
      readonly message: string;
      readonly details?: JsonObject;
    },
  });
}
