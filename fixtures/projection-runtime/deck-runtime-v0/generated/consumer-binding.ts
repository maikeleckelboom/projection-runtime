// Generated from fixtures/projection-runtime/deck-runtime-v0/resolved-contract.json. Do not edit by hand.
import type { HotReadAttemptResult, HotReadOptions } from "@exclave/hot-consumer";

export const deckRuntimeFields = {
  beatPhase01: "beatPhase01",
  level: "level",
  loopActive: "loopActive",
  mediaTimeSeconds: "mediaTimeSeconds",
  samplePosition: "samplePosition",
  stemGains: "stemGains",
  tempoRatio: "tempoRatio",
  transportState: "transportState",
} as const;

export type DeckRuntimeFieldPath =
  | "beatPhase01"
  | "level"
  | "loopActive"
  | "mediaTimeSeconds"
  | "samplePosition"
  | "stemGains"
  | "tempoRatio"
  | "transportState";

export const deckRuntimeFieldIds = {
  beatPhase01: 3213911613,
  level: 2921991399,
  loopActive: 2600609301,
  mediaTimeSeconds: 714320550,
  samplePosition: 1487766962,
  stemGains: 1302981354,
  tempoRatio: 3925450382,
  transportState: 1379000454,
} as const;

export const deckRuntimeConsumerBindingMetadata = {
  contractKey: "fixture.deckRuntime",
  semanticVersion: 0xe3636f7cdffa73b2n,
  hotLayoutVersion: 0xaddeef4f8ef66eadn,
} as const;

export const deckRuntimeConsumerBindingRuntimeAvailability = {
  hot: "source-shape-only",
} as const;

export type DeckRuntimeProjectionSnapshot = {
  readonly beatPhase01: number;
  readonly level: number;
  readonly loopActive: boolean;
  readonly mediaTimeSeconds: number;
  readonly samplePosition: bigint;
  readonly stemGains: readonly number[];
  readonly tempoRatio: number;
  readonly transportState: "stopped" | "cueing" | "playing" | "paused";
};

export type DeckRuntimeHotSnapshot = {
  readonly beatPhase01: number;
  readonly level: number;
  readonly loopActive: boolean;
  readonly mediaTimeSeconds: number;
  readonly samplePosition: bigint;
  readonly stemGains: readonly number[];
  readonly tempoRatio: number;
  readonly transportState: "stopped" | "cueing" | "playing" | "paused";
};

export type DeckRuntimeHotReadSurface = {
  readonly lane: "hot";
  readonly hotLayoutVersion: typeof deckRuntimeConsumerBindingMetadata.hotLayoutVersion;
  readonly tryReadLatest: (
    options?: HotReadOptions,
  ) => HotReadAttemptResult<DeckRuntimeHotSnapshot>;
};

export type DeckRuntimeConsumerBinding = {
  readonly fields: typeof deckRuntimeFields;
  readonly fieldIds: typeof deckRuntimeFieldIds;
  readonly metadata: typeof deckRuntimeConsumerBindingMetadata;
  readonly runtimeAvailability: typeof deckRuntimeConsumerBindingRuntimeAvailability;
  readonly hot: DeckRuntimeHotReadSurface;
};
