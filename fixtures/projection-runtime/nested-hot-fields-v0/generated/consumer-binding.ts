// Generated from fixtures/projection-runtime/nested-hot-fields-v0/resolved-contract.json. Do not edit by hand.
import type { HotReadAttemptResult, HotReadOptions } from "@exclave/hot-consumer";

export const nestedHotFieldsFields = {
  meters: {
    left: "meters.left",
    right: "meters.right",
  },
  status: {
    active: "status.active",
    speed: "status.speed",
  },
} as const;

export type NestedHotFieldsFieldPath =
  | "meters.left"
  | "meters.right"
  | "status.active"
  | "status.speed";

export const nestedHotFieldsFieldIds = {
  "meters.left": 1923665339,
  "meters.right": 1823965422,
  "status.active": 2386138137,
  "status.speed": 3281089916,
} as const;

export const nestedHotFieldsConsumerBindingMetadata = {
  contractKey: "fixture.nestedHotFields",
  semanticVersion: 0x5fc08473f9e0ab47n,
  hotLayoutVersion: 0x6511718d600129ccn,
} as const;

export const nestedHotFieldsConsumerBindingRuntimeAvailability = {
  hot: "source-shape-only",
} as const;

export type NestedHotFieldsProjectionSnapshot = {
  readonly "meters.left": number;
  readonly "meters.right": number;
  readonly "status.active": boolean;
  readonly "status.speed": number;
};

export type NestedHotFieldsHotSnapshot = {
  readonly "meters.left": number;
  readonly "meters.right": number;
  readonly "status.active": boolean;
  readonly "status.speed": number;
};

export type NestedHotFieldsHotReadSurface = {
  readonly lane: "hot";
  readonly hotLayoutVersion: typeof nestedHotFieldsConsumerBindingMetadata.hotLayoutVersion;
  readonly tryReadLatest: (
    options?: HotReadOptions,
  ) => HotReadAttemptResult<NestedHotFieldsHotSnapshot>;
};

export type NestedHotFieldsConsumerBinding = {
  readonly fields: typeof nestedHotFieldsFields;
  readonly fieldIds: typeof nestedHotFieldsFieldIds;
  readonly metadata: typeof nestedHotFieldsConsumerBindingMetadata;
  readonly runtimeAvailability: typeof nestedHotFieldsConsumerBindingRuntimeAvailability;
  readonly hot: NestedHotFieldsHotReadSurface;
};
