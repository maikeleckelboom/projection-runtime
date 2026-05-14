import type { HotCodecError, HotCodecIssue } from "./error";
import type { HotLayoutPlanningShape } from "./shape";

export type HotLayoutVersion = bigint;

export interface HotLayoutPlanningInput {
  readonly contractKey: string;
  readonly fields: readonly HotLayoutPlanningField[];
  readonly hot: HotLayoutPlanningHotLane;
}

export interface HotLayoutPlanningHotLane {
  readonly codec: "mapped-fixed";
  readonly reservations: readonly string[];
}

export interface HotLayoutPlanningField {
  readonly dotPath: string;
  readonly fieldId: number;
  readonly shape: HotLayoutPlanningShape;
}

export interface HotLayoutManifest {
  readonly contractKey: string;
  readonly hotLayoutVersion: HotLayoutVersion;
  readonly hotAbiVersion: 1;
  readonly blockASize: 72;
  readonly blockBStartOffset: 72;
  readonly seqlockOffset: 72;
  readonly baselineEpochOffset: 80;
  readonly continuityGenOffset: 84;
  readonly publicationSeqOffset: 88;
  readonly fieldDataOrigin: 96;
  readonly totalRegionByteLength: number;
  readonly mutableRegionByteLength: number;
  readonly fields: readonly HotFieldEntry[];
  readonly reservations: readonly HotReservationEntry[];
}

export interface HotFieldEntry {
  readonly dotPath: string;
  readonly fieldId: number;
  readonly shape: HotLayoutPlanningShape;
  readonly absoluteOffset: number;
  readonly byteSpan: number;
  readonly alignment: number;
}

export interface HotReservationEntry {
  readonly dotPath: string;
  readonly countFieldOffset: number;
  readonly elementsOffset: number;
  readonly maxCount: number;
  readonly unitByteLength: number;
}

export type HotLayoutPlanResult = HotLayoutPlanSuccess | HotLayoutPlanFailure;

export interface HotLayoutPlanSuccess {
  readonly ok: true;
  readonly value: HotLayoutManifest;
}

export interface HotLayoutPlanFailure {
  readonly ok: false;
  readonly error: HotCodecError;
}

export type { HotCodecIssue };
