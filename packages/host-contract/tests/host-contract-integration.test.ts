import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CONTROL_ENVELOPE_VERSION } from "@exclave/control-plane";
import { PUBLICATION_TRANSPORT_ATTACHMENT_VERSION } from "@exclave/publication";
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
  createHostAuthorityRefFromBinding,
  createHostControlPlaneDescriptor,
  createHostGrantDescriptor,
  createHostGrantInvalidatedEnvelope,
  createHostGrantReadyEnvelope,
  createHostHotRegionDescriptor,
  createHostResourcePlaneDescriptor,
  createHostWarmStreamDescriptor,
  HOST_CONTRACT_VERSION,
  HOST_WARM_STREAM_DESCRIPTOR_VERSION,
  type HostHotBlockAExpectation,
  type HostHotRegionDescriptor,
  validateHostGrantInvalidatedEnvelope,
  validateHostGrantReadyEnvelope,
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
  grantKey: string;
  authorityEpoch: bigint;
} {
  const blockA = loadBlockAFixture();
  const authorityKey = mustBeString(blockA.contractKey, "fixture.contractKey");
  const grantKey = mustBeString(blockA.instanceKey, "fixture.instanceKey");
  return { authorityKey, grantKey, authorityEpoch: 1n };
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

describe("HostGrantDescriptor ready composition integration", () => {
  it("composes a ready host surface descriptor from fixture-derived inputs and survives JSON round-trip", () => {
    const identity = deriveFixtureIdentity();

    const binding: AuthorityBinding = createAuthorityBinding(identity);
    const readyBinding = markAuthorityBindingReady(binding);

    const authorityRef = createHostAuthorityRefFromBinding(readyBinding);
    expect(authorityRef.authorityKey).toBe(identity.authorityKey);
    expect(authorityRef.grantKey).toBe(identity.grantKey);
    expect(authorityRef.authorityEpoch).toBe("1");

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
      attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
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

    const grantDescriptor = createHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: authorityRef,
      hotRegions: [hotRegion],
      control,
      warmStreams: [warmStream],
      resourcePlane,
    });

    const envelope = createHostGrantReadyEnvelope({
      kind: "host.grantReady",
      contractVersion: HOST_CONTRACT_VERSION,
      grant: grantDescriptor,
    });

    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json);

    const validated = validateHostGrantReadyEnvelope(parsed);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error(`validation failed: ${validated.failure.message}`);
    }

    const vGrantDescriptor = validated.value.grant;

    expect(vGrantDescriptor.authority.authorityKey).toBe(identity.authorityKey);
    expect(vGrantDescriptor.authority.grantKey).toBe(identity.grantKey);
    expect(vGrantDescriptor.authority.authorityEpoch).toBe("1");

    const expectedBlockA = createFixtureBlockA();
    const expectedOffsets = deriveLayoutOffsets();

    expect(vGrantDescriptor.hotRegions).toBeDefined();
    expect(vGrantDescriptor.hotRegions?.length).toBe(1);
    const [region] = vGrantDescriptor.hotRegions ?? [];
    expect(region).toBeDefined();
    if (region === undefined) return;
    expect(region.hotRegionKey).toBe("deck-runtime-v0.hot");
    expect(region.blockA).toEqual(expectedBlockA);
    expect(region.totalRegionByteLength).toBe(expectedOffsets.totalRegionByteLength);
    expect(region.seqlockOffset).toBe(expectedOffsets.seqlockOffset);
    expect(region.publicationSequenceOffset).toBe(expectedOffsets.publicationSeqOffset);

    expect(vGrantDescriptor.control).toBeDefined();
    expect(vGrantDescriptor.control?.endpointKey).toBe("deck-runtime-v0.control");
    expect(vGrantDescriptor.control?.operationKeys).toEqual([
      "fixture.deckRuntime.describe",
      "fixture.deckRuntime.invalidate",
    ]);

    expect(vGrantDescriptor.warmStreams).toBeDefined();
    expect(vGrantDescriptor.warmStreams?.length).toBe(1);
    const [validatedWarmStream] = vGrantDescriptor.warmStreams ?? [];
    expect(validatedWarmStream).toBeDefined();
    if (validatedWarmStream === undefined) return;
    expect(validatedWarmStream.streamKey).toBe("deck-runtime-v0.warm");
    expect(validatedWarmStream.attachmentVersion).toBe(PUBLICATION_TRANSPORT_ATTACHMENT_VERSION);

    expect(vGrantDescriptor.resourcePlane).toBeDefined();
    expect(vGrantDescriptor.resourcePlane?.readChunkOperationKey).toBe(
      RESOURCE_READ_CHUNK_OPERATION_KEY,
    );

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

describe("HostGrantInvalidatedEnvelope invalidation composition integration", () => {
  it("composes a host surface invalidated envelope from session invalidation and survives JSON round-trip", () => {
    const identity = deriveFixtureIdentity();
    const binding = createAuthorityBinding(identity);
    const readyBinding = markAuthorityBindingReady(binding);
    const invalidated = invalidateAuthorityBinding(readyBinding, "authorityRestarted");

    const authorityRef = createHostAuthorityRefFromBinding(invalidated);
    expect(authorityRef.authorityKey).toBe(identity.authorityKey);
    expect(authorityRef.grantKey).toBe(identity.grantKey);
    expect(authorityRef.authorityEpoch).toBe("1");

    const envelope = createHostGrantInvalidatedEnvelope({
      kind: "host.grantInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: authorityRef,
      reason: "authorityRestarted",
      rebindRequired: true,
    });

    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json);

    const validated = validateHostGrantInvalidatedEnvelope(parsed);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error(`validation failed: ${validated.failure.message}`);
    }

    expect(validated.value.reason).toBe("authorityRestarted");
    expect(validated.value.rebindRequired).toBe(true);
    expect(validated.value.authority.authorityKey).toBe(identity.authorityKey);
    expect(validated.value.authority.grantKey).toBe(identity.grantKey);
    expect(validated.value.authority.authorityEpoch).toBe("1");
    expect(typeof validated.value.authority.authorityEpoch).toBe("string");
  });
});

describe("HostGrantDescriptor stale epoch integration", () => {
  it("a stale owner epoch survives host-contract grantReady validation but fails session binding validation", () => {
    const identity = deriveFixtureIdentity();
    const binding = createAuthorityBinding(identity);
    const readyBinding = markAuthorityBindingReady(binding);

    const authorityRef = createHostAuthorityRefFromBinding(readyBinding);

    const hotRegion = createHostHotRegionDescriptor(createFixtureHotRegion());

    const grantDescriptor = createHostGrantDescriptor({
      kind: "host.grantDescriptor",
      contractVersion: HOST_CONTRACT_VERSION,
      authority: authorityRef,
      hotRegions: [hotRegion],
    });

    const envelope = createHostGrantReadyEnvelope({
      kind: "host.grantReady",
      contractVersion: HOST_CONTRACT_VERSION,
      grant: grantDescriptor,
    });

    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const parsedGrantDescriptor = parsed.grant as Record<string, unknown>;
    const parsedAuthority = parsedGrantDescriptor.authority as Record<string, unknown>;
    parsedAuthority.authorityEpoch = "2";

    const staleValidated = validateHostGrantReadyEnvelope(parsed);
    expect(staleValidated.ok).toBe(true);

    const mutatedEpoch = decimalStringToBigInt(
      parsedAuthority.authorityEpoch,
      "parsedAuthority.authorityEpoch",
    );
    const sessionResult = validateAuthorityBinding(readyBinding, {
      authorityKey: identity.authorityKey,
      grantKey: identity.grantKey,
      authorityEpoch: mutatedEpoch,
    });
    expect(sessionResult.ok).toBe(false);
    if (!sessionResult.ok) {
      expect(sessionResult.reason).toBe("authorityEpochMismatch");
    }
  });
});
