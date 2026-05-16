// Generated from fixtures/projection-runtime/deck-runtime-v0/hot-layout-manifest.json. Do not edit by hand.

import { bindHotReadRegion } from "@exclave/hot-binding";
import {
  createHotReadState,
  type HotReadAttemptResult,
  type HotReadOptions,
  type HotReadState,
  tryReadHotSnapshot,
} from "@exclave/hot-consumer";

export type DeckRuntimeSnapshot = {
  readonly beatPhase01: number;
  readonly level: number;
  readonly loopActive: boolean;
  readonly mediaTimeSeconds: number;
  readonly samplePosition: bigint;
  readonly stemGains: readonly number[];
  readonly tempoRatio: number;
  readonly transportState: "stopped" | "cueing" | "playing" | "paused";
};

export type DeckRuntimeReader = {
  readonly tryRead: (options?: HotReadOptions) => HotReadAttemptResult<DeckRuntimeSnapshot>;
};

const SEQLOCK_OFFSET = 72;
const TOTAL_REGION_BYTE_LENGTH = 160;
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

export function readDeckRuntimeSnapshotUnchecked(region: Uint8Array): DeckRuntimeSnapshot {
  const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
  return readDeckRuntimeFields(view);
}

export function createDeckRuntimeReader(region: Uint8Array): DeckRuntimeReader {
  const binding = bindHotReadRegion({
    region,
    seqlockOffset: SEQLOCK_OFFSET,
    totalRegionByteLength: TOTAL_REGION_BYTE_LENGTH,
  });
  const state: HotReadState<DeckRuntimeSnapshot> = createHotReadState<DeckRuntimeSnapshot>();

  return {
    tryRead: (options?: HotReadOptions) =>
      tryReadHotSnapshot({
        sequence: binding.seqlock,
        readCandidate: () => readDeckRuntimeSnapshotUnchecked(binding.region),
        state,
        ...(options !== undefined && { options }),
      }),
  };
}

function readDeckRuntimeFields(view: DataView): DeckRuntimeSnapshot {
  return {
    beatPhase01: view.getFloat32(BEAT_PHASE01_OFFSET, true),
    level: view.getFloat32(LEVEL_OFFSET, true),
    loopActive: readBoolean(view, LOOP_ACTIVE_OFFSET, "loopActive"),
    mediaTimeSeconds: view.getFloat64(MEDIA_TIME_SECONDS_OFFSET, true),
    samplePosition: view.getBigUint64(SAMPLE_POSITION_OFFSET, true),
    stemGains: readStemGains(view),
    tempoRatio: view.getFloat32(TEMPO_RATIO_OFFSET, true),
    transportState: readTransportState(view),
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

function readStemGains(view: DataView): readonly number[] {
  const count = view.getUint32(STEM_GAINS_COUNT_OFFSET, true);
  if (count > STEM_GAINS_MAX_COUNT) {
    throw new RangeError("stemGains bounded array count exceeds maxCount");
  }

  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(
      view.getFloat32(STEM_GAINS_ELEMENTS_OFFSET + index * STEM_GAINS_UNIT_BYTE_LENGTH, true),
    );
  }
  return values;
}

function readTransportState(view: DataView): "stopped" | "cueing" | "playing" | "paused" {
  const discriminant = view.getUint8(TRANSPORT_STATE_OFFSET);
  const value = TRANSPORT_STATE_VARIANTS[discriminant];
  if (value === undefined) {
    throw new RangeError("transportState enum discriminant is outside variants");
  }
  return value;
}
