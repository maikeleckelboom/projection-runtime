import { PUBLICATION_TRANSPORT_ATTACHMENT_VERSION } from "@exclave/publication";
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

export const HOST_WARM_STREAM_DESCRIPTOR_VERSION = 1 as const;

export type HostWarmStreamDescriptorVersion = typeof HOST_WARM_STREAM_DESCRIPTOR_VERSION;

export type HostWarmStreamDescriptor = {
  readonly kind: "host.warmStream";
  readonly descriptorVersion: HostWarmStreamDescriptorVersion;
  readonly streamKey: string;
  readonly attachmentVersion: typeof PUBLICATION_TRANSPORT_ATTACHMENT_VERSION;
};

const OWNED_ROOT_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "descriptorVersion",
  "streamKey",
  "attachmentVersion",
]);

export function createHostWarmStreamDescriptorThrowing(input: unknown): HostWarmStreamDescriptor {
  const obj = assertPlainObject(input, "host warm stream descriptor");
  assertExactRootKeys(obj, OWNED_ROOT_KEYS, "host warm stream descriptor");

  if (obj.kind !== "host.warmStream") {
    throwInputRejected(
      `host warm stream descriptor kind must be "host.warmStream", got ${JSON.stringify(obj.kind)}`,
    );
  }

  if (obj.descriptorVersion !== HOST_WARM_STREAM_DESCRIPTOR_VERSION) {
    throwInputRejected(
      `host warm stream descriptor descriptorVersion must be ${HOST_WARM_STREAM_DESCRIPTOR_VERSION}, got ${JSON.stringify(obj.descriptorVersion)}`,
    );
  }

  const streamKey = assertNonEmptyString(obj.streamKey, "warm.streamKey");

  if (obj.attachmentVersion !== PUBLICATION_TRANSPORT_ATTACHMENT_VERSION) {
    throwInputRejected(
      `host warm stream descriptor attachmentVersion must be ${PUBLICATION_TRANSPORT_ATTACHMENT_VERSION}, got ${JSON.stringify(obj.attachmentVersion)}`,
    );
  }

  return {
    kind: "host.warmStream",
    descriptorVersion: HOST_WARM_STREAM_DESCRIPTOR_VERSION,
    streamKey,
    attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
  };
}

export function createHostWarmStreamDescriptor(
  input: HostWarmStreamDescriptor,
): HostWarmStreamDescriptor {
  return createHostWarmStreamDescriptorThrowing(input);
}

export function validateHostWarmStreamDescriptor(
  value: unknown,
): HostContractValidationResult<HostWarmStreamDescriptor> {
  try {
    return validationSuccess(createHostWarmStreamDescriptorThrowing(value));
  } catch (error) {
    const message = validationMessageFromError(error);
    const code: "host-contract.invalidDescriptor" = "host-contract.invalidDescriptor";
    return validationFailure(code, message);
  }
}
