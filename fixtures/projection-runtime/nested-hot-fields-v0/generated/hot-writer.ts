// Generated from fixtures/projection-runtime/nested-hot-fields-v0/hot-layout-manifest.json. Do not edit by hand.

import { bindHotPublishRegion } from "@exclave/hot-binding";
import { type HotPublishResult, publishHotRegion } from "@exclave/hot-publisher";
import type { NestedHotFieldsSnapshot } from "./hot-reader.ts";

export type NestedHotFieldsWriter = {
  readonly publish: (snapshot: NestedHotFieldsSnapshot) => HotPublishResult;
};

const SEQLOCK_OFFSET = 72;
const PUBLICATION_SEQUENCE_OFFSET = 88;
const TOTAL_REGION_BYTE_LENGTH = 120;
const CONTRACT_KEY = "fixture.nestedHotFields";
const SEMANTIC_VERSION = 0x5fc08473f9e0ab47n;
const HOT_LAYOUT_VERSION = 0x6511718d600129ccn;
const FIELD_COUNT = 4;
const MUTABLE_REGION_BYTE_LENGTH = 48;
const METERS_LEFT_OFFSET = 96;
const METERS_RIGHT_OFFSET = 104;
const STATUS_ACTIVE_OFFSET = 112;
const STATUS_SPEED_OFFSET = 116;

export function createNestedHotFieldsWriter(
  region: Uint8Array,
  { instanceKey }: { instanceKey: string },
): NestedHotFieldsWriter {
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
    publish: (snapshot: NestedHotFieldsSnapshot) => {
      validateNestedHotFieldsSnapshot(snapshot);
      return publishHotRegion({
        seqlock: binding.seqlock,
        publicationSequence: binding.publicationSequence,
        writeRegion: () => writeNestedHotFieldsSnapshotUnchecked(binding.region, snapshot),
      });
    },
  };
}

export function validateNestedHotFieldsSnapshot(snapshot: NestedHotFieldsSnapshot): void {
  if (!isRecord(snapshot)) {
    throw new TypeError("NestedHotFieldsSnapshot must be an object");
  }

  requireFiniteNumber(snapshot.metersLeft, "meters.left");

  requireFiniteNumber(snapshot.metersRight, "meters.right");

  requireBoolean(snapshot.statusActive, "status.active");

  requireFiniteNumber(snapshot.statusSpeed, "status.speed");
}

export function writeNestedHotFieldsSnapshotUnchecked(
  region: Uint8Array,
  snapshot: NestedHotFieldsSnapshot,
): void {
  const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
  view.setFloat64(METERS_LEFT_OFFSET, snapshot.metersLeft, true);
  view.setFloat64(METERS_RIGHT_OFFSET, snapshot.metersRight, true);
  view.setUint8(STATUS_ACTIVE_OFFSET, snapshot.statusActive ? 1 : 0);
  view.setFloat32(STATUS_SPEED_OFFSET, snapshot.statusSpeed, true);
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
