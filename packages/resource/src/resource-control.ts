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
import { createResourceFailure, type ResourceFailure } from "./resource-failure";
import {
  createResourceReadRangeReceiptPayload,
  createResourceReadRangeRequestPayload,
  type ResourceReadRangeReceiptPayload,
  type ResourceReadRangeRequestPayload,
} from "./resource-range";

export const RESOURCE_READ_RANGE_OPERATION_KEY = "resource.readRange" as const;

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
  readonly resourceFailure: ResourceFailure;
}): ControlFailureEnvelope {
  const normalizedResourceFailure = createResourceFailure(input.resourceFailure);
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
