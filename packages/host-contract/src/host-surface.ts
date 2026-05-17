import { checkJsonObjectRoot, ExclaveError } from "@exclave/base";
import type { InvalidationReason } from "@exclave/session";
import { throwInputRejected } from "./errors";
import type { HostControlPlaneDescriptor } from "./host-control";
import { createHostControlPlaneDescriptorThrowing } from "./host-control";
import type { HostContractFailure, HostContractValidationResult } from "./host-failure";
import type { HostHotRegionDescriptor } from "./host-hot";
import { createHostHotRegionDescriptorThrowing } from "./host-hot";
import type { HostAuthorityOwner } from "./host-owner";
import { validateHostAuthorityOwnerThrowing } from "./host-owner";
import type { HostResourcePlaneDescriptor } from "./host-resource";
import { createHostResourcePlaneDescriptorThrowing } from "./host-resource";
import type { HostWarmStreamDescriptor } from "./host-warm";
import { createHostWarmStreamDescriptorThrowing } from "./host-warm";

export const HOST_CONTRACT_VERSION = 1 as const;

export type HostContractVersion = typeof HOST_CONTRACT_VERSION;

export type HostSurfaceDescriptor = {
  readonly kind: "host.surface";
  readonly contractVersion: HostContractVersion;
  readonly owner: HostAuthorityOwner;
  readonly hotRegions?: readonly HostHotRegionDescriptor[];
  readonly control?: HostControlPlaneDescriptor;
  readonly warmStreams?: readonly HostWarmStreamDescriptor[];
  readonly resourcePlane?: HostResourcePlaneDescriptor;
};

export type HostSurfaceReadyEnvelope = {
  readonly kind: "host.surfaceReady";
  readonly contractVersion: HostContractVersion;
  readonly surface: HostSurfaceDescriptor;
};

export type HostSurfaceInvalidatedEnvelope = {
  readonly kind: "host.surfaceInvalidated";
  readonly contractVersion: HostContractVersion;
  readonly owner: HostAuthorityOwner;
  readonly reason: InvalidationReason;
  readonly rebindRequired: true;
};

const VALID_INVALIDATION_REASONS: ReadonlySet<string> = new Set([
  "authorityRestarted",
  "authorityReplaced",
  "surfaceReplaced",
  "surfaceRevoked",
]);

const SURFACE_OWNED_ROOT_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "contractVersion",
  "owner",
  "hotRegions",
  "control",
  "warmStreams",
  "resourcePlane",
]);

const READY_OWNED_ROOT_KEYS: ReadonlySet<string> = new Set(["kind", "contractVersion", "surface"]);

const INVALIDATED_OWNED_ROOT_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "contractVersion",
  "owner",
  "reason",
  "rebindRequired",
]);

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

function createHostSurfaceDescriptorThrowing(input: unknown): HostSurfaceDescriptor {
  const obj = assertPlainObject(input, "host surface descriptor");
  assertExactRootKeys(obj, SURFACE_OWNED_ROOT_KEYS, "host surface descriptor");

  if (obj.kind !== "host.surface") {
    throwInputRejected(
      `host surface descriptor kind must be "host.surface", got ${JSON.stringify(obj.kind)}`,
    );
  }

  if (obj.contractVersion !== HOST_CONTRACT_VERSION) {
    throwInputRejected(
      `host surface descriptor contractVersion must be ${HOST_CONTRACT_VERSION}, got ${JSON.stringify(obj.contractVersion)}`,
    );
  }

  const owner = validateHostAuthorityOwnerThrowing(obj.owner);

  let hasLane = false;

  let hotRegions: readonly HostHotRegionDescriptor[] | undefined;
  if (obj.hotRegions !== undefined) {
    if (!Array.isArray(obj.hotRegions)) {
      throwInputRejected("surface.hotRegions must be an array when present");
    }
    if (obj.hotRegions.length === 0) {
      throwInputRejected("surface.hotRegions must be non-empty when present");
    }
    const regions: HostHotRegionDescriptor[] = [];
    const seenKeys = new Set<string>();
    for (let i = 0; i < obj.hotRegions.length; i++) {
      const region = createHostHotRegionDescriptorThrowing(obj.hotRegions[i]);
      if (seenKeys.has(region.hotRegionKey)) {
        throwInputRejected(
          `surface.hotRegions must not have duplicate hotRegionKey: ${region.hotRegionKey}`,
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
      throwInputRejected("surface.warmStreams must be an array when present");
    }
    if (obj.warmStreams.length === 0) {
      throwInputRejected("surface.warmStreams must be non-empty when present");
    }
    const streams: HostWarmStreamDescriptor[] = [];
    const seenKeys = new Set<string>();
    for (let i = 0; i < obj.warmStreams.length; i++) {
      const stream = createHostWarmStreamDescriptorThrowing(obj.warmStreams[i]);
      if (seenKeys.has(stream.streamKey)) {
        throwInputRejected(
          `surface.warmStreams must not have duplicate streamKey: ${stream.streamKey}`,
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
      "host surface descriptor must have at least one lane (hotRegions, control, warmStreams, or resourcePlane)",
    );
  }

  return {
    kind: "host.surface",
    contractVersion: HOST_CONTRACT_VERSION,
    owner,
    ...(hotRegions !== undefined ? { hotRegions } : {}),
    ...(control !== undefined ? { control } : {}),
    ...(warmStreams !== undefined ? { warmStreams } : {}),
    ...(resourcePlane !== undefined ? { resourcePlane } : {}),
  };
}

export function createHostSurfaceDescriptor(input: HostSurfaceDescriptor): HostSurfaceDescriptor {
  return createHostSurfaceDescriptorThrowing(input);
}

export function validateHostSurfaceDescriptor(
  value: unknown,
): HostContractValidationResult<HostSurfaceDescriptor> {
  try {
    return validationSuccess(createHostSurfaceDescriptorThrowing(value));
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

function createHostSurfaceReadyEnvelopeThrowing(input: unknown): HostSurfaceReadyEnvelope {
  const obj = assertPlainObject(input, "host surface ready envelope");
  assertExactRootKeys(obj, READY_OWNED_ROOT_KEYS, "host surface ready envelope");

  if (obj.kind !== "host.surfaceReady") {
    throwInputRejected(
      `host surface ready envelope kind must be "host.surfaceReady", got ${JSON.stringify(obj.kind)}`,
    );
  }

  if (obj.contractVersion !== HOST_CONTRACT_VERSION) {
    throwInputRejected(
      `host surface ready envelope contractVersion must be ${HOST_CONTRACT_VERSION}, got ${JSON.stringify(obj.contractVersion)}`,
    );
  }

  const surface = createHostSurfaceDescriptorThrowing(obj.surface);

  return {
    kind: "host.surfaceReady",
    contractVersion: HOST_CONTRACT_VERSION,
    surface,
  };
}

export function createHostSurfaceReadyEnvelope(
  input: HostSurfaceReadyEnvelope,
): HostSurfaceReadyEnvelope {
  return createHostSurfaceReadyEnvelopeThrowing(input);
}

export function validateHostSurfaceReadyEnvelope(
  value: unknown,
): HostContractValidationResult<HostSurfaceReadyEnvelope> {
  try {
    return validationSuccess(createHostSurfaceReadyEnvelopeThrowing(value));
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

function createHostSurfaceInvalidatedEnvelopeThrowing(
  input: unknown,
): HostSurfaceInvalidatedEnvelope {
  const obj = assertPlainObject(input, "host surface invalidated envelope");
  assertExactRootKeys(obj, INVALIDATED_OWNED_ROOT_KEYS, "host surface invalidated envelope");

  if (obj.kind !== "host.surfaceInvalidated") {
    throwInputRejected(
      `host surface invalidated envelope kind must be "host.surfaceInvalidated", got ${JSON.stringify(obj.kind)}`,
    );
  }

  if (obj.contractVersion !== HOST_CONTRACT_VERSION) {
    throwInputRejected(
      `host surface invalidated envelope contractVersion must be ${HOST_CONTRACT_VERSION}, got ${JSON.stringify(obj.contractVersion)}`,
    );
  }

  const owner = validateHostAuthorityOwnerThrowing(obj.owner);

  const reason = obj.reason;
  if (typeof reason !== "string" || !VALID_INVALIDATION_REASONS.has(reason)) {
    throwInputRejected(
      `host surface invalidated reason must be one of ${[...VALID_INVALIDATION_REASONS].join(", ")}, got ${JSON.stringify(reason)}`,
    );
  }

  if (obj.rebindRequired !== true) {
    throwInputRejected("host surface invalidated rebindRequired must be true");
  }

  return {
    kind: "host.surfaceInvalidated",
    contractVersion: HOST_CONTRACT_VERSION,
    owner,
    reason: reason as InvalidationReason,
    rebindRequired: true as const,
  };
}

export function createHostSurfaceInvalidatedEnvelope(
  input: HostSurfaceInvalidatedEnvelope,
): HostSurfaceInvalidatedEnvelope {
  return createHostSurfaceInvalidatedEnvelopeThrowing(input);
}

export function validateHostSurfaceInvalidatedEnvelope(
  value: unknown,
): HostContractValidationResult<HostSurfaceInvalidatedEnvelope> {
  try {
    return validationSuccess(createHostSurfaceInvalidatedEnvelopeThrowing(value));
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
