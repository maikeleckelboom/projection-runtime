import type { AbiEnumStorageType, AbiScalarType, AbiStringEncoding } from "@exclave/base";

export type WarmSnapshotPayloadEncodeFailureReason =
  | "invalidManifest"
  | "invalidSnapshotObject"
  | "snapshotFieldMissing"
  | "snapshotFieldUnknown"
  | "invalidSnapshotValue";

export type WarmSnapshotPayloadDecodeFailureReason =
  | "invalidManifest"
  | "invalidPayloadInput"
  | "malformedPayload"
  | "invalidUtf8";

export type WarmSnapshotPayloadEncodeFailure = {
  readonly kind: "warmSnapshotPayloadEncodeFailure";
  readonly reason: WarmSnapshotPayloadEncodeFailureReason;
  readonly detail: string;
  readonly path?: string;
  readonly fieldDotPath?: string;
  readonly fieldId?: number;
};

export type WarmSnapshotPayloadDecodeFailure = {
  readonly kind: "warmSnapshotPayloadDecodeFailure";
  readonly reason: WarmSnapshotPayloadDecodeFailureReason;
  readonly detail: string;
  readonly path?: string;
  readonly fieldDotPath?: string;
  readonly fieldId?: number;
  readonly offset?: number;
};

export type WarmSnapshotPayloadEncodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly failure: WarmSnapshotPayloadEncodeFailure };

export type WarmSnapshotPayloadDecodeResult =
  | { readonly ok: true; readonly snapshot: WarmSnapshotObject }
  | { readonly ok: false; readonly failure: WarmSnapshotPayloadDecodeFailure };

export interface WarmSnapshotPayloadManifest {
  readonly fields: readonly WarmSnapshotPayloadField[];
  readonly warmCodecVersion?: bigint;
}

export interface WarmSnapshotPayloadField {
  readonly dotPath: string;
  readonly fieldId?: number;
  readonly shape: WarmSnapshotPayloadShape;
}

export type WarmSnapshotPayloadShape =
  | WarmSnapshotPayloadFixedScalarShape
  | WarmSnapshotPayloadFixedEnumShape
  | WarmSnapshotPayloadFixedVectorShape
  | WarmSnapshotPayloadBoundedArrayShape
  | WarmSnapshotPayloadBoundedMapShape
  | WarmSnapshotPayloadVariableMapShape
  | WarmSnapshotPayloadFixedStringEncodedShape
  | WarmSnapshotPayloadVariableStringShape;

export interface WarmSnapshotPayloadFixedScalarShape {
  readonly kind: "FixedScalar";
  readonly type: AbiScalarType;
  readonly nanSentinel?: true;
}

export interface WarmSnapshotPayloadFixedEnumShape {
  readonly kind: "FixedEnum";
  readonly storage: AbiEnumStorageType;
  readonly variants: readonly string[];
}

export interface WarmSnapshotPayloadFixedVectorShape {
  readonly kind: "FixedVector";
  readonly elementType: AbiScalarType;
  readonly length: number;
}

export interface WarmSnapshotPayloadBoundedArrayShape {
  readonly kind: "BoundedArray";
  readonly elementType: AbiScalarType;
  readonly maxLength: number;
}

export interface WarmSnapshotPayloadBoundedMapShape {
  readonly kind: "BoundedMap";
  readonly keyEncoding?: "fixed-ascii";
  readonly keyByteLength: number;
  readonly valueShape: WarmSnapshotPayloadFixedValueShape;
  readonly maxEntries: number;
}

export interface WarmSnapshotPayloadVariableMapShape {
  readonly kind: "VariableMap";
  readonly valueShape: WarmSnapshotPayloadShape;
}

export interface WarmSnapshotPayloadFixedStringEncodedShape {
  readonly kind: "FixedStringEncoded";
  readonly byteLength: number;
  readonly encoding: AbiStringEncoding;
}

export interface WarmSnapshotPayloadVariableStringShape {
  readonly kind: "VariableString";
}

export type WarmSnapshotPayloadFixedValueShape =
  | WarmSnapshotPayloadFixedScalarShape
  | WarmSnapshotPayloadFixedEnumShape
  | WarmSnapshotPayloadFixedVectorShape;

export type WarmSnapshotScalarValue = boolean | number | bigint | string;
export type WarmSnapshotValue =
  | WarmSnapshotScalarValue
  | readonly WarmSnapshotValue[]
  | WarmSnapshotMapObject;

export interface WarmSnapshotObject {
  readonly [key: string]: WarmSnapshotValue;
}

export interface WarmSnapshotMapObject {
  readonly [key: string]: WarmSnapshotValue;
}

export type NormalizedField = {
  readonly dotPath: string;
  readonly fieldId?: number;
  readonly shape: WarmSnapshotPayloadShape;
};

export type FieldContext = {
  readonly dotPath: string;
  readonly fieldId?: number;
};

export type ObjectKeysResult =
  | { readonly ok: true; readonly stringKeys: readonly string[]; readonly symbolCount: number }
  | { readonly ok: false; readonly detail: string };
