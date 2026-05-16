// Generated from fixtures/projection-runtime/hot-exchange-v0/hot-layout-manifest.json. Do not edit by hand.

import { bindHotPublishRegion } from "@exclave/hot-binding";
import { type HotPublishResult, publishHotRegion } from "@exclave/hot-publisher";
import type { HotExchangeSnapshot } from "./hot-reader.ts";

export type HotExchangeWriter = {
  readonly publish: (snapshot: HotExchangeSnapshot) => HotPublishResult;
};

const SEQLOCK_OFFSET = 72;
const PUBLICATION_SEQUENCE_OFFSET = 88;
const TOTAL_REGION_BYTE_LENGTH = 152;
const CONTRACT_KEY = "fixture.hotExchange.v0";
const SEMANTIC_VERSION = 0xda65c7947f2837d9n;
const HOT_LAYOUT_VERSION = 0xa601a5b9fe7fc79en;
const FIELD_COUNT = 5;
const MUTABLE_REGION_BYTE_LENGTH = 80;
const DISPLAY_NAME_OFFSET = 96;
const DISPLAY_NAME_BYTE_LENGTH = 16;
const GAIN_OFFSET = 112;
const LEVEL_VECTOR_OFFSET = 116;
const LEVEL_VECTOR_LENGTH = 4;
const LEVEL_VECTOR_0_OFFSET = LEVEL_VECTOR_OFFSET;
const LEVEL_VECTOR_1_OFFSET = 120;
const LEVEL_VECTOR_2_OFFSET = 124;
const LEVEL_VECTOR_3_OFFSET = 128;
const PHASE_OFFSET = 136;
const REVISION_OFFSET = 144;

export function createHotExchangeWriter(
  region: Uint8Array,
  { instanceKey }: { instanceKey: string },
): HotExchangeWriter {
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
    publish: (snapshot: HotExchangeSnapshot) => {
      validateHotExchangeSnapshot(snapshot);
      return publishHotRegion({
        seqlock: binding.seqlock,
        publicationSequence: binding.publicationSequence,
        writeRegion: () => writeHotExchangeSnapshotUnchecked(binding.region, snapshot),
      });
    },
  };
}

export function validateHotExchangeSnapshot(snapshot: HotExchangeSnapshot): void {
  if (!isRecord(snapshot)) {
    throw new TypeError("HotExchangeSnapshot must be an object");
  }

  validateDisplayName(snapshot.displayName);

  requireFiniteNumber(snapshot.gain, "gain");

  validateLevelVector(snapshot.levelVector);

  requireFiniteNumber(snapshot.phase, "phase");

  requireU32(snapshot.revision, "revision");
}

export function writeHotExchangeSnapshotUnchecked(
  region: Uint8Array,
  snapshot: HotExchangeSnapshot,
): void {
  const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
  writeDisplayName(view, snapshot.displayName);
  view.setFloat32(GAIN_OFFSET, snapshot.gain, true);
  writeLevelVector(view, snapshot.levelVector);
  view.setFloat64(PHASE_OFFSET, snapshot.phase, true);
  view.setUint32(REVISION_OFFSET, snapshot.revision, true);
}

function validateDisplayName(value: unknown): void {
  if (typeof value !== "string") {
    throw new TypeError("displayName must be a string");
  }

  if (value.length > DISPLAY_NAME_BYTE_LENGTH) {
    throw new RangeError(`displayName must fit in ${DISPLAY_NAME_BYTE_LENGTH} ASCII bytes`);
  }

  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) {
      throw new RangeError("displayName must contain ASCII only");
    }
  }
}

function writeDisplayName(view: DataView, value: string): void {
  for (let index = 0; index < DISPLAY_NAME_BYTE_LENGTH; index += 1) {
    const byte = index < value.length ? value.charCodeAt(index) : 0;
    view.setUint8(DISPLAY_NAME_OFFSET + index, byte);
  }
}

function validateLevelVector(value: unknown): void {
  if (!Array.isArray(value) || value.length !== LEVEL_VECTOR_LENGTH) {
    throw new RangeError(`levelVector must contain exactly ${LEVEL_VECTOR_LENGTH} elements`);
  }

  for (let index = 0; index < value.length; index += 1) {
    requireFiniteNumber(value[index], `levelVector.${index}`);
  }
}

function writeLevelVector(view: DataView, value: readonly [number, number, number, number]): void {
  view.setFloat32(LEVEL_VECTOR_0_OFFSET, value[0], true);
  view.setFloat32(LEVEL_VECTOR_1_OFFSET, value[1], true);
  view.setFloat32(LEVEL_VECTOR_2_OFFSET, value[2], true);
  view.setFloat32(LEVEL_VECTOR_3_OFFSET, value[3], true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(value: unknown, fieldName: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${fieldName} must be a finite number`);
  }
}

function requireU32(value: unknown, fieldName: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${fieldName} must be an integer in u32 range`);
  }
}
