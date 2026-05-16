// Generated from fixtures/projection-runtime/hot-exchange-v0/hot-layout-manifest.json. Do not edit by hand.

import { bindHotReadRegion } from "@exclave/hot-binding";
import {
  createHotReadState,
  type HotReadAttemptResult,
  type HotReadOptions,
  type HotReadState,
  tryReadHotSnapshot,
} from "@exclave/hot-consumer";

export type HotExchangeSnapshot = {
  readonly displayName: string;
  readonly gain: number;
  readonly levelVector: readonly [number, number, number, number];
  readonly phase: number;
  readonly revision: number;
};

export type HotExchangeReader = {
  readonly tryRead: (options?: HotReadOptions) => HotReadAttemptResult<HotExchangeSnapshot>;
};

const SEQLOCK_OFFSET = 72;
const TOTAL_REGION_BYTE_LENGTH = 152;
const DISPLAY_NAME_OFFSET = 96;
const DISPLAY_NAME_BYTE_LENGTH = 16;
const GAIN_OFFSET = 112;
const LEVEL_VECTOR_OFFSET = 116;
const LEVEL_VECTOR_0_OFFSET = LEVEL_VECTOR_OFFSET;
const LEVEL_VECTOR_1_OFFSET = 120;
const LEVEL_VECTOR_2_OFFSET = 124;
const LEVEL_VECTOR_3_OFFSET = 128;
const PHASE_OFFSET = 136;
const REVISION_OFFSET = 144;

export function readHotExchangeSnapshotUnchecked(region: Uint8Array): HotExchangeSnapshot {
  const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
  return readHotExchangeFields(view);
}

export function createHotExchangeReader(region: Uint8Array): HotExchangeReader {
  const binding = bindHotReadRegion({
    region,
    seqlockOffset: SEQLOCK_OFFSET,
    totalRegionByteLength: TOTAL_REGION_BYTE_LENGTH,
  });
  const state: HotReadState<HotExchangeSnapshot> = createHotReadState<HotExchangeSnapshot>();

  return {
    tryRead: (options?: HotReadOptions) =>
      tryReadHotSnapshot({
        sequence: binding.seqlock,
        readCandidate: () => readHotExchangeSnapshotUnchecked(binding.region),
        state,
        ...(options !== undefined && { options }),
      }),
  };
}

function readHotExchangeFields(view: DataView): HotExchangeSnapshot {
  return {
    displayName: readDisplayName(view),
    gain: view.getFloat32(GAIN_OFFSET, true),
    levelVector: [
      view.getFloat32(LEVEL_VECTOR_0_OFFSET, true),
      view.getFloat32(LEVEL_VECTOR_1_OFFSET, true),
      view.getFloat32(LEVEL_VECTOR_2_OFFSET, true),
      view.getFloat32(LEVEL_VECTOR_3_OFFSET, true),
    ],
    phase: view.getFloat64(PHASE_OFFSET, true),
    revision: view.getUint32(REVISION_OFFSET, true),
  };
}

function readDisplayName(view: DataView): string {
  let value = "";
  for (
    let offset = DISPLAY_NAME_OFFSET;
    offset < DISPLAY_NAME_OFFSET + DISPLAY_NAME_BYTE_LENGTH;
    offset += 1
  ) {
    const byte = view.getUint8(offset);
    if (byte === 0) {
      break;
    }
    if (byte > 0x7f) {
      throw new RangeError("displayName contains a non-ascii byte");
    }
    value += String.fromCharCode(byte);
  }
  return value;
}
