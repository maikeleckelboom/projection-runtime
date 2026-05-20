import type { PUBLICATION_TRANSPORT_ATTACHMENT_VERSION } from "@exclave/publication";
import type { BindingExpectation } from "@exclave/session";
import { throwInputRejected } from "./errors";
import type { HostAuthorityRef } from "./host-authority-ref";
import { validateHostAuthorityRefThrowing } from "./host-authority-ref";
import type { HostGrantDescriptor } from "./host-grant-descriptor";
import type { HostHotBlockAExpectation } from "./host-hot";

export type HostHotRegionCapability = {
  readonly kind: "grant.hotRegionCapability";
  readonly hotRegionKey: string;
  readonly expectedBlockA: HostHotBlockAExpectation;
  readonly expectedByteLength: number;
  readonly seqlockOffset: number;
  readonly publicationSequenceOffset?: number;
};

export type HostControlEndpointCapability = {
  readonly kind: "grant.controlEndpointCapability";
  readonly endpointKey: string;
  readonly supportedOperationKeys: readonly string[];
};

export type HostResourcePlaneCapability = {
  readonly kind: "grant.resourcePlaneCapability";
  readonly openOperationKey: string;
  readonly readChunkOperationKey: string;
  readonly mapWindowOperationKey: string;
  readonly closeMappingOperationKey: string;
  readonly closeHandleOperationKey: string;
  readonly authority: HostAuthorityRef;
};

export type HostWarmStreamCapability = {
  readonly kind: "grant.warmStreamCapability";
  readonly streamKey: string;
  readonly authority: HostAuthorityRef;
  readonly attachmentVersion: typeof PUBLICATION_TRANSPORT_ATTACHMENT_VERSION;
};

export type HostGrant = {
  readonly kind: "host.grant";
  readonly authority: HostAuthorityRef;
  readonly expectedBinding: BindingExpectation;
  readonly hot: readonly HostHotRegionCapability[];
  readonly control?: HostControlEndpointCapability;
  readonly resourcePlane?: HostResourcePlaneCapability;
  readonly warm: readonly HostWarmStreamCapability[];
};

function canonicalEpochToBigInt(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throwInputRejected(
      'authority.authorityEpoch must be a canonical non-negative decimal string (e.g. "0", "42")',
    );
  }
  return BigInt(value);
}

export function createBindingExpectationFromHostAuthorityRef(
  authority: HostAuthorityRef,
): BindingExpectation {
  const validated = validateHostAuthorityRefThrowing(authority);
  const authorityEpoch = canonicalEpochToBigInt(validated.authorityEpoch);
  return {
    authorityKey: validated.authorityKey,
    grantKey: validated.grantKey,
    authorityEpoch,
  };
}

export function createHostGrant(grant: HostGrantDescriptor): HostGrant {
  const authority: HostAuthorityRef = {
    authorityKey: grant.authority.authorityKey,
    grantKey: grant.authority.grantKey,
    authorityEpoch: grant.authority.authorityEpoch,
  };
  const expectedBinding = createBindingExpectationFromHostAuthorityRef(grant.authority);

  const hot: HostHotRegionCapability[] = (grant.hotRegions ?? []).map((region) => ({
    kind: "grant.hotRegionCapability" as const,
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

  const control: HostControlEndpointCapability | undefined = grant.control
    ? {
        kind: "grant.controlEndpointCapability" as const,
        endpointKey: grant.control.endpointKey,
        supportedOperationKeys: [...grant.control.operationKeys],
      }
    : undefined;

  const resourcePlane: HostResourcePlaneCapability | undefined = grant.resourcePlane
    ? {
        kind: "grant.resourcePlaneCapability" as const,
        openOperationKey: grant.resourcePlane.openOperationKey,
        readChunkOperationKey: grant.resourcePlane.readChunkOperationKey,
        mapWindowOperationKey: grant.resourcePlane.mapWindowOperationKey,
        closeMappingOperationKey: grant.resourcePlane.closeMappingOperationKey,
        closeHandleOperationKey: grant.resourcePlane.closeHandleOperationKey,
        authority,
      }
    : undefined;

  const warm: HostWarmStreamCapability[] = (grant.warmStreams ?? []).map((stream) => ({
    kind: "grant.warmStreamCapability" as const,
    streamKey: stream.streamKey,
    authority,
    attachmentVersion: stream.attachmentVersion,
  }));

  return {
    kind: "host.grant",
    authority,
    expectedBinding,
    hot,
    ...(control !== undefined ? { control } : {}),
    ...(resourcePlane !== undefined ? { resourcePlane } : {}),
    warm,
  };
}
