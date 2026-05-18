// Generated from fixtures/projection-runtime/hot-basic-v0/resolved-contract.json. Do not edit by hand.
import type { HotReadAttemptResult, HotReadOptions } from "@exclave/hot-consumer";

export const hotBasicFields = {
  cursor: "cursor",
  health: "health",
  level: "level",
  peaks: "peaks",
  phase: "phase",
} as const;

export type HotBasicFieldPath = "cursor" | "health" | "level" | "peaks" | "phase";

export const hotBasicFieldIds = {
  cursor: 2041288779,
  health: 194776614,
  level: 2702269473,
  peaks: 2500593086,
  phase: 3513240106,
} as const;

export const hotBasicConsumerBindingMetadata = {
  contractKey: "fixture.hotBasic",
  semanticVersion: 0x67b271f31c6b06a0n,
  hotLayoutVersion: 0x8f3eb897fd88495cn,
} as const;

export const hotBasicConsumerBindingRuntimeAvailability = {
  hot: "source-shape-only",
} as const;

export type HotBasicProjectionSnapshot = {
  readonly cursor: number;
  readonly health: "ok" | "warn" | "fail";
  readonly level: number;
  readonly peaks: readonly number[];
  readonly phase: number;
};

export type HotBasicHotSnapshot = {
  readonly cursor: number;
  readonly health: "ok" | "warn" | "fail";
  readonly level: number;
  readonly peaks: readonly number[];
  readonly phase: number;
};

export type HotBasicHotReadSurface = {
  readonly lane: "hot";
  readonly hotLayoutVersion: typeof hotBasicConsumerBindingMetadata.hotLayoutVersion;
  readonly tryReadLatest: (options?: HotReadOptions) => HotReadAttemptResult<HotBasicHotSnapshot>;
};

export type HotBasicConsumerBinding = {
  readonly fields: typeof hotBasicFields;
  readonly fieldIds: typeof hotBasicFieldIds;
  readonly metadata: typeof hotBasicConsumerBindingMetadata;
  readonly runtimeAvailability: typeof hotBasicConsumerBindingRuntimeAvailability;
  readonly hot: HotBasicHotReadSurface;
};
