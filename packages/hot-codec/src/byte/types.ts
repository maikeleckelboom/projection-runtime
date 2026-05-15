import { createHotByteRejectedError, createHotCodecIssue, type HotCodecIssueCode } from "../error";
import type { HotLayoutPlanningFixedEnumShape, HotLayoutPlanningFixedScalarShape } from "../shape";

export type ScalarType = HotLayoutPlanningFixedScalarShape["type"];
export type EnumStorageType = HotLayoutPlanningFixedEnumShape["storage"];

export type HotFieldScalarValue = boolean | number | bigint | string;
export type HotFieldValue = HotFieldScalarValue | readonly HotFieldScalarValue[];
export type HotFieldValues = Readonly<Record<string, HotFieldValue>>;

export interface HotByteEncodeResult {
  readonly fieldBytes: Uint8Array;
  readonly fixtureRegionBytes: Uint8Array;
  readonly decodedValues: HotFieldValues;
}

export interface HotByteDecodeResult {
  readonly values: HotFieldValues;
}

export function throwByteIssue(code: HotCodecIssueCode, path: string, message?: string): never {
  throw createHotByteRejectedError([createHotCodecIssue(code, path, message)]);
}
