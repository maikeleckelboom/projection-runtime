import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CONTROL_ENVELOPE_VERSION } from "@exclave/control-plane";
import {
  RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
  RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
  RESOURCE_MAP_WINDOW_OPERATION_KEY,
  RESOURCE_OPEN_OPERATION_KEY,
  RESOURCE_READ_CHUNK_OPERATION_KEY,
} from "@exclave/resource";
import {
  type AuthorityBinding,
  createAuthorityBinding,
  invalidateAuthorityBinding,
  markAuthorityBindingReady,
  validateAuthorityBinding,
} from "@exclave/session";
import { describe, expect, it } from "vitest";

import {
  createHostAuthorityOwnerFromBinding,
  createHostControlPlaneDescriptor,
  createHostHotRegionDescriptor,
  createHostResourcePlaneDescriptor,
  createHostSurfaceDescriptor,
  createHostSurfaceInvalidatedEnvelope,
  createHostSurfaceReadyEnvelope,
  createHostWarmStreamDescriptor,
  HOST_CONTRACT_VERSION,
  HOST_WARM_STREAM_DESCRIPTOR_VERSION,
  type HostHotBlockAExpectation,
  type HostHotRegionDescriptor,
  validateHostSurfaceInvalidatedEnvelope,
  validateHostSurfaceReadyEnvelope,
} from "../src/index";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, "../../../fixtures/projection-runtime/deck-runtime-v0");

function loadFixtureJson(filename: string): unknown {
  const raw = readFileSync(resolve(FIXTURES_ROOT, filename), "utf-8");
  return JSON.parse(raw);
}

function hexU64ToDecimalString(hex: string): string {
  if (typeof hex !== "string") {
    throw new Error("hexU64ToDecimalString: hex must be a string");
  }
  if (!/^[0-9a-fA-F]{1,16}$/.test(hex)) {
    throw new Error("hexU64ToDecimalString: hex must be 1-16 hex characters");
  }
  return BigInt(`0x${hex}`).toString();
}

function decimalStringToBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical non-negative decimal string`);
  }
  return BigInt(value);
}

function assertDescriptorCarriesOnlyMetadata(
  value: unknown,
  localFieldKeys: ReadonlySet<string>,
  path: string,
): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertDescriptorCarriesOnlyMetadata(value[i], localFieldKeys, `${path}[${i}]`);
    }
    return;
  }
  for (const key of Object.keys(value)) {
    if (localFieldKeys.has(key)) {
      throw new Error(`descriptor-local field "${key}" found at ${path}`);
    }
    assertDescriptorCarriesOnlyMetadata(
      (value as Record<string, unknown>)[key],
      localFieldKeys,
      `${path}.${key}`,
    );
  }
}

function loadBlockAFixture(): Record<string, unknown> {
  const data = loadFixtureJson("hot-block-a-fixture.json");
  if (typeof data !== "object" || data === null) {
    throw new Error("block A fixture is not an object");
  }
  return data as Record<string, unknown>;
}

function loadLayoutManifest(): Record<string, unknown> {
  const data = loadFixtureJson("hot-layout-manifest.json");
  if (typeof data !== "object" || data === null) {
    throw new Error("layout manifest is not an object");
  }
  return data as Record<string, unknown>;
}

function mustBeString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string, got ${typeof value}`);
  }
  return value;
}

function mustBeNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`${label} must be a number, got ${typeof value}`);
  }
  return value;
}

function deriveFixtureIdentity(): {
  authorityKey: string;
  surfaceKey: string;
  authorityEpoch: bigint;
} {
  const blockA = loadBlockAFixture();
  const authorityKey = mustBeString(blockA.contractKey, "fixture.contractKey");
  const surfaceKey = mustBeString(blockA.instanceKey, "fixture.instanceKey");
  return { authorityKey, surfaceKey, authorityEpoch: 1n };
}

function deriveBlockAExpectation(): {
  contractKey: string;
  instanceKey: string;
  semanticVersion: string;
  hotLayoutVersion: string;
  fieldCount: number;
  mutableRegionByteLength: number;
} {
  const blockA = loadBlockAFixture();
  const contractKey = mustBeString(blockA.contractKey, "fixture.contractKey");
  const instanceKey = mustBeString(blockA.instanceKey, "fixture.instanceKey");

  const semanticVersionHex = mustBeString(blockA.semanticVersion, "fixture.semanticVersion");
  const hotLayoutVersionHex = mustBeString(blockA.hotLayoutVersion, "fixture.hotLayoutVersion");

  const semanticVersion = hexU64ToDecimalString(semanticVersionHex);
  const hotLayoutVersion = hexU64ToDecimalString(hotLayoutVersionHex);

  const fieldCount = mustBeNumber(blockA.fieldCount, "fixture.fieldCount");
  const mutableRegionByteLength = mustBeNumber(
    blockA.mutableRegionByteLength,
    "fixture.mutableRegionByteLength",
  );

  return {
    contractKey,
    instanceKey,
    semanticVersion,
    hotLayoutVersion,
    fieldCount,
    mutableRegionByteLength,
  };
}

function deriveLayoutOffsets(): {
  totalRegionByteLength: number;
  seqlockOffset: number;
  publicationSeqOffset: number;
} {
  const layout = loadLayoutManifest();
  return {
    totalRegionByteLength: mustBeNumber(
      layout.totalRegionByteLength,
      "layout.totalRegionByteLength",
    ),
    seqlockOffset: mustBeNumber(layout.seqlockOffset, "layout.seqlockOffset"),
    publicationSeqOffset: mustBeNumber(layout.publicationSeqOffset, "layout.publicationSeqOffset"),
  };
}

function createFixtureBlockA(): HostHotBlockAExpectation {
  const derived = deriveBlockAExpectation();
  return {
    contractKey: derived.contractKey,
    instanceKey: derived.instanceKey,
    semanticVersion: derived.semanticVersion,
    hotLayoutVersion: derived.hotLayoutVersion,
    fieldCount: derived.fieldCount,
    mutableRegionByteLength: derived.mutableRegionByteLength,
  };
}

function createFixtureHotRegion(): HostHotRegionDescriptor {
  const offsets = deriveLayoutOffsets();
  return {
    kind: "host.hotRegion",
    hotRegionKey: "deck-runtime-v0.hot",
    blockA: createFixtureBlockA(),
    totalRegionByteLength: offsets.totalRegionByteLength,
    seqlockOffset: offsets.seqlockOffset,
    publicationSequenceOffset: offsets.publicationSeqOffset,
  };
}

describe("HostSurfaceDescriptor ready composition integration", () => {
  it("composes a ready host surface descriptor from fixture-derived inputs and survives JSON round-trip", () => {
    const identity = deriveFixtureIdentity();

    const binding: AuthorityBinding = createAuthorityBinding(identity);
    const readyBinding = markAuthorityBindingReady(binding);

    const owner = createHostAuthorityOwnerFromBinding(readyBinding);
    expect(owner.authorityKey).toBe(identity.authorityKey);
    expect(owner.surfaceKey).toBe(identity.surfaceKey);
    expect(owner.authorityEpoch).toBe("1");

    const hotRegion = createHostHotRegionDescriptor(createFixtureHotRegion());

    const control = createHostControlPlaneDescriptor({
      kind: "host.controlPlane",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      endpointKey: "deck-runtime-v0.control",
      operationKeys: ["fixture.deckRuntime.describe", "fixture.deckRuntime.invalidate"],
    });

    const warmStream = createHostWarmStreamDescriptor({
      kind: "host.warmStream",
      descriptorVersion: HOST_WARM_STREAM_DESCRIPTOR_VERSION,
      streamKey: "deck-runtime-v0.warm",
    });

    const resourcePlane = createHostResourcePlaneDescriptor({
      kind: "host.resourcePlane",
      openOperationKey: RESOURCE_OPEN_OPERATION_KEY,
      readChunkOperationKey: RESOURCE_READ_CHUNK_OPERATION_KEY,
      mapWindowOperationKey: RESOURCE_MAP_WINDOW_OPERATION_KEY,
      closeMappingOperationKey: RESOURCE_CLOSE_MAPPING_OPERATION_KEY,
      closeHandleOperationKey: RESOURCE_CLOSE_HANDLE_OPERATION_KEY,
    });

    const surface = createHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner,
      hotRegions: [hotRegion],
      control,
      warmStreams: [warmStream],
      resourcePlane,
    });

    const envelope = createHostSurfaceReadyEnvelope({
      kind: "host.surfaceReady",
      contractVersion: HOST_CONTRACT_VERSION,
      surface,
    });

    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json);

    const validated = validateHostSurfaceReadyEnvelope(parsed);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error(`validation failed: ${validated.failure.message}`);
    }

    const vSurface = validated.value.surface;

    expect(vSurface.owner.authorityKey).toBe(identity.authorityKey);
    expect(vSurface.owner.surfaceKey).toBe(identity.surfaceKey);
    expect(vSurface.owner.authorityEpoch).toBe("1");

    const expectedBlockA = createFixtureBlockA();
    const expectedOffsets = deriveLayoutOffsets();

    expect(vSurface.hotRegions).toBeDefined();
    expect(vSurface.hotRegions?.length).toBe(1);
    const [region] = vSurface.hotRegions ?? [];
    expect(region).toBeDefined();
    if (region === undefined) return;
    expect(region.hotRegionKey).toBe("deck-runtime-v0.hot");
    expect(region.blockA).toEqual(expectedBlockA);
    expect(region.totalRegionByteLength).toBe(expectedOffsets.totalRegionByteLength);
    expect(region.seqlockOffset).toBe(expectedOffsets.seqlockOffset);
    expect(region.publicationSequenceOffset).toBe(expectedOffsets.publicationSeqOffset);

    expect(vSurface.control).toBeDefined();
    expect(vSurface.control?.endpointKey).toBe("deck-runtime-v0.control");
    expect(vSurface.control?.operationKeys).toEqual([
      "fixture.deckRuntime.describe",
      "fixture.deckRuntime.invalidate",
    ]);

    expect(vSurface.warmStreams).toBeDefined();
    expect(vSurface.warmStreams?.length).toBe(1);
    const [validatedWarmStream] = vSurface.warmStreams ?? [];
    expect(validatedWarmStream).toBeDefined();
    if (validatedWarmStream === undefined) return;
    expect(validatedWarmStream.streamKey).toBe("deck-runtime-v0.warm");

    expect(vSurface.resourcePlane).toBeDefined();
    expect(vSurface.resourcePlane?.readChunkOperationKey).toBe(RESOURCE_READ_CHUNK_OPERATION_KEY);

    const localFieldKeys = new Set([
      "blockABytesHex",
      "completeFixtureRegionBytesHex",
      "hotRegionBytesHex",
      "completeFixtureRegionBytes",
      "completeFixtureRegion",
      "bytes",
      "buffer",
      "region",
      "view",
    ]);
    assertDescriptorCarriesOnlyMetadata(parsed, localFieldKeys, "root");
    expect(json).not.toContain("SharedArrayBuffer");
  });
});

describe("HostSurfaceInvalidatedEnvelope invalidation composition integration", () => {
  it("composes a host surface invalidated envelope from session invalidation and survives JSON round-trip", () => {
    const identity = deriveFixtureIdentity();
    const binding = createAuthorityBinding(identity);
    const readyBinding = markAuthorityBindingReady(binding);
    const invalidated = invalidateAuthorityBinding(readyBinding, "authorityRestarted");

    const owner = createHostAuthorityOwnerFromBinding(invalidated);
    expect(owner.authorityKey).toBe(identity.authorityKey);
    expect(owner.surfaceKey).toBe(identity.surfaceKey);
    expect(owner.authorityEpoch).toBe("1");

    const envelope = createHostSurfaceInvalidatedEnvelope({
      kind: "host.surfaceInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      owner,
      reason: "authorityRestarted",
      rebindRequired: true,
    });

    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json);

    const validated = validateHostSurfaceInvalidatedEnvelope(parsed);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error(`validation failed: ${validated.failure.message}`);
    }

    expect(validated.value.reason).toBe("authorityRestarted");
    expect(validated.value.rebindRequired).toBe(true);
    expect(validated.value.owner.authorityKey).toBe(identity.authorityKey);
    expect(validated.value.owner.surfaceKey).toBe(identity.surfaceKey);
    expect(validated.value.owner.authorityEpoch).toBe("1");
    expect(typeof validated.value.owner.authorityEpoch).toBe("string");
  });
});

describe("HostSurfaceDescriptor stale epoch integration", () => {
  it("a stale owner epoch survives host-contract surfaceReady validation but fails session binding validation", () => {
    const identity = deriveFixtureIdentity();
    const binding = createAuthorityBinding(identity);
    const readyBinding = markAuthorityBindingReady(binding);

    const owner = createHostAuthorityOwnerFromBinding(readyBinding);

    const hotRegion = createHostHotRegionDescriptor(createFixtureHotRegion());

    const surface = createHostSurfaceDescriptor({
      kind: "host.surface",
      contractVersion: HOST_CONTRACT_VERSION,
      owner,
      hotRegions: [hotRegion],
    });

    const envelope = createHostSurfaceReadyEnvelope({
      kind: "host.surfaceReady",
      contractVersion: HOST_CONTRACT_VERSION,
      surface,
    });

    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const parsedSurface = parsed.surface as Record<string, unknown>;
    const parsedOwner = parsedSurface.owner as Record<string, unknown>;
    parsedOwner.authorityEpoch = "2";

    const staleValidated = validateHostSurfaceReadyEnvelope(parsed);
    expect(staleValidated.ok).toBe(true);

    const mutatedEpoch = decimalStringToBigInt(
      parsedOwner.authorityEpoch,
      "parsedOwner.authorityEpoch",
    );
    const sessionResult = validateAuthorityBinding(readyBinding, {
      authorityKey: identity.authorityKey,
      surfaceKey: identity.surfaceKey,
      authorityEpoch: mutatedEpoch,
    });
    expect(sessionResult.ok).toBe(false);
    if (!sessionResult.ok) {
      expect(sessionResult.reason).toBe("authorityEpochMismatch");
    }
  });
});
