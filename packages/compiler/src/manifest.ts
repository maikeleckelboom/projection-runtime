import type {
  HotLayoutVersion as HotCodecLayoutVersion,
  HotLayoutManifest,
} from "@seqlok/hot-codec";
import type { EnumStorageType, ProjectionFamily, ScalarType, StringEncoding } from "@seqlok/schema";

export type SemanticVersion = bigint;
export type HotLayoutVersion = HotCodecLayoutVersion;
export type WarmCodecVersion = bigint;
export type ColdCodecVersion = bigint;

export interface CanonicalProjectionManifest {
  readonly key: string;
  readonly family: ProjectionFamily;
  readonly fields: readonly CanonicalField[];
  readonly lanes: CanonicalLaneDeclarations;
}

export interface CanonicalField {
  readonly dotPath: string;
  readonly fieldId: number;
  readonly shape: CanonicalFieldShape;
}

export type CanonicalFieldShape =
  | CanonicalFixedScalarShape
  | CanonicalFixedEnumShape
  | CanonicalFixedVectorShape
  | CanonicalFixedStringEncodedShape
  | CanonicalBoundedArrayShape
  | CanonicalBoundedMapShape
  | CanonicalVariableStringShape
  | CanonicalVariableMapShape;

export interface CanonicalFixedScalarShape {
  readonly kind: "FixedScalar";
  readonly type: ScalarType;
  readonly nanSentinel?: true;
}

export interface CanonicalFixedEnumShape {
  readonly kind: "FixedEnum";
  readonly variants: readonly string[];
  readonly storage: EnumStorageType;
}

export interface CanonicalFixedVectorShape {
  readonly kind: "FixedVector";
  readonly elementType: ScalarType;
  readonly length: number;
}

export interface CanonicalFixedStringEncodedShape {
  readonly kind: "FixedStringEncoded";
  readonly byteLength: number;
  readonly encoding: StringEncoding;
}

export interface CanonicalBoundedArrayShape {
  readonly kind: "BoundedArray";
  readonly elementType: ScalarType;
  readonly maxLength: number;
}

export interface CanonicalBoundedMapShape {
  readonly kind: "BoundedMap";
  readonly keyEncoding: "fixed-ascii";
  readonly keyByteLength: number;
  readonly valueShape:
    | CanonicalFixedScalarShape
    | CanonicalFixedEnumShape
    | CanonicalFixedVectorShape;
  readonly maxEntries: number;
}

export interface CanonicalVariableStringShape {
  readonly kind: "VariableString";
}

export interface CanonicalVariableMapShape {
  readonly kind: "VariableMap";
  readonly valueShape: CanonicalFieldShape;
}

export interface CanonicalLaneDeclarations {
  readonly hot?: CanonicalHotLaneDeclaration;
  readonly warm?: CanonicalWarmLaneDeclaration;
  readonly cold?: CanonicalColdLaneDeclaration;
}

export interface CanonicalHotLaneDeclaration {
  readonly codec: "mapped-fixed";
  readonly reservations: readonly string[];
}

export interface CanonicalWarmLaneDeclaration {
  readonly codec: "framed-snapshot";
}

export interface CanonicalColdLaneDeclaration {
  readonly materialization: "latest-snapshot" | "checkpointed-snapshot";
}

export interface ResolvedProjectionContract {
  readonly manifest: CanonicalProjectionManifest;
  readonly semanticVersion: SemanticVersion;
  readonly hotLayoutVersion?: HotLayoutVersion;
  readonly warmCodecVersion?: WarmCodecVersion;
  readonly coldCodecVersion?: ColdCodecVersion;
  readonly laneManifests?: LaneManifests;
}

export interface LaneManifests {
  readonly hot?: HotLayoutManifest;
}
