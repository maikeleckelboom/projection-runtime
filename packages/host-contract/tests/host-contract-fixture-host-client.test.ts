import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ControlFailureEnvelope,
  ControlRequestEnvelope,
  ControlSuccessEnvelope,
} from "@exclave/control-plane";
import {
  CONTROL_ENVELOPE_VERSION,
  createControlFailureEnvelope,
  createControlRequestEnvelope,
  createControlSuccessEnvelope,
  validateControlRequestEnvelope,
  validateControlResponseEnvelope,
  validateControlResponseForRequest,
} from "@exclave/control-plane";
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
  guardAuthorityBinding,
  invalidateAuthorityBinding,
  markAuthorityBindingReady,
} from "@exclave/session";

import { describe, expect, it } from "vitest";
import {
  createDeckRuntimeReader,
  type DeckRuntimeSnapshot,
} from "../../../fixtures/projection-runtime/deck-runtime-v0/generated/hot-reader";
import {
  createResourceReadRangeControlRequest,
  createResourceReadRangeControlSuccess,
  RESOURCE_READ_RANGE_OPERATION_KEY,
} from "../../resource/src/resource-control";
import {
  createResourceReadRangeReceiptPayload,
  createResourceReadRangeRequestPayload,
  validateResourceReadRangeReceiptPayload,
  validateResourceReadRangeRequestPayload,
} from "../../resource/src/resource-range";
import {
  createHostAuthorityOwnerFromBinding,
  createHostControlPlaneDescriptor,
  createHostHotRegionDescriptor,
  createHostResourcePlaneDescriptor,
  createHostSurfaceDescriptor,
  createHostSurfaceGrant,
  createHostSurfaceInvalidatedEnvelope,
  createHostSurfaceReadyEnvelope,
  createHostWarmStreamDescriptor,
  HOST_CONTRACT_VERSION,
  HOST_WARM_STREAM_DESCRIPTOR_VERSION,
  type HostHotBlockAExpectation,
  type HostHotRegionDescriptor,
  type HostSurfaceGrant,
  type HostSurfaceInvalidatedEnvelope,
  type HostSurfaceReadyEnvelope,
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

function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hex string must have even length");
  }
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("hex string must contain only hex characters");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
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

function loadCompleteRegionFixture(): Record<string, unknown> {
  const data = loadFixtureJson("hot-complete-fixture-region.json");
  if (typeof data !== "object" || data === null) {
    throw new Error("complete region fixture is not an object");
  }
  return data as Record<string, unknown>;
}

function deriveFixtureIdentity(): {
  authorityKey: string;
  surfaceKey: string;
  authorityEpoch: bigint;
} {
  const blockA = loadBlockAFixture();
  return {
    authorityKey: mustBeString(blockA.contractKey, "fixture.contractKey"),
    surfaceKey: mustBeString(blockA.instanceKey, "fixture.instanceKey"),
    authorityEpoch: 1n,
  };
}

function deriveBlockAExpectation(): HostHotBlockAExpectation {
  const blockA = loadBlockAFixture();
  return {
    contractKey: mustBeString(blockA.contractKey, "fixture.contractKey"),
    instanceKey: mustBeString(blockA.instanceKey, "fixture.instanceKey"),
    semanticVersion: hexU64ToDecimalString(
      mustBeString(blockA.semanticVersion, "fixture.semanticVersion"),
    ),
    hotLayoutVersion: hexU64ToDecimalString(
      mustBeString(blockA.hotLayoutVersion, "fixture.hotLayoutVersion"),
    ),
    fieldCount: mustBeNumber(blockA.fieldCount, "fixture.fieldCount"),
    mutableRegionByteLength: mustBeNumber(
      blockA.mutableRegionByteLength,
      "fixture.mutableRegionByteLength",
    ),
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
  return deriveBlockAExpectation();
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

function createSharedRegionFromFixture(): {
  region: Uint8Array;
  totalRegionByteLength: number;
} {
  const fixture = loadCompleteRegionFixture();
  const hex = mustBeString(
    fixture.completeFixtureRegionBytesHex,
    "fixture.completeFixtureRegionBytesHex",
  );
  const bytes = hexToUint8Array(hex);
  const totalRegionByteLength = bytes.length;
  const sab = new SharedArrayBuffer(totalRegionByteLength);
  const region = new Uint8Array(sab);
  region.set(bytes);
  return { region, totalRegionByteLength };
}

function deriveExpectedDeckRuntimeSnapshot(): DeckRuntimeSnapshot {
  const fixture = loadCompleteRegionFixture();
  const decoded = fixture.decoded as Record<string, unknown>;
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("fixture.decoded is not an object");
  }
  const fieldValues = decoded.fieldValues as Record<string, unknown>;
  if (typeof fieldValues !== "object" || fieldValues === null) {
    throw new Error("fixture.decoded.fieldValues is not an object");
  }

  const beatPhase01 = mustBeNumber(fieldValues.beatPhase01, "fieldValues.beatPhase01");
  const level = mustBeNumber(fieldValues.level, "fieldValues.level");
  const loopActive = fieldValues.loopActive;
  if (typeof loopActive !== "boolean") {
    throw new Error("fieldValues.loopActive must be a boolean");
  }
  const mediaTimeSeconds = mustBeNumber(
    fieldValues.mediaTimeSeconds,
    "fieldValues.mediaTimeSeconds",
  );
  const samplePositionRaw = fieldValues.samplePosition;
  let samplePosition: bigint;
  if (typeof samplePositionRaw === "bigint") {
    samplePosition = samplePositionRaw;
  } else if (typeof samplePositionRaw === "string") {
    if (!/^[0-9a-fA-F]+$/.test(samplePositionRaw)) {
      throw new Error("fieldValues.samplePosition must be a hex string");
    }
    samplePosition = BigInt(`0x${samplePositionRaw}`);
  } else {
    throw new Error(
      `fieldValues.samplePosition must be a string or bigint, got ${typeof samplePositionRaw}`,
    );
  }
  const stemGainsRaw = fieldValues.stemGains;
  if (!Array.isArray(stemGainsRaw)) {
    throw new Error("fieldValues.stemGains must be an array");
  }
  const stemGains = stemGainsRaw.map((v, i) => mustBeNumber(v, `fieldValues.stemGains[${i}]`));
  const tempoRatio = mustBeNumber(fieldValues.tempoRatio, "fieldValues.tempoRatio");
  const transportState = fieldValues.transportState;
  if (typeof transportState !== "string") {
    throw new Error("fieldValues.transportState must be a string");
  }

  return {
    beatPhase01,
    level,
    loopActive,
    mediaTimeSeconds,
    samplePosition,
    stemGains,
    tempoRatio,
    transportState: transportState as DeckRuntimeSnapshot["transportState"],
  };
}

const DESCRIPTOR_LOCAL_FIELD_KEYS = new Set([
  "blockABytesHex",
  "completeFixtureRegionBytesHex",
  "hotRegionBytesHex",
  "completeFixtureRegionBytes",
  "completeFixtureRegion",
  "bytes",
  "buffer",
  "region",
  "view",
  "SharedArrayBuffer",
]);

function assertNoBytePayloadFields(value: unknown, path: string): void {
  assertDescriptorCarriesOnlyMetadata(
    value,
    new Set(["bytes", "buffer", "view", "region", "SharedArrayBuffer", "arrayBuffer"]),
    path,
  );
}

type FixtureHostConfig = {
  readonly authorityKey: string;
  readonly surfaceKey: string;
  readonly hotRegion: HostHotRegionDescriptor;
  readonly controlEndpointKey: string;
  readonly controlOperationKeys: readonly string[];
  readonly warmStreamKey: string;
};

type ControlRequestResult =
  | { ok: true; response: ControlSuccessEnvelope }
  | { ok: false; response: ControlFailureEnvelope };

class FixtureHost {
  private readonly _binding: AuthorityBinding;
  private readonly _config: FixtureHostConfig;

  constructor(config: FixtureHostConfig) {
    this._config = config;
    this._binding = markAuthorityBindingReady(
      createAuthorityBinding({
        authorityKey: config.authorityKey,
        surfaceKey: config.surfaceKey,
        authorityEpoch: 1n,
      }),
    );
  }

  get binding(): AuthorityBinding {
    return this._binding;
  }

  openSurface(): HostSurfaceReadyEnvelope {
    const owner = createHostAuthorityOwnerFromBinding(this._binding);

    const hotRegion = createHostHotRegionDescriptor(this._config.hotRegion);

    const control = createHostControlPlaneDescriptor({
      kind: "host.controlPlane",
      envelopeVersion: CONTROL_ENVELOPE_VERSION,
      endpointKey: this._config.controlEndpointKey,
      operationKeys: [...this._config.controlOperationKeys],
    });

    const warmStream = createHostWarmStreamDescriptor({
      kind: "host.warmStream",
      descriptorVersion: HOST_WARM_STREAM_DESCRIPTOR_VERSION,
      attachmentVersion: PUBLICATION_TRANSPORT_ATTACHMENT_VERSION,
      streamKey: this._config.warmStreamKey,
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

    return createHostSurfaceReadyEnvelope({
      kind: "host.surfaceReady",
      contractVersion: HOST_CONTRACT_VERSION,
      surface,
    });
  }

  getHotRegionForTest(): { region: Uint8Array; totalRegionByteLength: number } {
    return createSharedRegionFromFixture();
  }

  handleControlRequest(request: ControlRequestEnvelope): ControlRequestResult {
    const validated = validateControlRequestEnvelope(JSON.parse(JSON.stringify(request)));
    if (!validated.ok) {
      throw new Error(`control request envelope validation failed: ${validated.failure.message}`);
    }

    const operationKey = validated.value.operationKey;
    const requestKey = validated.value.requestKey;
    const supportedSet = new Set(this._config.controlOperationKeys);

    if (!supportedSet.has(operationKey)) {
      return {
        ok: false,
        response: createControlFailureEnvelope({
          requestKey,
          failure: {
            code: "control.unsupportedOperation",
            message: `Operation "${operationKey}" is not supported by endpoint "${this._config.controlEndpointKey}"`,
            details: {
              unsupportedOperationKey: operationKey,
              endpointKey: this._config.controlEndpointKey,
              supportedOperationKeys: [...this._config.controlOperationKeys],
            },
          },
        }),
      };
    }

    return {
      ok: true,
      response: createControlSuccessEnvelope({
        requestKey,
        payload: { status: "ok", operationKey },
      }),
    };
  }

  handleResourceReadRangeRequest(request: ControlRequestEnvelope): ControlSuccessEnvelope {
    const validated = validateControlRequestEnvelope(JSON.parse(JSON.stringify(request)));
    if (!validated.ok) {
      throw new Error(
        `resource read-range request validation failed: ${validated.failure.message}`,
      );
    }

    if (validated.value.operationKey !== RESOURCE_READ_RANGE_OPERATION_KEY) {
      throw new Error(
        `expected operationKey "${RESOURCE_READ_RANGE_OPERATION_KEY}", got "${validated.value.operationKey}"`,
      );
    }

    const resourcePayload = validateResourceReadRangeRequestPayload(validated.value.payload);

    const receiptPayload = createResourceReadRangeReceiptPayload({
      handleKey: resourcePayload.handleKey,
      range: resourcePayload.range,
      byteLength: resourcePayload.range.byteLength,
      version: "1",
    });

    return createResourceReadRangeControlSuccess({
      requestKey: validated.value.requestKey,
      payload: receiptPayload,
    });
  }

  invalidateAuthority(reason: "authorityRestarted"): HostSurfaceInvalidatedEnvelope {
    const invalidated = invalidateAuthorityBinding(this._binding, reason);
    const owner = createHostAuthorityOwnerFromBinding(invalidated);

    return createHostSurfaceInvalidatedEnvelope({
      kind: "host.surfaceInvalidated",
      contractVersion: HOST_CONTRACT_VERSION,
      owner,
      reason,
      rebindRequired: true,
    });
  }
}

type HotReadFailure =
  | { ok: false; reason: "bindingInvalidated"; rebindRequired: true; invalidationReason: string }
  | { ok: false; reason: string; rebindRequired: boolean; invalidationReason?: never };

type HotReadResult = { ok: true; snapshot: DeckRuntimeSnapshot; sequence: bigint } | HotReadFailure;

class FixtureClient {
  private _grant: HostSurfaceGrant | null = null;
  private _binding: AuthorityBinding | null = null;

  acceptSurfaceReady(envelope: HostSurfaceReadyEnvelope): HostSurfaceGrant {
    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json);
    const validated = validateHostSurfaceReadyEnvelope(parsed);
    if (!validated.ok) {
      throw new Error(`surfaceReady validation failed: ${validated.failure.message}`);
    }

    const surface = validated.value.surface;
    const grant = createHostSurfaceGrant(surface);
    this._grant = grant;
    this._binding = markAuthorityBindingReady(
      createAuthorityBinding({
        authorityKey: grant.expectedBinding.authorityKey,
        surfaceKey: grant.expectedBinding.surfaceKey,
        authorityEpoch: grant.expectedBinding.authorityEpoch,
      }),
    );
    return grant;
  }

  get grant(): HostSurfaceGrant {
    if (this._grant === null) {
      throw new Error("grant not initialized; call acceptSurfaceReady first");
    }
    return this._grant;
  }

  get binding(): AuthorityBinding {
    if (this._binding === null) {
      throw new Error("binding not initialized; call acceptSurfaceReady first");
    }
    return this._binding;
  }

  readHot(grant: HostSurfaceGrant, region: Uint8Array): HotReadResult {
    const hotCapability = grant.hot[0];
    if (hotCapability === undefined) {
      throw new Error("grant has no hot capabilities");
    }

    if (region.length !== hotCapability.expectedByteLength) {
      throw new Error(
        `region length ${region.length} does not match expected ${hotCapability.expectedByteLength}`,
      );
    }

    let readSpyCallCount = 0;
    const guardedRead = () => {
      readSpyCallCount += 1;
      const instanceKey = hotCapability.expectedBlockA.instanceKey;
      const reader = createDeckRuntimeReader(region, { instanceKey });
      return reader.tryRead({ maxWriterActivePolls: 0, maxTornReads: 0 });
    };

    const guardResult = guardAuthorityBinding(this.binding, grant.expectedBinding, guardedRead);

    this._lastReadSpyCallCount = readSpyCallCount;

    if (!guardResult.ok) {
      if (guardResult.reason === "bindingInvalidated") {
        return {
          ok: false,
          reason: "bindingInvalidated",
          rebindRequired: true,
          invalidationReason: guardResult.invalidationReason,
        };
      }
      return {
        ok: false,
        reason: guardResult.reason,
        rebindRequired: guardResult.rebindRequired,
      };
    }

    const readerResult = guardResult.value;
    if (!readerResult.ok) {
      throw new Error(`reader failed: ${readerResult.reason}`);
    }

    return {
      ok: true,
      snapshot: readerResult.snapshot,
      sequence: readerResult.sequence,
    };
  }

  get lastReadSpyCallCount(): number {
    return this._lastReadSpyCallCount;
  }

  createControlRequest(grant: HostSurfaceGrant, operationKey: string): ControlRequestEnvelope {
    if (!grant.control) {
      throw new Error("grant has no control capability");
    }
    return createControlRequestEnvelope({
      requestKey: `request-${operationKey}`,
      operationKey,
      payload: {
        endpointKey: grant.control.endpointKey,
        action: "invoke",
      },
    });
  }

  consumeControlResponse(
    request: ControlRequestEnvelope,
    response: ControlSuccessEnvelope | ControlFailureEnvelope,
  ): { correlated: boolean; ok: boolean; failureCode?: string } {
    const requestValidated = validateControlRequestEnvelope(JSON.parse(JSON.stringify(request)));
    if (!requestValidated.ok) {
      throw new Error(`request validation failed: ${requestValidated.failure.message}`);
    }

    const responseValidated = validateControlResponseEnvelope(JSON.parse(JSON.stringify(response)));
    if (!responseValidated.ok) {
      throw new Error(`response validation failed: ${responseValidated.failure.message}`);
    }

    const correlation = validateControlResponseForRequest(
      requestValidated.value,
      responseValidated.value,
    );
    if (!correlation.ok) {
      return { correlated: false, ok: false };
    }

    return {
      correlated: true,
      ok: responseValidated.value.ok,
      ...(responseValidated.value.ok === false
        ? { failureCode: responseValidated.value.failure.code }
        : {}),
    };
  }

  createResourceReadRangeRequest(
    grant: HostSurfaceGrant,
    handleKey: string,
    range: { offset: number; byteLength: number },
  ): ControlRequestEnvelope {
    if (!grant.resourcePlane) {
      throw new Error("grant has no resource plane capability");
    }

    const rangePayload = createResourceReadRangeRequestPayload({
      handleKey,
      range,
      owner: {
        authorityKey: grant.owner.authorityKey,
        surfaceKey: grant.owner.surfaceKey,
        authorityEpoch: grant.owner.authorityEpoch,
      },
    });

    const request = createResourceReadRangeControlRequest({
      requestKey: `resource-request-${handleKey}`,
      payload: rangePayload,
    });

    if (request.operationKey !== RESOURCE_READ_RANGE_OPERATION_KEY) {
      throw new Error(
        `resource read-range request operationKey "${request.operationKey}" does not match legacy read-range operation key "${RESOURCE_READ_RANGE_OPERATION_KEY}"`,
      );
    }

    return request;
  }

  consumeResourceReceipt(
    request: ControlRequestEnvelope,
    response: ControlSuccessEnvelope,
  ): { handleKey: string; byteLength: number; version: string } {
    const requestValidated = validateControlRequestEnvelope(JSON.parse(JSON.stringify(request)));
    if (!requestValidated.ok) {
      throw new Error(`resource request validation failed: ${requestValidated.failure.message}`);
    }

    const responseValidated = validateControlResponseEnvelope(JSON.parse(JSON.stringify(response)));
    if (!responseValidated.ok) {
      throw new Error(`resource response validation failed: ${responseValidated.failure.message}`);
    }

    const correlation = validateControlResponseForRequest(
      requestValidated.value,
      responseValidated.value,
    );
    if (!correlation.ok) {
      throw new Error(`resource correlation failed: ${correlation.failure.message}`);
    }

    if (!responseValidated.value.ok) {
      throw new Error("resource response was not ok");
    }

    const receipt = validateResourceReadRangeReceiptPayload(
      responseValidated.value.payload as Record<string, unknown>,
    );
    return {
      handleKey: receipt.handleKey,
      byteLength: receipt.byteLength,
      version: receipt.version,
    };
  }

  applyInvalidation(envelope: HostSurfaceInvalidatedEnvelope): void {
    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json);
    const validated = validateHostSurfaceInvalidatedEnvelope(parsed);
    if (!validated.ok) {
      throw new Error(`invalidation envelope validation failed: ${validated.failure.message}`);
    }

    if (this._grant === null || this._binding === null) {
      throw new Error("cannot apply invalidation without an active grant/binding");
    }

    const owner = validated.value.owner;
    if (
      owner.authorityKey !== this._grant.owner.authorityKey ||
      owner.surfaceKey !== this._grant.owner.surfaceKey ||
      owner.authorityEpoch !== this._grant.owner.authorityEpoch
    ) {
      throw new Error(
        "invalidation owner does not match current grant owner; rejecting foreign/stale invalidation",
      );
    }

    const reason = validated.value.reason;
    this._binding = invalidateAuthorityBinding(this._binding, reason);
  }

  private _lastReadSpyCallCount = 0;
}

function createDeckRuntimeFixtureHost(): FixtureHost {
  const identity = deriveFixtureIdentity();
  const hotRegion = createFixtureHotRegion();

  return new FixtureHost({
    authorityKey: identity.authorityKey,
    surfaceKey: identity.surfaceKey,
    hotRegion,
    controlEndpointKey: "deck-runtime-v0.control",
    controlOperationKeys: ["fixture.deckRuntime.describe", "fixture.deckRuntime.invalidate"],
    warmStreamKey: "deck-runtime-v0.warm",
  });
}

function createDeckRuntimeFixtureClient(): FixtureClient {
  return new FixtureClient();
}

describe("In-process fixture host/client lifecycle", () => {
  describe("Client opens host surface and creates HostSurfaceGrant", () => {
    it("validates surfaceReady envelope and projects HostSurfaceGrant from validated surface", () => {
      const host = createDeckRuntimeFixtureHost();
      const client = createDeckRuntimeFixtureClient();

      const envelope = host.openSurface();
      const grant = client.acceptSurfaceReady(envelope);

      expect(grant.kind).toBe("host.surfaceGrant");
      expect(grant.owner.authorityKey).toBe(host.binding.authorityKey);
      expect(grant.owner.surfaceKey).toBe(host.binding.surfaceKey);
      expect(grant.owner.authorityEpoch).toBe("1");

      expect(grant.expectedBinding.authorityKey).toBe(grant.owner.authorityKey);
      expect(grant.expectedBinding.surfaceKey).toBe(grant.owner.surfaceKey);
      expect(grant.expectedBinding.authorityEpoch).toBe(1n);

      expect(grant.hot).toHaveLength(1);
      expect(grant.hot[0].kind).toBe("surface.hotRegionCapability");
      expect(grant.hot[0].hotRegionKey).toBe("deck-runtime-v0.hot");

      const fixtureBlockA = createFixtureBlockA();
      expect(grant.hot[0].expectedBlockA.instanceKey).toBe(fixtureBlockA.instanceKey);
      expect(grant.hot[0].expectedBlockA.contractKey).toBe(fixtureBlockA.contractKey);
      expect(grant.hot[0].expectedByteLength).toBeGreaterThan(0);

      expect(grant.control).toBeDefined();
      expect(grant.control?.kind).toBe("surface.controlEndpointCapability");
      expect(grant.control?.endpointKey).toBe("deck-runtime-v0.control");
      expect(grant.control?.supportedOperationKeys).toEqual([
        "fixture.deckRuntime.describe",
        "fixture.deckRuntime.invalidate",
      ]);

      expect(grant.resourcePlane).toBeDefined();
      expect(grant.resourcePlane?.kind).toBe("surface.resourcePlaneCapability");
      expect(grant.resourcePlane?.readChunkOperationKey).toBe(RESOURCE_READ_CHUNK_OPERATION_KEY);
      expect(grant.resourcePlane?.owner.authorityKey).toBe(grant.owner.authorityKey);

      expect(grant.warm).toHaveLength(1);
      expect(grant.warm[0].kind).toBe("surface.warmStreamCapability");
      expect(grant.warm[0].streamKey).toBe("deck-runtime-v0.warm");
      expect(grant.warm[0].owner.authorityKey).toBe(grant.owner.authorityKey);
      expect(grant.warm[0].attachmentVersion).toBe(PUBLICATION_TRANSPORT_ATTACHMENT_VERSION);

      assertNoBytePayloadFields(grant, "grant");
      assertDescriptorCarriesOnlyMetadata(grant, DESCRIPTOR_LOCAL_FIELD_KEYS, "grant");
    });
  });

  describe("Client performs guarded hot read through HostSurfaceGrant", () => {
    it("reads hot region using grant-derived capabilities", () => {
      const host = createDeckRuntimeFixtureHost();
      const client = createDeckRuntimeFixtureClient();

      const envelope = host.openSurface();
      const grant = client.acceptSurfaceReady(envelope);

      const { region } = host.getHotRegionForTest();

      expect(region.length).toBe(grant.hot[0].expectedByteLength);
      expect(region.buffer).toBeInstanceOf(SharedArrayBuffer);

      const result = client.readHot(grant, region);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`hot read failed: ${result.reason}`);
      }

      expect(result.sequence).toBe(2n);

      const expectedSnapshot = deriveExpectedDeckRuntimeSnapshot();
      expect(result.snapshot.beatPhase01).toBeCloseTo(expectedSnapshot.beatPhase01, 5);
      expect(result.snapshot.level).toBeCloseTo(expectedSnapshot.level, 5);
      expect(result.snapshot.loopActive).toBe(expectedSnapshot.loopActive);
      expect(result.snapshot.mediaTimeSeconds).toBeCloseTo(expectedSnapshot.mediaTimeSeconds, 5);
      expect(result.snapshot.samplePosition).toBe(expectedSnapshot.samplePosition);
      expect(result.snapshot.stemGains).toEqual(expectedSnapshot.stemGains);
      expect(result.snapshot.tempoRatio).toBeCloseTo(expectedSnapshot.tempoRatio, 5);
      expect(result.snapshot.transportState).toBe(expectedSnapshot.transportState);

      expect(client.lastReadSpyCallCount).toBe(1);
    });
  });

  describe("Client sends descriptor-driven supported control request and host returns correlated response", () => {
    it("creates control request from grant.control.supportedOperationKeys and receives correlated response", () => {
      const host = createDeckRuntimeFixtureHost();
      const client = createDeckRuntimeFixtureClient();

      const envelope = host.openSurface();
      const grant = client.acceptSurfaceReady(envelope);

      expect(grant.control).toBeDefined();
      if (!grant.control) return;

      const operationKey = grant.control.supportedOperationKeys[0];
      expect(operationKey).toBe("fixture.deckRuntime.describe");
      expect(grant.control.supportedOperationKeys.includes(operationKey)).toBe(true);

      const request = client.createControlRequest(grant, operationKey);
      expect(request.kind).toBe("control.request");
      expect(request.operationKey).toBe(operationKey);
      expect(request.operationKey).toBe(grant.control.supportedOperationKeys[0]);

      const hostResult = host.handleControlRequest(request);
      expect(hostResult.ok).toBe(true);

      const response = hostResult.response;
      expect(response.kind).toBe("control.response");
      expect(response.ok).toBe(true);
      expect(response.requestKey).toBe(request.requestKey);

      const consumed = client.consumeControlResponse(request, response);
      expect(consumed.correlated).toBe(true);
      expect(consumed.ok).toBe(true);
      expect(consumed.failureCode).toBeUndefined();

      assertNoBytePayloadFields(response, "control success response");
    });
  });

  describe("Unsupported operation returns control.unsupportedOperation", () => {
    it("request shape validity is separate from operation support; no dispatcher registry exists", () => {
      const host = createDeckRuntimeFixtureHost();
      const client = createDeckRuntimeFixtureClient();

      const envelope = host.openSurface();
      const grant = client.acceptSurfaceReady(envelope);

      expect(grant.control).toBeDefined();
      if (!grant.control) return;

      const supportedSet = new Set(grant.control.supportedOperationKeys);
      const unsupportedOperationKey = "fixture.deckRuntime.nonexistent";
      expect(supportedSet.has(unsupportedOperationKey)).toBe(false);

      const request = client.createControlRequest(grant, unsupportedOperationKey);
      expect(request.kind).toBe("control.request");
      expect(request.operationKey).toBe(unsupportedOperationKey);

      const requestValidated = validateControlRequestEnvelope(JSON.parse(JSON.stringify(request)));
      expect(requestValidated.ok).toBe(true);
      expect(requestValidated.value.operationKey).toBe(unsupportedOperationKey);

      const hostResult = host.handleControlRequest(request);
      expect(hostResult.ok).toBe(false);

      const failureResponse = hostResult.response;
      expect(failureResponse.ok).toBe(false);
      expect(failureResponse.failure.code).toBe("control.unsupportedOperation");
      expect(failureResponse.requestKey).toBe(request.requestKey);

      const consumed = client.consumeControlResponse(request, failureResponse);
      expect(consumed.correlated).toBe(true);
      expect(consumed.ok).toBe(false);
      expect(consumed.failureCode).toBe("control.unsupportedOperation");
    });
  });

  describe("Client performs descriptor-driven resource read-range request and receives receipt only", () => {
    it("uses resource control operation key and returns receipt metadata", () => {
      const host = createDeckRuntimeFixtureHost();
      const client = createDeckRuntimeFixtureClient();

      const envelope = host.openSurface();
      const grant = client.acceptSurfaceReady(envelope);

      expect(grant.resourcePlane).toBeDefined();
      if (!grant.resourcePlane) return;
      expect(grant.resourcePlane.readChunkOperationKey).toBe(RESOURCE_READ_CHUNK_OPERATION_KEY);

      const request = client.createResourceReadRangeRequest(grant, "fixture.resource.waveform-0", {
        offset: 0,
        byteLength: 4096,
      });

      expect(request.kind).toBe("control.request");
      expect(request.operationKey).toBe(RESOURCE_READ_RANGE_OPERATION_KEY);
      expect(request.operationKey).toBe(RESOURCE_READ_RANGE_OPERATION_KEY);

      const requestValidated = validateControlRequestEnvelope(JSON.parse(JSON.stringify(request)));
      expect(requestValidated.ok).toBe(true);
      expect(requestValidated.value.operationKey).toBe(RESOURCE_READ_RANGE_OPERATION_KEY);

      const response = host.handleResourceReadRangeRequest(request);
      expect(response.kind).toBe("control.response");
      expect(response.ok).toBe(true);

      const receipt = client.consumeResourceReceipt(request, response);
      expect(receipt.handleKey).toBe("fixture.resource.waveform-0");
      expect(receipt.byteLength).toBe(4096);
      expect(receipt.version).toBe("1");

      assertNoBytePayloadFields(response, "resource read-range success response");

      const responseJson = JSON.stringify(response);
      expect(responseJson).not.toContain("SharedArrayBuffer");
      expect(responseJson).not.toContain("bytes");
    });
  });

  describe("Host invalidation prevents later hot read before reader.tryRead", () => {
    it("structurally readable hot region is not enough; session validity gates access", () => {
      const host = createDeckRuntimeFixtureHost();
      const client = createDeckRuntimeFixtureClient();

      const envelope = host.openSurface();
      const grant = client.acceptSurfaceReady(envelope);

      const invalidationEnvelope = host.invalidateAuthority("authorityRestarted");
      expect(invalidationEnvelope.kind).toBe("host.surfaceInvalidated");
      expect(invalidationEnvelope.reason).toBe("authorityRestarted");

      client.applyInvalidation(invalidationEnvelope);

      const { region } = host.getHotRegionForTest();

      expect(region.length).toBe(grant.hot[0].expectedByteLength);
      expect(region.buffer).toBeInstanceOf(SharedArrayBuffer);

      const result = client.readHot(grant, region);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("readHot should have failed after invalidation");
      }

      expect(result.reason).toBe("bindingInvalidated");
      expect(result.rebindRequired).toBe(true);
      expect(result.invalidationReason).toBe("authorityRestarted");

      expect(client.lastReadSpyCallCount).toBe(0);
    });
  });

  describe("Stale owner epoch in grant prevents hot read before reader.tryRead", () => {
    it("epoch 2 grant vs epoch 1 binding fails with authorityEpochMismatch; tryRead not called", () => {
      const host = createDeckRuntimeFixtureHost();
      const client = createDeckRuntimeFixtureClient();

      const envelope = host.openSurface();
      const grant = client.acceptSurfaceReady(envelope);

      const staleGrant: HostSurfaceGrant = {
        ...grant,
        expectedBinding: {
          ...grant.expectedBinding,
          authorityEpoch: 2n,
        },
      };

      expect(staleGrant.expectedBinding.authorityEpoch).toBe(2n);
      expect(client.binding.authorityEpoch).toBe(1n);

      const { region } = host.getHotRegionForTest();

      const result = client.readHot(staleGrant, region);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("readHot should have failed for stale epoch");
      }

      expect(result.reason).toBe("authorityEpochMismatch");
      expect(result.rebindRequired).toBe(true);
      expect(client.lastReadSpyCallCount).toBe(0);
    });
  });

  describe("Foreign/stale invalidation envelope does not invalidate client binding", () => {
    it("rejects invalidation from mismatched owner and preserves binding", () => {
      const host = createDeckRuntimeFixtureHost();
      const client = createDeckRuntimeFixtureClient();

      const envelope = host.openSurface();
      const grant = client.acceptSurfaceReady(envelope);

      const invalidationEnvelope = host.invalidateAuthority("authorityRestarted");

      const epochMutated = JSON.parse(JSON.stringify(invalidationEnvelope));
      epochMutated.owner.authorityEpoch = "2";
      expect(() =>
        client.applyInvalidation(epochMutated as HostSurfaceInvalidatedEnvelope),
      ).toThrow(/invalidation owner does not match/);

      const surfaceMutated = JSON.parse(JSON.stringify(invalidationEnvelope));
      surfaceMutated.owner.surfaceKey = "foreign-surface-key";
      expect(() =>
        client.applyInvalidation(surfaceMutated as HostSurfaceInvalidatedEnvelope),
      ).toThrow(/invalidation owner does not match/);

      const { region } = host.getHotRegionForTest();
      const result = client.readHot(grant, region);
      expect(result.ok).toBe(true);
      expect(client.lastReadSpyCallCount).toBe(1);
    });
  });
});
