// Generated from fixtures/projection-runtime/deck-runtime-v0/hot-layout-manifest.json. Do not edit by hand.

import { bindHotPublishRegion } from "@exclave/hot-binding";
import { type HotPublishResult, publishHotRegion } from "@exclave/hot-publisher";
import type { DeckRuntimeSnapshot } from "./hot-reader.ts";

export type DeckRuntimeWriter = {
  readonly publish: (snapshot: DeckRuntimeSnapshot) => HotPublishResult;
};

const SEQLOCK_OFFSET = 72;
const PUBLICATION_SEQUENCE_OFFSET = 88;
const TOTAL_REGION_BYTE_LENGTH = 160;
const CONTRACT_KEY = "fixture.deckRuntime";
const SEMANTIC_VERSION = 0xe3636f7cdffa73b2n;
const HOT_LAYOUT_VERSION = 0xaddeef4f8ef66eadn;
const FIELD_COUNT = 8;
const MUTABLE_REGION_BYTE_LENGTH = 88;
const BEAT_PHASE01_OFFSET = 96;
const LEVEL_OFFSET = 100;
const LOOP_ACTIVE_OFFSET = 104;
const MEDIA_TIME_SECONDS_OFFSET = 112;
const SAMPLE_POSITION_OFFSET = 120;
const STEM_GAINS_COUNT_OFFSET = 128;
const STEM_GAINS_ELEMENTS_OFFSET = 132;
const STEM_GAINS_MAX_COUNT = 4;
const STEM_GAINS_UNIT_BYTE_LENGTH = 4;
const TEMPO_RATIO_OFFSET = 148;
const TRANSPORT_STATE_OFFSET = 152;
const TRANSPORT_STATE_VARIANTS = ["stopped", "cueing", "playing", "paused"] as const;

export function createDeckRuntimeWriter(
  region: Uint8Array,
  { instanceKey }: { instanceKey: string },
): DeckRuntimeWriter {
  const binding = bindHotPublishRegion({
    region,
    seqlockOffset: SEQLOCK_OFFSET,
    publicationSequenceOffset: PUBLICATION_SEQUENCE_OFFSET,
    totalRegionByteLength: TOTAL_REGION_BYTE_LENGTH,
    blockA: {
      contractKey: CONTRACT_KEY,
      instanceKey,
      semanticVersion: SEMANTIC_VERSION,
      hotLayoutVersion: HOT_LAYOUT_VERSION,
      fieldCount: FIELD_COUNT,
      mutableRegionByteLength: MUTABLE_REGION_BYTE_LENGTH,
    },
  });

  return {
    publish: (snapshot: DeckRuntimeSnapshot) => {
      validateDeckRuntimeSnapshot(snapshot);
      return publishHotRegion({
        seqlock: binding.seqlock,
        publicationSequence: binding.publicationSequence,
        writeRegion: () => writeDeckRuntimeSnapshotUnchecked(binding.region, snapshot),
      });
    },
  };
}

export function validateDeckRuntimeSnapshot(snapshot: DeckRuntimeSnapshot): void {
  if (!isRecord(snapshot)) {
    throw new TypeError("DeckRuntimeSnapshot must be an object");
  }

  requireFiniteNumber(snapshot.beatPhase01, "beatPhase01");

  requireFiniteNumber(snapshot.level, "level");

  requireBoolean(snapshot.loopActive, "loopActive");

  requireFiniteNumber(snapshot.mediaTimeSeconds, "mediaTimeSeconds");

  requireU64(snapshot.samplePosition, "samplePosition");

  validateStemGains(snapshot.stemGains);

  requireFiniteNumber(snapshot.tempoRatio, "tempoRatio");

  validateTransportState(snapshot.transportState);
}

export function writeDeckRuntimeSnapshotUnchecked(
  region: Uint8Array,
  snapshot: DeckRuntimeSnapshot,
): void {
  const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
  view.setFloat32(BEAT_PHASE01_OFFSET, snapshot.beatPhase01, true);
  view.setFloat32(LEVEL_OFFSET, snapshot.level, true);
  view.setUint8(LOOP_ACTIVE_OFFSET, snapshot.loopActive ? 1 : 0);
  view.setFloat64(MEDIA_TIME_SECONDS_OFFSET, snapshot.mediaTimeSeconds, true);
  view.setBigUint64(SAMPLE_POSITION_OFFSET, snapshot.samplePosition, true);
  writeStemGains(view, snapshot.stemGains);
  view.setFloat32(TEMPO_RATIO_OFFSET, snapshot.tempoRatio, true);
  view.setUint8(TRANSPORT_STATE_OFFSET, TRANSPORT_STATE_VARIANTS.indexOf(snapshot.transportState));
}

function validateStemGains(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new TypeError("stemGains must be an array");
  }

  if (value.length > STEM_GAINS_MAX_COUNT) {
    throw new RangeError(`stemGains length must be <= ${STEM_GAINS_MAX_COUNT}`);
  }

  for (let index = 0; index < value.length; index += 1) {
    requireFiniteNumber(value[index], `stemGains.${index}`);
  }
}

function writeStemGains(view: DataView, value: readonly number[]): void {
  view.setUint32(STEM_GAINS_COUNT_OFFSET, value.length, true);

  for (let index = 0; index < STEM_GAINS_MAX_COUNT; index += 1) {
    if (index < value.length) {
      view.setFloat32(
        STEM_GAINS_ELEMENTS_OFFSET + index * STEM_GAINS_UNIT_BYTE_LENGTH,
        value[index] as number,
        true,
      );
    } else {
      view.setFloat32(STEM_GAINS_ELEMENTS_OFFSET + index * STEM_GAINS_UNIT_BYTE_LENGTH, 0, true);
    }
  }
}

function validateTransportState(value: unknown): void {
  if (
    typeof value !== "string" ||
    !(TRANSPORT_STATE_VARIANTS as readonly string[]).includes(value)
  ) {
    throw new RangeError("transportState must be one of the generated variants");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(value: unknown, fieldName: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${fieldName} must be a finite number`);
  }
}

function requireBoolean(value: unknown, fieldName: string): void {
  if (typeof value !== "boolean") {
    throw new TypeError(`${fieldName} must be a boolean`);
  }
}

function requireU64(value: unknown, fieldName: string): void {
  if (typeof value !== "bigint" || value < 0n || value > 0xffffffffffffffffn) {
    throw new RangeError(`${fieldName} must be a bigint in u64 range`);
  }
}
