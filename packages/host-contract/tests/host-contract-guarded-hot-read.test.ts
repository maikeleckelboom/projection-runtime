import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AuthorityBinding,
  type BindingExpectation,
  type BindingValidityFailure,
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
  createHostAuthorityOwnerFromBinding,
  createHostHotRegionDescriptor,
  createHostSurfaceDescriptor,
  createHostSurfaceReadyEnvelope,
  HOST_CONTRACT_VERSION,
  type HostHotBlockAExpectation,
  type HostHotRegionDescriptor,
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

// fixture JSON paths used:
//   hot-block-a-fixture.json.contractKey   -> authorityKey
//   hot-block-a-fixture.json.instanceKey   -> surfaceKey

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

// fixture JSON paths used:
//   hot-block-a-fixture.json.contractKey
//   hot-block-a-fixture.json.instanceKey
//   hot-block-a-fixture.json.semanticVersion  (hex -> decimal string)
//   hot-block-a-fixture.json.hotLayoutVersion  (hex -> decimal string)
//   hot-block-a-fixture.json.fieldCount
//   hot-block-a-fixture.json.mutableRegionByteLength

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

// fixture JSON paths used:
//   hot-layout-manifest.json.totalRegionByteLength
//   hot-layout-manifest.json.seqlockOffset
//   hot-layout-manifest.json.publicationSeqOffset

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

// fixture JSON path used:
//   hot-complete-fixture-region.json.completeFixtureRegionBytesHex

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

// fixture JSON paths used:
//   hot-complete-fixture-region.json.decoded.fieldValues

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
  if (!["stopped", "cueing", "playing", "paused"].includes(transportState)) {
    throw new Error(
      `fieldValues.transportState must be one of: stopped, cueing, playing, paused, got "${transportState}"`,
    );
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

describe("Host surface guarded hot reads", () => {
  describe("ready host surface descriptor permits a guarded generated hot read", () => {
    it("validates surfaceReady envelope, converts owner to session expectation, guards a DeckRuntimeReader read", () => {
      const identity = deriveFixtureIdentity();
      const binding: AuthorityBinding = createAuthorityBinding(identity);
      const readyBinding = markAuthorityBindingReady(binding);

      const owner = createHostAuthorityOwnerFromBinding(readyBinding);
      expect(owner.authorityKey).toBe(identity.authorityKey);
      expect(owner.surfaceKey).toBe(identity.surfaceKey);
      expect(owner.authorityEpoch).toBe("1");

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
      const parsed = JSON.parse(json);

      const validated = validateHostSurfaceReadyEnvelope(parsed);
      expect(validated.ok).toBe(true);
      if (!validated.ok) {
        throw new Error(`validation failed: ${validated.failure.message}`);
      }

      const validatedHotRegion = validated.value.surface.hotRegions?.[0];
      expect(validatedHotRegion).toBeDefined();
      if (!validatedHotRegion) {
        throw new Error("validated hot region descriptor is missing");
      }

      const vOwner = validated.value.surface.owner;

      const expected: BindingExpectation = {
        authorityKey: vOwner.authorityKey,
        surfaceKey: vOwner.surfaceKey,
        authorityEpoch: decimalStringToBigInt(vOwner.authorityEpoch, "owner.authorityEpoch"),
      };

      expect(expected.authorityKey).toBe(identity.authorityKey);
      expect(expected.surfaceKey).toBe(identity.surfaceKey);
      expect(expected.authorityEpoch).toBe(1n);

      const { region, totalRegionByteLength } = createSharedRegionFromFixture();
      expect(region.length).toBe(validatedHotRegion.totalRegionByteLength);
      expect(region.length).toBe(totalRegionByteLength);
      expect(totalRegionByteLength).toBe(validatedHotRegion.totalRegionByteLength);
      expect(region.buffer).toBeInstanceOf(SharedArrayBuffer);

      const instanceKey = validatedHotRegion.blockA.instanceKey;
      const reader = createDeckRuntimeReader(region, { instanceKey });

      let readCallCount = 0;
      const readSpy = () => {
        readCallCount += 1;
        return reader.tryRead({ maxWriterActivePolls: 0, maxTornReads: 0 });
      };

      const guardResult = guardAuthorityBinding(readyBinding, expected, readSpy);

      expect(guardResult.ok).toBe(true);
      if (!guardResult.ok) {
        throw new Error(`guard failed unexpectedly: ${guardResult.reason}`);
      }

      expect(readCallCount).toBe(1);

      const readerResult = guardResult.value;
      expect(readerResult.ok).toBe(true);
      if (!readerResult.ok) {
        throw new Error(`reader failed: ${readerResult.reason}`);
      }

      expect(readerResult.sequence).toBe(2n);

      const expectedSnapshot = deriveExpectedDeckRuntimeSnapshot();

      const snapshot: DeckRuntimeSnapshot = readerResult.snapshot;
      expect(snapshot.beatPhase01).toBeCloseTo(expectedSnapshot.beatPhase01, 5);
      expect(snapshot.level).toBeCloseTo(expectedSnapshot.level, 5);
      expect(snapshot.loopActive).toBe(expectedSnapshot.loopActive);
      expect(typeof snapshot.loopActive).toBe("boolean");
      expect(snapshot.mediaTimeSeconds).toBeCloseTo(expectedSnapshot.mediaTimeSeconds, 5);
      expect(typeof snapshot.samplePosition).toBe("bigint");
      expect(snapshot.samplePosition).toBe(expectedSnapshot.samplePosition);
      expect(snapshot.stemGains).toEqual(expectedSnapshot.stemGains);
      expect(snapshot.tempoRatio).toBeCloseTo(expectedSnapshot.tempoRatio, 5);
      expect(snapshot.transportState).toBe(expectedSnapshot.transportState);
      if (expectedSnapshot.transportState === "playing") {
        expect(snapshot.transportState).toBe("playing");
      }
    });
  });

  describe("invalidated binding prevents the generated hot read", () => {
    it("session-invalidated binding fails guard before reader.tryRead is called", () => {
      const identity = deriveFixtureIdentity();
      const binding: AuthorityBinding = createAuthorityBinding(identity);
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
      const parsed = JSON.parse(json);

      const validated = validateHostSurfaceReadyEnvelope(parsed);
      expect(validated.ok).toBe(true);
      if (!validated.ok) {
        throw new Error(`validation failed: ${validated.failure.message}`);
      }

      const validatedHotRegion = validated.value.surface.hotRegions?.[0];
      expect(validatedHotRegion).toBeDefined();
      if (!validatedHotRegion) {
        throw new Error("validated hot region descriptor is missing");
      }

      const vOwner = validated.value.surface.owner;

      const expected: BindingExpectation = {
        authorityKey: vOwner.authorityKey,
        surfaceKey: vOwner.surfaceKey,
        authorityEpoch: decimalStringToBigInt(vOwner.authorityEpoch, "owner.authorityEpoch"),
      };

      const invalidatedBinding = invalidateAuthorityBinding(readyBinding, "authorityRestarted");

      const { region } = createSharedRegionFromFixture();
      expect(region.length).toBe(validatedHotRegion.totalRegionByteLength);
      const instanceKey = validatedHotRegion.blockA.instanceKey;
      const reader = createDeckRuntimeReader(region, { instanceKey });

      let readCallCount = 0;
      const readSpy = () => {
        readCallCount += 1;
        return reader.tryRead({ maxWriterActivePolls: 0, maxTornReads: 0 });
      };

      const guardResult = guardAuthorityBinding(invalidatedBinding, expected, readSpy);

      expect(guardResult.ok).toBe(false);
      if (guardResult.ok) {
        throw new Error("guard should have failed for invalidated binding");
      }

      const failure = guardResult as BindingValidityFailure;
      expect(failure.reason).toBe("bindingInvalidated");
      expect(failure.rebindRequired).toBe(true);

      if (failure.reason === "bindingInvalidated") {
        expect(failure.invalidationReason).toBe("authorityRestarted");
      }

      expect(readCallCount).toBe(0);
    });
  });

  describe("stale owner epoch from host descriptor prevents hot read", () => {
    it("stale authorityEpoch in host descriptor survives host-contract validation but fails session guard", () => {
      const identity = deriveFixtureIdentity();
      const binding: AuthorityBinding = createAuthorityBinding(identity);
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

      const staleHotRegion = staleValidated.ok
        ? staleValidated.value.surface.hotRegions?.[0]
        : undefined;
      expect(staleHotRegion).toBeDefined();
      if (!staleHotRegion) {
        throw new Error("stale validated hot region descriptor is missing");
      }

      const staleExpected: BindingExpectation = {
        authorityKey: identity.authorityKey,
        surfaceKey: identity.surfaceKey,
        authorityEpoch: decimalStringToBigInt(
          parsedOwner.authorityEpoch,
          "parsedOwner.authorityEpoch",
        ),
      };
      expect(staleExpected.authorityEpoch).toBe(2n);

      const { region } = createSharedRegionFromFixture();
      expect(region.length).toBe(staleHotRegion.totalRegionByteLength);
      const instanceKey = staleHotRegion.blockA.instanceKey;
      const reader = createDeckRuntimeReader(region, { instanceKey });

      let readCallCount = 0;
      const readSpy = () => {
        readCallCount += 1;
        return reader.tryRead({ maxWriterActivePolls: 0, maxTornReads: 0 });
      };

      const guardResult = guardAuthorityBinding(readyBinding, staleExpected, readSpy);

      expect(guardResult.ok).toBe(false);
      if (guardResult.ok) {
        throw new Error("guard should have failed for stale epoch");
      }

      const failure = guardResult as BindingValidityFailure;
      expect(failure.reason).toBe("authorityEpochMismatch");
      expect(failure.rebindRequired).toBe(true);

      expect(readCallCount).toBe(0);
    });
  });
});
