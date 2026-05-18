// Generated from fixtures/projection-runtime/hot-exchange-v0/resolved-contract.json. Do not edit by hand.
import type { HotReadAttemptResult, HotReadOptions } from "@exclave/hot-consumer";

export const hotExchangeFields = {
  displayName: "displayName",
  gain: "gain",
  levelVector: "levelVector",
  phase: "phase",
  revision: "revision",
} as const;

export type HotExchangeFieldPath = "displayName" | "gain" | "levelVector" | "phase" | "revision";

export const hotExchangeFieldIds = {
  displayName: 575185041,
  gain: 1031991704,
  levelVector: 2082864082,
  phase: 3258444950,
  revision: 1857815481,
} as const;

export const hotExchangeConsumerBindingMetadata = {
  contractKey: "fixture.hotExchange.v0",
  semanticVersion: 0xda65c7947f2837d9n,
  hotLayoutVersion: 0xa601a5b9fe7fc79en,
} as const;

export const hotExchangeConsumerBindingRuntimeAvailability = {
  hot: "source-shape-only",
} as const;

export type HotExchangeProjectionSnapshot = {
  readonly displayName: string;
  readonly gain: number;
  readonly levelVector: readonly [number, number, number, number];
  readonly phase: number;
  readonly revision: number;
};

export type HotExchangeHotSnapshot = {
  readonly displayName: string;
  readonly gain: number;
  readonly levelVector: readonly [number, number, number, number];
  readonly phase: number;
  readonly revision: number;
};

export type HotExchangeHotReadSurface = {
  readonly lane: "hot";
  readonly hotLayoutVersion: typeof hotExchangeConsumerBindingMetadata.hotLayoutVersion;
  readonly tryReadLatest: (
    options?: HotReadOptions,
  ) => HotReadAttemptResult<HotExchangeHotSnapshot>;
};

export type HotExchangeConsumerBinding = {
  readonly fields: typeof hotExchangeFields;
  readonly fieldIds: typeof hotExchangeFieldIds;
  readonly metadata: typeof hotExchangeConsumerBindingMetadata;
  readonly runtimeAvailability: typeof hotExchangeConsumerBindingRuntimeAvailability;
  readonly hot: HotExchangeHotReadSurface;
};
