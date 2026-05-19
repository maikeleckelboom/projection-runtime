import type { PUBLICATION_TRANSPORT_ATTACHMENT_VERSION } from "@exclave/publication";
import type { BindingExpectation } from "@exclave/session";
import { throwInputRejected } from "./errors";
import type { HostHotBlockAExpectation } from "./host-hot";
import type { HostAuthorityOwner } from "./host-owner";
import { validateHostAuthorityOwnerThrowing } from "./host-owner";
import type { HostSurfaceDescriptor } from "./host-surface";

export type HostHotRegionCapability = {
  readonly kind: "surface.hotRegionCapability";
  readonly hotRegionKey: string;
  readonly expectedBlockA: HostHotBlockAExpectation;
  readonly expectedByteLength: number;
  readonly seqlockOffset: number;
  readonly publicationSequenceOffset?: number;
};

export type HostControlEndpointCapability = {
  readonly kind: "surface.controlEndpointCapability";
  readonly endpointKey: string;
  readonly supportedOperationKeys: readonly string[];
};

export type HostResourcePlaneCapability = {
  readonly kind: "surface.resourcePlaneCapability";
  readonly openOperationKey: string;
  readonly readChunkOperationKey: string;
  readonly mapWindowOperationKey: string;
  readonly closeMappingOperationKey: string;
  readonly closeHandleOperationKey: string;
  readonly owner: HostAuthorityOwner;
};

export type HostWarmStreamCapability = {
  readonly kind: "surface.warmStreamCapability";
  readonly streamKey: string;
  readonly owner: HostAuthorityOwner;
  readonly attachmentVersion: typeof PUBLICATION_TRANSPORT_ATTACHMENT_VERSION;
};

export type HostSurfaceGrant = {
  readonly kind: "host.surfaceGrant";
  readonly owner: HostAuthorityOwner;
  readonly expectedBinding: BindingExpectation;
  readonly hot: readonly HostHotRegionCapability[];
  readonly control?: HostControlEndpointCapability;
  readonly resourcePlane?: HostResourcePlaneCapability;
  readonly warm: readonly HostWarmStreamCapability[];
};

function canonicalEpochToBigInt(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throwInputRejected(
      'owner.authorityEpoch must be a canonical non-negative decimal string (e.g. "0", "42")',
    );
  }
  return BigInt(value);
}

export function createBindingExpectationFromHostOwner(
  owner: HostAuthorityOwner,
): BindingExpectation {
  const validated = validateHostAuthorityOwnerThrowing(owner);
  const authorityEpoch = canonicalEpochToBigInt(validated.authorityEpoch);
  return {
    authorityKey: validated.authorityKey,
    surfaceKey: validated.surfaceKey,
    authorityEpoch,
  };
}

export function createHostSurfaceGrant(surface: HostSurfaceDescriptor): HostSurfaceGrant {
  const owner: HostAuthorityOwner = {
    authorityKey: surface.owner.authorityKey,
    surfaceKey: surface.owner.surfaceKey,
    authorityEpoch: surface.owner.authorityEpoch,
  };
  const expectedBinding = createBindingExpectationFromHostOwner(surface.owner);

  const hot: HostHotRegionCapability[] = (surface.hotRegions ?? []).map((region) => ({
    kind: "surface.hotRegionCapability" as const,
    hotRegionKey: region.hotRegionKey,
    expectedBlockA: {
      contractKey: region.blockA.contractKey,
      instanceKey: region.blockA.instanceKey,
      semanticVersion: region.blockA.semanticVersion,
      hotLayoutVersion: region.blockA.hotLayoutVersion,
      fieldCount: region.blockA.fieldCount,
      mutableRegionByteLength: region.blockA.mutableRegionByteLength,
    },
    expectedByteLength: region.totalRegionByteLength,
    seqlockOffset: region.seqlockOffset,
    ...(region.publicationSequenceOffset !== undefined
      ? { publicationSequenceOffset: region.publicationSequenceOffset }
      : {}),
  }));

  const control: HostControlEndpointCapability | undefined = surface.control
    ? {
        kind: "surface.controlEndpointCapability" as const,
        endpointKey: surface.control.endpointKey,
        supportedOperationKeys: [...surface.control.operationKeys],
      }
    : undefined;

  const resourcePlane: HostResourcePlaneCapability | undefined = surface.resourcePlane
    ? {
        kind: "surface.resourcePlaneCapability" as const,
        openOperationKey: surface.resourcePlane.openOperationKey,
        readChunkOperationKey: surface.resourcePlane.readChunkOperationKey,
        mapWindowOperationKey: surface.resourcePlane.mapWindowOperationKey,
        closeMappingOperationKey: surface.resourcePlane.closeMappingOperationKey,
        closeHandleOperationKey: surface.resourcePlane.closeHandleOperationKey,
        owner,
      }
    : undefined;

  const warm: HostWarmStreamCapability[] = (surface.warmStreams ?? []).map((stream) => ({
    kind: "surface.warmStreamCapability" as const,
    streamKey: stream.streamKey,
    owner,
    attachmentVersion: stream.attachmentVersion,
  }));

  return {
    kind: "host.surfaceGrant",
    owner,
    expectedBinding,
    hot,
    ...(control !== undefined ? { control } : {}),
    ...(resourcePlane !== undefined ? { resourcePlane } : {}),
    warm,
  };
}
