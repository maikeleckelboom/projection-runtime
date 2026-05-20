// Generated from fixtures/projection-runtime/nested-hot-fields-v0/hot-layout-manifest.json. Do not edit by hand.

import { bindHotReadRegion } from "@exclave/hot-binding";
import {
  createHotReadState,
  type HotReadAttemptResult,
  type HotReadOptions,
  type HotReadState,
  tryReadHotSnapshot,
} from "@exclave/hot-consumer";

export type NestedHotFieldsSnapshot = {
  readonly metersLeft: number;
  readonly metersRight: number;
  readonly statusActive: boolean;
  readonly statusSpeed: number;
};

export type NestedHotFieldsReader = {
  readonly tryRead: (options?: HotReadOptions) => HotReadAttemptResult<NestedHotFieldsSnapshot>;
};

const SEQLOCK_OFFSET = 72;
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

export function readNestedHotFieldsSnapshotUnchecked(region: Uint8Array): NestedHotFieldsSnapshot {
  const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
  return readNestedHotFieldsFields(view);
}

export function createNestedHotFieldsReader(
  region: Uint8Array,
  { instanceKey }: { instanceKey: string },
): NestedHotFieldsReader {
  const binding = bindHotReadRegion({
    region,
    seqlockOffset: SEQLOCK_OFFSET,
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
  const state: HotReadState<NestedHotFieldsSnapshot> =
    createHotReadState<NestedHotFieldsSnapshot>();

  return {
    tryRead: (options?: HotReadOptions) =>
      tryReadHotSnapshot({
        sequence: binding.seqlock,
        readCandidate: () => readNestedHotFieldsSnapshotUnchecked(binding.region),
        state,
        ...(options !== undefined && { options }),
      }),
  };
}

function readNestedHotFieldsFields(view: DataView): NestedHotFieldsSnapshot {
  return {
    metersLeft: view.getFloat64(METERS_LEFT_OFFSET, true),
    metersRight: view.getFloat64(METERS_RIGHT_OFFSET, true),
    statusActive: readBoolean(view, STATUS_ACTIVE_OFFSET, "status.active"),
    statusSpeed: view.getFloat32(STATUS_SPEED_OFFSET, true),
  };
}

function readBoolean(view: DataView, offset: number, fieldName: string): boolean {
  const value = view.getUint8(offset);
  if (value === 0) {
    return false;
  }
  if (value === 1) {
    return true;
  }
  throw new RangeError(`${fieldName} bool byte must be 0 or 1`);
}
