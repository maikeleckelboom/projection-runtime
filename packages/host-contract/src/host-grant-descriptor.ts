import type { InvalidationReason } from "@exclave/session";
import { throwInputRejected } from "./errors";
import type { HostAuthorityRef } from "./host-authority-ref";
import { validateHostAuthorityRefThrowing } from "./host-authority-ref";
import type { HostControlPlaneDescriptor } from "./host-control";
import { createHostControlPlaneDescriptorThrowing } from "./host-control";
import type { HostContractValidationResult } from "./host-failure";
import type { HostHotRegionDescriptor } from "./host-hot";
import { createHostHotRegionDescriptorThrowing } from "./host-hot";
import type { HostResourcePlaneDescriptor } from "./host-resource";
import { createHostResourcePlaneDescriptorThrowing } from "./host-resource";
import type { HostWarmStreamDescriptor } from "./host-warm";
import { createHostWarmStreamDescriptorThrowing } from "./host-warm";
import {
  assertExactRootKeys,
  assertPlainObject,
  validationFailure,
  validationMessageFromError,
  validationSuccess,
} from "./validation";

export const HOST_CONTRACT_VERSION = 1 as const;

export type HostContractVersion = typeof HOST_CONTRACT_VERSION;

export type HostGrantDescriptor = {
  readonly kind: "host.grantDescriptor";
  readonly contractVersion: HostContractVersion;
  readonly authority: HostAuthorityRef;
  readonly hotRegions?: readonly HostHotRegionDescriptor[];
  readonly control?: HostControlPlaneDescriptor;
  readonly warmStreams?: readonly HostWarmStreamDescriptor[];
  readonly resourcePlane?: HostResourcePlaneDescriptor;
};

export type HostGrantReadyEnvelope = {
  readonly kind: "host.grantReady";
  readonly contractVersion: HostContractVersion;
  readonly grant: HostGrantDescriptor;
};

export type HostGrantInvalidatedEnvelope = {
  readonly kind: "host.grantInvalidated";
  readonly contractVersion: HostContractVersion;
  readonly authority: HostAuthorityRef;
  readonly reason: InvalidationReason;
  readonly rebindRequired: true;
};

const VALID_INVALIDATION_REASONS: ReadonlySet<string> = new Set([
  "authorityRestarted",
  "authorityReplaced",
  "grantReplaced",
  "grantRevoked",
]);

const GRANT_DESCRIPTOR_ROOT_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "contractVersion",
  "authority",
  "hotRegions",
  "control",
  "warmStreams",
  "resourcePlane",
]);

const READY_ROOT_KEYS: ReadonlySet<string> = new Set(["kind", "contractVersion", "grant"]);

const INVALIDATED_ROOT_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "contractVersion",
  "authority",
  "reason",
  "rebindRequired",
]);

function createHostGrantDescriptorThrowing(input: unknown): HostGrantDescriptor {
  const obj = assertPlainObject(input, "host grant descriptor");
  assertExactRootKeys(obj, GRANT_DESCRIPTOR_ROOT_KEYS, "host grant descriptor");

  if (obj.kind !== "host.grantDescriptor") {
    throwInputRejected(
      `host grant descriptor kind must be "host.grantDescriptor", got ${JSON.stringify(obj.kind)}`,
    );
  }

  if (obj.contractVersion !== HOST_CONTRACT_VERSION) {
    throwInputRejected(
      `host grant descriptor contractVersion must be ${HOST_CONTRACT_VERSION}, got ${JSON.stringify(obj.contractVersion)}`,
    );
  }

  const authority = validateHostAuthorityRefThrowing(obj.authority);

  let hasLane = false;

  let hotRegions: readonly HostHotRegionDescriptor[] | undefined;
  if (obj.hotRegions !== undefined) {
    if (!Array.isArray(obj.hotRegions)) {
      throwInputRejected("grant.hotRegions must be an array when present");
    }
    if (obj.hotRegions.length === 0) {
      throwInputRejected("grant.hotRegions must be non-empty when present");
    }
    const regions: HostHotRegionDescriptor[] = [];
    const seenKeys = new Set<string>();
    for (let i = 0; i < obj.hotRegions.length; i++) {
      const region = createHostHotRegionDescriptorThrowing(obj.hotRegions[i]);
      if (seenKeys.has(region.hotRegionKey)) {
        throwInputRejected(
          `grant.hotRegions must not have duplicate hotRegionKey: ${region.hotRegionKey}`,
        );
      }
      seenKeys.add(region.hotRegionKey);
      regions.push(region);
    }
    hotRegions = regions;
    hasLane = true;
  }

  let control: HostControlPlaneDescriptor | undefined;
  if (obj.control !== undefined) {
    control = createHostControlPlaneDescriptorThrowing(obj.control);
    hasLane = true;
  }

  let warmStreams: readonly HostWarmStreamDescriptor[] | undefined;
  if (obj.warmStreams !== undefined) {
    if (!Array.isArray(obj.warmStreams)) {
      throwInputRejected("grant.warmStreams must be an array when present");
    }
    if (obj.warmStreams.length === 0) {
      throwInputRejected("grant.warmStreams must be non-empty when present");
    }
    const streams: HostWarmStreamDescriptor[] = [];
    const seenKeys = new Set<string>();
    for (let i = 0; i < obj.warmStreams.length; i++) {
      const stream = createHostWarmStreamDescriptorThrowing(obj.warmStreams[i]);
      if (seenKeys.has(stream.streamKey)) {
        throwInputRejected(
          `grant.warmStreams must not have duplicate streamKey: ${stream.streamKey}`,
        );
      }
      seenKeys.add(stream.streamKey);
      streams.push(stream);
    }
    warmStreams = streams;
    hasLane = true;
  }

  let resourcePlane: HostResourcePlaneDescriptor | undefined;
  if (obj.resourcePlane !== undefined) {
    resourcePlane = createHostResourcePlaneDescriptorThrowing(obj.resourcePlane);
    hasLane = true;
  }

  if (!hasLane) {
    throwInputRejected(
      "host grant descriptor must have at least one lane (hotRegions, control, warmStreams, or resourcePlane)",
    );
  }

  return {
    kind: "host.grantDescriptor",
    contractVersion: HOST_CONTRACT_VERSION,
    authority,
    ...(hotRegions !== undefined ? { hotRegions } : {}),
    ...(control !== undefined ? { control } : {}),
    ...(warmStreams !== undefined ? { warmStreams } : {}),
    ...(resourcePlane !== undefined ? { resourcePlane } : {}),
  };
}

export function createHostGrantDescriptor(input: HostGrantDescriptor): HostGrantDescriptor {
  return createHostGrantDescriptorThrowing(input);
}

export function validateHostGrantDescriptor(
  value: unknown,
): HostContractValidationResult<HostGrantDescriptor> {
  try {
    return validationSuccess(createHostGrantDescriptorThrowing(value));
  } catch (error) {
    const message = validationMessageFromError(error);
    const code: "host-contract.invalidDescriptor" = "host-contract.invalidDescriptor";
    return validationFailure(code, message);
  }
}

function createHostGrantReadyEnvelopeThrowing(input: unknown): HostGrantReadyEnvelope {
  const obj = assertPlainObject(input, "host grant ready envelope");
  assertExactRootKeys(obj, READY_ROOT_KEYS, "host grant ready envelope");

  if (obj.kind !== "host.grantReady") {
    throwInputRejected(
      `host grant ready envelope kind must be "host.grantReady", got ${JSON.stringify(obj.kind)}`,
    );
  }

  if (obj.contractVersion !== HOST_CONTRACT_VERSION) {
    throwInputRejected(
      `host grant ready envelope contractVersion must be ${HOST_CONTRACT_VERSION}, got ${JSON.stringify(obj.contractVersion)}`,
    );
  }

  const grant = createHostGrantDescriptorThrowing(obj.grant);

  return {
    kind: "host.grantReady",
    contractVersion: HOST_CONTRACT_VERSION,
    grant,
  };
}

export function createHostGrantReadyEnvelope(
  input: HostGrantReadyEnvelope,
): HostGrantReadyEnvelope {
  return createHostGrantReadyEnvelopeThrowing(input);
}

export function validateHostGrantReadyEnvelope(
  value: unknown,
): HostContractValidationResult<HostGrantReadyEnvelope> {
  try {
    return validationSuccess(createHostGrantReadyEnvelopeThrowing(value));
  } catch (error) {
    const message = validationMessageFromError(error);
    const code: "host-contract.invalidDescriptor" = "host-contract.invalidDescriptor";
    return validationFailure(code, message);
  }
}

function createHostGrantInvalidatedEnvelopeThrowing(input: unknown): HostGrantInvalidatedEnvelope {
  const obj = assertPlainObject(input, "host grant invalidated envelope");
  assertExactRootKeys(obj, INVALIDATED_ROOT_KEYS, "host grant invalidated envelope");

  if (obj.kind !== "host.grantInvalidated") {
    throwInputRejected(
      `host grant invalidated envelope kind must be "host.grantInvalidated", got ${JSON.stringify(obj.kind)}`,
    );
  }

  if (obj.contractVersion !== HOST_CONTRACT_VERSION) {
    throwInputRejected(
      `host grant invalidated envelope contractVersion must be ${HOST_CONTRACT_VERSION}, got ${JSON.stringify(obj.contractVersion)}`,
    );
  }

  const authority = validateHostAuthorityRefThrowing(obj.authority);

  const reason = obj.reason;
  if (typeof reason !== "string" || !VALID_INVALIDATION_REASONS.has(reason)) {
    throwInputRejected(
      `host grant invalidated reason must be one of ${[...VALID_INVALIDATION_REASONS].join(", ")}, got ${JSON.stringify(reason)}`,
    );
  }

  if (obj.rebindRequired !== true) {
    throwInputRejected("host grant invalidated rebindRequired must be true");
  }

  return {
    kind: "host.grantInvalidated",
    contractVersion: HOST_CONTRACT_VERSION,
    authority,
    reason: reason as InvalidationReason,
    rebindRequired: true as const,
  };
}

export function createHostGrantInvalidatedEnvelope(
  input: HostGrantInvalidatedEnvelope,
): HostGrantInvalidatedEnvelope {
  return createHostGrantInvalidatedEnvelopeThrowing(input);
}

export function validateHostGrantInvalidatedEnvelope(
  value: unknown,
): HostContractValidationResult<HostGrantInvalidatedEnvelope> {
  try {
    return validationSuccess(createHostGrantInvalidatedEnvelopeThrowing(value));
  } catch (error) {
    const message = validationMessageFromError(error);
    const code: "host-contract.invalidDescriptor" = "host-contract.invalidDescriptor";
    return validationFailure(code, message);
  }
}
